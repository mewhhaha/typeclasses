import type { Comment, Node, Program, Statement } from "oxc-parser";
import { print } from "esrap";
import ts_language from "esrap/languages/ts";
import tsx_language from "esrap/languages/tsx";
import { basename } from "node:path";
import { node, walk } from "./transform_ast.ts";
import type { TransformSourceMap } from "./transform_context.ts";

export type SourcePosition = { readonly line: number; readonly column: number };
export type PositionLookup = (offset: number) => SourcePosition;

export type SourceEdit =
  | {
    readonly kind: "replace";
    readonly start: number;
    readonly end: number;
    readonly node: Node;
    readonly is_expression?: boolean;
  }
  | {
    readonly kind: "replace_statements";
    readonly start: number;
    readonly end: number;
    readonly statements: readonly Statement[];
  }
  | {
    readonly kind: "delete";
    readonly start: number;
    readonly end: number;
  }
  | {
    readonly kind: "insert";
    readonly at: number;
    readonly statements: readonly Statement[];
    readonly prefix?: string;
    readonly suffix?: string;
  };

const vlq_chars =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const vlq_lookup = /* @__PURE__ */ (() => {
  const table = new Int8Array(128).fill(-1);
  for (let index = 0; index < vlq_chars.length; index += 1) {
    table[vlq_chars.charCodeAt(index)] = index;
  }
  return table;
})();

const safe_unwrapped_expressions = new Set([
  "CallExpression",
  "Identifier",
  "MemberExpression",
  "ArrayExpression",
  "TemplateLiteral",
  "ParenthesizedExpression",
]);

/** Fast monotonic line/column lookup supporting all ECMAScript line terminators. */
export function create_source_positions(source: string): PositionLookup {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    const character = source.charCodeAt(index);
    if (character === 13) {
      if (source.charCodeAt(index + 1) === 10) index += 1;
      starts.push(index + 1);
    } else if (
      character === 10 || character === 0x2028 || character === 0x2029
    ) starts.push(index + 1);
  }
  let cached = 0;
  return (offset: number) => {
    const line_start = starts[cached];
    const next_start = starts[cached + 1];
    if (
      offset >= line_start &&
      (next_start === undefined || offset < next_start)
    ) {
      return { line: cached + 1, column: offset - line_start };
    }
    let left = 0;
    let right = starts.length;
    while (left + 1 < right) {
      const middle = (left + right) >>> 1;
      if (starts[middle] <= offset) left = middle;
      else right = middle;
    }
    cached = left;
    return { line: left + 1, column: offset - starts[left] };
  };
}

function encode_vlq(value: number): string {
  let vlq = value < 0 ? ((-value) << 1) + 1 : value << 1;
  let out = "";
  do {
    let digit = vlq & 31;
    vlq >>>= 5;
    if (vlq > 0) digit |= 32;
    out += vlq_chars[digit];
  } while (vlq > 0);
  return out;
}

function attach_locations(root: Node, position: PositionLookup): void {
  walk(root, (current) => {
    if (current.start < 0) return;
    (current as unknown as {
      loc?: { start: SourcePosition; end: SourcePosition };
    }).loc = {
      start: position(current.start),
      end: position(current.end),
    };
  });
}

function comments_in_range(
  comments: readonly Comment[],
  start: number,
  end: number,
  get_position: () => PositionLookup,
): (Comment & { loc: { start: SourcePosition; end: SourcePosition } })[] {
  if (comments.length === 0 || end <= start) return [];
  let low = 0;
  let high = comments.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (comments[mid].start < start) low = mid + 1;
    else high = mid;
  }
  const result: (Comment & {
    loc: { start: SourcePosition; end: SourcePosition };
  })[] = [];
  let position: PositionLookup | undefined;
  for (let index = low; index < comments.length; index += 1) {
    const comment = comments[index];
    if (comment.start >= end) break;
    if (comment.end <= end) {
      position ??= get_position();
      result.push({
        ...comment,
        loc: { start: position(comment.start), end: position(comment.end) },
      });
    }
  }
  return result;
}

function needs_asi_parens(
  source: string,
  start: number,
  printed: string,
): boolean {
  const leading_line_comment = printed.startsWith("//");
  const leading_block_with_newline = printed.startsWith("/*") && (() => {
    const close = printed.indexOf("*/");
    if (close < 0) return false;
    const after = printed.slice(close + 2);
    const first_non_space = after.search(/\S/);
    const leading = first_non_space < 0
      ? after
      : after.slice(0, first_non_space);
    return leading.includes("\n") || printed.slice(0, close).includes("\n");
  })();
  if (!leading_line_comment && !leading_block_with_newline) return false;
  let cursor = start;
  while (cursor > 0 && /\s/.test(source[cursor - 1])) cursor -= 1;
  const before = source.slice(Math.max(0, cursor - 8), cursor);
  return /(?:^|[^A-Za-z0-9_$])(?:return|throw|yield)$/.test(before);
}

function synthetic_program(statements: readonly Statement[]): Program {
  return node({
    type: "Program",
    body: statements as Program["body"],
    sourceType: "module",
    hashbang: null,
  }) as unknown as Program;
}

/** Splice printed AST edits into original source, stitching exact V3 source maps. */
export function splice_edits(
  source: string,
  file_name: string,
  lang: "ts" | "tsx",
  comments: readonly Comment[],
  edits: readonly SourceEdit[],
  source_map: boolean,
  position_lookup?: PositionLookup,
): { readonly code: string; readonly map: TransformSourceMap | null } {
  const ordered = [...edits].sort((left, right) => {
    const left_start = left.kind === "insert" ? left.at : left.start;
    const right_start = right.kind === "insert" ? right.at : right.start;
    if (left_start !== right_start) return left_start - right_start;
    if (left.kind === "insert" && right.kind !== "insert") return -1;
    if (left.kind !== "insert" && right.kind === "insert") return 1;
    return 0;
  });

  const base = basename(file_name);
  let position = source_map
    ? (position_lookup ?? create_source_positions(source))
    : position_lookup;
  function get_position(): PositionLookup {
    return position ??= create_source_positions(source);
  }
  const has_non_lf = source.includes("\r") || source.includes("\u2028") ||
    source.includes("\u2029");

  const code_chunks: string[] = [];
  const mapping_parts: string[] = [];
  const names: string[] = [];
  const name_indices = new Map<string, number>();

  let current_gen_col = 0;
  let out_gen_col = 0;
  let out_src = 0;
  let out_orig_line = 0;
  let out_orig_col = 0;
  let out_name = 0;
  let line_has_seg = false;

  function emit_newline(): void {
    mapping_parts.push(";");
    current_gen_col = 0;
    out_gen_col = 0;
    line_has_seg = false;
  }

  function emit_segment(
    abs_gen_col: number,
    abs_orig_line: number,
    abs_orig_col: number,
    abs_name?: number,
  ): void {
    let segment = "";
    if (line_has_seg) segment = ",";
    segment += encode_vlq(abs_gen_col - out_gen_col) +
      encode_vlq(-out_src) +
      encode_vlq(abs_orig_line - out_orig_line) +
      encode_vlq(abs_orig_col - out_orig_col);
    if (abs_name !== undefined) {
      segment += encode_vlq(abs_name - out_name);
      out_name = abs_name;
    }
    mapping_parts.push(segment);
    out_gen_col = abs_gen_col;
    out_src = 0;
    out_orig_line = abs_orig_line;
    out_orig_col = abs_orig_col;
    line_has_seg = true;
  }

  function emit_unmapped_segment(abs_gen_col: number): void {
    let segment = "";
    if (line_has_seg) segment = ",";
    segment += encode_vlq(abs_gen_col - out_gen_col);
    mapping_parts.push(segment);
    out_gen_col = abs_gen_col;
    line_has_seg = true;
  }

  function emit_plain_text(text: string): void {
    if (text.length === 0) return;
    code_chunks.push(text);
    if (!source_map) return;
    let index = text.indexOf("\n");
    if (index < 0) {
      current_gen_col += text.length;
      return;
    }
    let last = 0;
    while (index >= 0) {
      emit_newline();
      last = index + 1;
      index = text.indexOf("\n", last);
    }
    current_gen_col = text.length - last;
  }

  function emit_untouched(start: number, end: number): void {
    if (end <= start) return;
    const raw = source.slice(start, end);
    const text = has_non_lf ? raw.replace(/\r\n|\r|\u2028|\u2029/g, "\n") : raw;
    code_chunks.push(text);
    if (!source_map) return;

    const origin = position!(start);
    let orig_line = origin.line - 1;
    const orig_col = origin.column;
    let cursor = 0;
    let nl = text.indexOf("\n");
    if (nl < 0) {
      emit_segment(current_gen_col, orig_line, orig_col);
      current_gen_col += text.length;
      return;
    }
    if (nl > 0) {
      emit_segment(current_gen_col, orig_line, orig_col);
    }
    emit_newline();
    cursor = nl + 1;
    orig_line += 1;

    while (cursor < text.length) {
      nl = text.indexOf("\n", cursor);
      if (nl < 0) {
        if (
          out_src === 0 && out_orig_col === 0 && orig_line === out_orig_line + 1
        ) {
          mapping_parts.push("AACA");
          out_orig_line = orig_line;
          line_has_seg = true;
        } else {
          emit_segment(0, orig_line, 0);
        }
        current_gen_col = text.length - cursor;
        return;
      }
      if (nl > cursor) {
        if (
          out_src === 0 && out_orig_col === 0 && orig_line === out_orig_line + 1
        ) {
          mapping_parts.push("AACA");
          out_orig_line = orig_line;
          line_has_seg = true;
        } else {
          emit_segment(0, orig_line, 0);
        }
      }
      emit_newline();
      cursor = nl + 1;
      orig_line += 1;
    }
  }

  function stitch_edit_map(
    edit_code: string,
    edit_mappings: string,
    edit_names: readonly string[],
  ): void {
    const start_col = current_gen_col;
    const mapped_names = edit_names.length > 0
      ? edit_names.map((name) => {
        let idx = name_indices.get(name);
        if (idx === undefined) {
          idx = names.length;
          names.push(name);
          name_indices.set(name, idx);
        }
        return idx;
      })
      : undefined;

    let e_gen_col = 0;
    let e_src = 0;
    let e_orig_line = 0;
    let e_orig_col = 0;
    let e_name = 0;
    let map_cursor = 0;
    const map_len = edit_mappings.length;

    function read_vlq(): number | undefined {
      let result = 0;
      let shift = 0;
      while (map_cursor < map_len) {
        const code = edit_mappings.charCodeAt(map_cursor);
        const digit = code < 128 ? vlq_lookup[code] : -1;
        if (digit < 0) return undefined;
        map_cursor += 1;
        result |= (digit & 31) << shift;
        if ((digit & 32) === 0) {
          return (result & 1) === 1 ? -(result >>> 1) : result >>> 1;
        }
        shift += 5;
      }
      return undefined;
    }

    let line_idx = 0;
    let text_cursor = 0;
    while (true) {
      if (line_idx > 0) {
        emit_newline();
        e_gen_col = 0;
      }
      const col_offset = line_idx === 0 ? start_col : 0;

      // Consume all segments for this line in edit_mappings.
      while (map_cursor < map_len) {
        const ch = edit_mappings.charCodeAt(map_cursor);
        if (ch === 59 /* ; */) {
          map_cursor += 1;
          break;
        }
        if (ch === 44 /* , */) {
          map_cursor += 1;
          continue;
        }
        const d_gen = read_vlq();
        if (d_gen === undefined) {
          map_cursor += 1;
          continue;
        }
        e_gen_col += d_gen;

        if (
          map_cursor >= map_len ||
          edit_mappings.charCodeAt(map_cursor) === 44 ||
          edit_mappings.charCodeAt(map_cursor) === 59
        ) {
          emit_unmapped_segment(col_offset + e_gen_col);
          continue;
        }
        const d_src = read_vlq();
        const d_line = read_vlq();
        const d_col = read_vlq();
        if (
          d_src === undefined || d_line === undefined || d_col === undefined
        ) continue;
        e_src += d_src;
        e_orig_line += d_line;
        e_orig_col += d_col;
        let abs_name: number | undefined;
        if (
          map_cursor < map_len &&
          edit_mappings.charCodeAt(map_cursor) !== 44 &&
          edit_mappings.charCodeAt(map_cursor) !== 59
        ) {
          const d_name = read_vlq();
          if (d_name !== undefined) {
            e_name += d_name;
            abs_name = mapped_names?.[e_name];
          }
        }
        void e_src;
        emit_segment(col_offset + e_gen_col, e_orig_line, e_orig_col, abs_name);
      }

      const nl = edit_code.indexOf("\n", text_cursor);
      if (nl < 0) {
        current_gen_col = col_offset + (edit_code.length - text_cursor);
        break;
      }
      text_cursor = nl + 1;
      line_idx += 1;
    }
  }

  function print_node(
    target: Node,
    edit_comments: ReturnType<typeof comments_in_range>,
  ) {
    const language = lang === "tsx"
      ? tsx_language({ quotes: "double", comments: edit_comments })
      : ts_language({ quotes: "double", comments: edit_comments });
    if (!source_map) {
      const previous = language._;
      language._ = (current, context, visitor) => {
        const previous_location = context.location;
        context.location = () => {};
        try {
          if (previous !== undefined) previous(current, context, visitor);
          else visitor(current);
        } finally {
          context.location = previous_location;
        }
      };
    }
    return print(target, language, {
      indent: "  ",
      sourceMapSource: base,
      sourceMapContent: source,
    });
  }

  let cursor = 0;
  for (const edit of ordered) {
    const start = edit.kind === "insert" ? edit.at : edit.start;
    if (start > cursor) {
      emit_untouched(cursor, start);
    }
    if (edit.kind === "delete") {
      cursor = edit.end;
      continue;
    }
    if (edit.kind === "insert") {
      const prog = synthetic_program(edit.statements);
      if (position !== undefined) attach_locations(prog, position);
      const printed = print_node(prog, []);
      if (edit.prefix) emit_plain_text(edit.prefix);
      code_chunks.push(printed.code);
      if (source_map) {
        stitch_edit_map(
          printed.code,
          printed.map.mappings,
          printed.map.names,
        );
      }
      if (edit.suffix) emit_plain_text(edit.suffix);
      cursor = edit.at;
      continue;
    }
    const edit_comments = comments_in_range(
      comments,
      edit.start,
      edit.end,
      get_position,
    );
    const target = edit.kind === "replace_statements"
      ? synthetic_program(edit.statements)
      : edit.node;
    if (source_map || edit_comments.length > 0) {
      attach_locations(target, get_position());
    }
    const printed = print_node(target, edit_comments);
    let wrap = false;
    if (edit.kind === "replace" && edit.is_expression) {
      if (
        !safe_unwrapped_expressions.has(edit.node.type) ||
        needs_asi_parens(source, edit.start, printed.code)
      ) {
        wrap = true;
      }
    }
    if (wrap) emit_plain_text("(");
    code_chunks.push(printed.code);
    if (source_map) {
      stitch_edit_map(
        printed.code,
        printed.map.mappings,
        printed.map.names,
      );
    }
    if (wrap) emit_plain_text(")");
    cursor = edit.end;
  }

  if (cursor < source.length) {
    emit_untouched(cursor, source.length);
  }

  const code = code_chunks.join("");
  if (!source_map) {
    return { code, map: null };
  }
  return {
    code,
    map: {
      version: 3,
      file: base,
      sourceRoot: "",
      sources: [base],
      sourcesContent: [source],
      names,
      mappings: mapping_parts.join(""),
    },
  };
}
