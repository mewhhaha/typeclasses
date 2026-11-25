import type { Comment, Node, Program, Statement } from "oxc-parser";
import { print } from "esrap";
import ts_language from "esrap/languages/ts";
import tsx_language from "esrap/languages/tsx";
import { basename } from "node:path";
import { node, value_visitor_keys } from "./transform_ast.ts";
import type { TransformSourceMap } from "./transform_context.ts";
import {
  type FastPrintSink,
  type FastSourceLocator,
  try_print_fast,
} from "./transform_printer.ts";

export type SourcePosition = { readonly line: number; readonly column: number };
export type PositionLookup = (offset: number) => SourcePosition;

type CommentWithLoc = Comment & {
  loc: { start: SourcePosition; end: SourcePosition };
};

type PositionLookupMeta = {
  readonly source: string;
  readonly starts: readonly number[];
  readonly non_lf: boolean;
  readonly locator: FastSourceLocator;
};

const position_lookup_meta = /* @__PURE__ */ new WeakMap<
  PositionLookup,
  PositionLookupMeta
>();

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
const vlq_small = /* @__PURE__ */ (() => {
  const table = new Array<string>(512);
  for (let value = -256; value <= 255; value += 1) {
    let vlq = value < 0 ? ((-value) << 1) + 1 : value << 1;
    let out = "";
    do {
      let digit = vlq & 31;
      vlq >>>= 5;
      if (vlq > 0) digit |= 32;
      out += vlq_chars[digit];
    } while (vlq > 0);
    table[value + 256] = out;
  }
  return table;
})();

const AACA_RUNS: readonly string[] = /* @__PURE__ */ (() => {
  const arr = new Array<string>(65);
  arr[0] = "";
  for (let i = 1; i <= 64; i += 1) arr[i] = "AACA;".repeat(i);
  return arr;
})();

const EMPTY_COMMENTS: readonly CommentWithLoc[] = [];

const safe_unwrapped_expressions = new Set([
  "CallExpression",
  "Identifier",
  "MemberExpression",
  "ArrayExpression",
  "TemplateLiteral",
  "ParenthesizedExpression",
]);

const noop_location = (): void => {};

function make_nomap_language(
  base_lang: ReturnType<typeof ts_language>,
): ReturnType<typeof ts_language> {
  const previous = base_lang._;
  base_lang._ = (current, context, visitor) => {
    if (context.location !== noop_location) context.location = noop_location;
    if (previous !== undefined) previous(current, context, visitor);
    else visitor(current);
  };
  return base_lang;
}

const cached_ts_map = /* @__PURE__ */ ts_language({
  quotes: "double",
  comments: [],
});
const cached_tsx_map = /* @__PURE__ */ tsx_language({
  quotes: "double",
  comments: [],
});
const cached_ts_nomap = /* @__PURE__ */ make_nomap_language(
  ts_language({ quotes: "double", comments: [] }),
);
const cached_tsx_nomap = /* @__PURE__ */ make_nomap_language(
  tsx_language({ quotes: "double", comments: [] }),
);

const RESET_COMMENT_PROGRAM = {
  type: "Program",
  body: [],
  sourceType: "module",
  loc: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
} as unknown as Node;

type CommentedLanguage = {
  readonly comments: CommentWithLoc[];
  readonly language: ReturnType<typeof ts_language>;
};

function make_commented_language(
  tsx: boolean,
  source_map: boolean,
): CommentedLanguage {
  const comments: CommentWithLoc[] = [];
  let language = tsx
    ? tsx_language({ quotes: "double", comments })
    : ts_language({ quotes: "double", comments });
  if (!source_map) language = make_nomap_language(language);
  return { comments, language };
}

let commented_ts_map: CommentedLanguage | undefined;
let commented_ts_nomap: CommentedLanguage | undefined;
let commented_tsx_map: CommentedLanguage | undefined;
let commented_tsx_nomap: CommentedLanguage | undefined;

function build_line_starts(source: string, non_lf: boolean): number[] {
  const starts = [0];
  if (!non_lf) {
    let pos = source.indexOf("\n");
    while (pos >= 0) {
      starts.push(pos + 1);
      pos = source.indexOf("\n", pos + 1);
    }
  } else {
    for (let index = 0; index < source.length; index += 1) {
      const character = source.charCodeAt(index);
      if (character === 13) {
        if (source.charCodeAt(index + 1) === 10) index += 1;
        starts.push(index + 1);
      } else if (
        character === 10 || character === 0x2028 || character === 0x2029
      ) starts.push(index + 1);
    }
  }
  return starts;
}

function create_locator_from_starts(
  starts: readonly number[],
): FastSourceLocator {
  let cached = 0;
  const locator: FastSourceLocator = {
    line: 1,
    column: 0,
    lookup(offset: number): void {
      const line_start = starts[cached];
      const next_start = starts[cached + 1];
      if (offset >= line_start) {
        if (next_start === undefined || offset < next_start) {
          locator.line = cached + 1;
          locator.column = offset - line_start;
          return;
        }
        const after_next = starts[cached + 2];
        if (after_next === undefined || offset < after_next) {
          cached += 1;
          locator.line = cached + 1;
          locator.column = offset - next_start;
          return;
        }
      }
      let left = 0;
      let right = starts.length;
      while (left + 1 < right) {
        const middle = (left + right) >>> 1;
        if (starts[middle] <= offset) left = middle;
        else right = middle;
      }
      cached = left;
      locator.line = left + 1;
      locator.column = offset - starts[left];
    },
  };
  return locator;
}

/** Fast monotonic line/column lookup supporting all ECMAScript line terminators. */
export function create_source_positions(
  source: string,
  has_non_lf?: boolean,
): PositionLookup {
  const non_lf = has_non_lf ??
    (source.includes("\r") || source.includes("\u2028") ||
      source.includes("\u2029"));
  const starts = build_line_starts(source, non_lf);
  const locator = create_locator_from_starts(starts);
  const lookup: PositionLookup = (offset: number) => {
    locator.lookup(offset);
    return { line: locator.line, column: locator.column };
  };
  position_lookup_meta.set(lookup, { source, starts, non_lf, locator });
  return lookup;
}

function encode_vlq(value: number): string {
  if (value >= -256 && value <= 255) return vlq_small[value + 256];
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

function attach_locations(
  root: Node,
  position: PositionLookup,
  needs_end: boolean,
): void {
  function visit(current: Node): void {
    if (current.start >= 0) {
      const start = position(current.start);
      (current as unknown as {
        loc?: { start: SourcePosition; end: SourcePosition };
      }).loc = {
        start,
        end: needs_end ? position(current.end) : start,
      };
    }
    const keys = value_visitor_keys[current.type];
    if (keys === undefined || keys.length === 0) return;
    const record = current as unknown as Record<string, unknown>;
    for (let i = 0; i < keys.length; i += 1) {
      const val = record[keys[i]];
      if (val === null || typeof val !== "object") continue;
      if (Array.isArray(val)) {
        for (let j = 0; j < val.length; j += 1) {
          const item = val[j];
          if (
            item !== null && typeof item === "object" &&
            typeof (item as { type?: unknown }).type === "string"
          ) visit(item as Node);
        }
      } else if (typeof (val as { type?: unknown }).type === "string") {
        visit(val as Node);
      }
    }
  }
  visit(root);
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
  let ordered: readonly SourceEdit[] = edits;
  if (edits.length > 1) {
    let is_sorted = true;
    let prev = edits[0];
    let prev_start = prev.kind === "insert" ? prev.at : prev.start;
    for (let i = 1; i < edits.length; i += 1) {
      const cur = edits[i];
      const cur_start = cur.kind === "insert" ? cur.at : cur.start;
      if (
        cur_start < prev_start ||
        (cur_start === prev_start && cur.kind === "insert" &&
          prev.kind !== "insert")
      ) {
        is_sorted = false;
        break;
      }
      prev = cur;
      prev_start = cur_start;
    }
    if (!is_sorted) {
      ordered = [...edits].sort((left, right) => {
        const left_start = left.kind === "insert" ? left.at : left.start;
        const right_start = right.kind === "insert" ? right.at : right.start;
        if (left_start !== right_start) return left_start - right_start;
        if (left.kind === "insert" && right.kind !== "insert") return -1;
        if (left.kind !== "insert" && right.kind === "insert") return 1;
        return 0;
      });
    }
  }

  const base = source_map ? basename(file_name) : "";
  const lookup_meta = position_lookup !== undefined
    ? position_lookup_meta.get(position_lookup)
    : undefined;
  const reused_meta = lookup_meta !== undefined && lookup_meta.source === source
    ? lookup_meta
    : undefined;
  const has_non_lf = reused_meta !== undefined
    ? reused_meta.non_lf
    : (source.includes("\r") || source.includes("\u2028") ||
      source.includes("\u2029"));
  let cached_starts: readonly number[] | undefined = reused_meta?.starts;
  let fast_locator: FastSourceLocator | undefined = reused_meta?.locator;
  let position = position_lookup;
  function get_locator(): FastSourceLocator {
    if (fast_locator === undefined) {
      cached_starts ??= build_line_starts(source, has_non_lf);
      fast_locator = create_locator_from_starts(cached_starts);
    }
    return fast_locator;
  }
  function get_position(): PositionLookup {
    if (position === undefined) {
      const loc = get_locator();
      position = (offset: number) => {
        loc.lookup(offset);
        return { line: loc.line, column: loc.column };
      };
    }
    return position;
  }
  if (source_map) get_locator();

  const code_chunks: string[] = [];
  const mapping_parts: string[] = [];
  const names: string[] = [];
  const name_indices = new Map<string, number>();

  let out_name = 0;

  const fast_sink: FastPrintSink = {
    source_map,
    locator: fast_locator,
    emit_segment(abs_gen_col, abs_orig_line, abs_orig_col) {
      emit_segment(abs_gen_col, abs_orig_line, abs_orig_col);
    },
    emit_newline,
    gen_col: 0,
    out_gen_col: 0,
    out_orig_line: 0,
    out_orig_col: 0,
    line_has_seg: false,
    code_chunks,
    mapping_parts,
    has_non_lf,
  };

  function emit_newline(): void {
    mapping_parts.push(";");
    fast_sink.gen_col = 0;
    fast_sink.out_gen_col = 0;
    fast_sink.line_has_seg = false;
  }

  function emit_segment(
    abs_gen_col: number,
    abs_orig_line: number,
    abs_orig_col: number,
    abs_name?: number,
  ): void {
    let segment = (fast_sink.line_has_seg ? "," : "") +
      encode_vlq(abs_gen_col - fast_sink.out_gen_col) +
      "A" +
      encode_vlq(abs_orig_line - fast_sink.out_orig_line) +
      encode_vlq(abs_orig_col - fast_sink.out_orig_col);
    if (abs_name !== undefined) {
      segment += encode_vlq(abs_name - out_name);
      out_name = abs_name;
    }
    mapping_parts.push(segment);
    fast_sink.out_gen_col = abs_gen_col;
    fast_sink.out_orig_line = abs_orig_line;
    fast_sink.out_orig_col = abs_orig_col;
    fast_sink.line_has_seg = true;
  }

  function emit_unmapped_segment(abs_gen_col: number): void {
    mapping_parts.push(
      (fast_sink.line_has_seg ? "," : "") +
        encode_vlq(abs_gen_col - fast_sink.out_gen_col),
    );
    fast_sink.out_gen_col = abs_gen_col;
    fast_sink.line_has_seg = true;
  }

  function emit_plain_text(text: string): void {
    if (text.length === 0) return;
    code_chunks.push(text);
    if (!source_map) return;
    let index = text.indexOf("\n");
    if (index < 0) {
      fast_sink.gen_col += text.length;
      return;
    }
    let last = 0;
    while (index >= 0) {
      emit_newline();
      last = index + 1;
      index = text.indexOf("\n", last);
    }
    fast_sink.gen_col = text.length - last;
  }

  function emit_untouched(start: number, end: number): void {
    if (end <= start) return;
    const raw = source.slice(start, end);
    const text = has_non_lf ? raw.replace(/\r\n|\r|\u2028|\u2029/g, "\n") : raw;
    code_chunks.push(text);
    if (!source_map) return;

    fast_locator!.lookup(start);
    let orig_line = fast_locator!.line - 1;
    const orig_col = fast_locator!.column;

    if (!has_non_lf && cached_starts !== undefined) {
      const starts = cached_starts;
      const next_line_start = starts[orig_line + 1];
      if (next_line_start === undefined || end < next_line_start) {
        emit_segment(fast_sink.gen_col, orig_line, orig_col);
        fast_sink.gen_col += end - start;
        return;
      }
      if (next_line_start - 1 > start) {
        emit_segment(fast_sink.gen_col, orig_line, orig_col);
      }
      emit_newline();
      fast_locator!.lookup(end);
      const end_line = fast_locator!.line - 1;
      const end_col = fast_locator!.column;
      orig_line += 1;

      if (orig_line < end_line && fast_sink.out_orig_col !== 0) {
        while (orig_line < end_line) {
          if (starts[orig_line + 1] - starts[orig_line] > 1) {
            emit_segment(0, orig_line, 0);
            emit_newline();
            orig_line += 1;
            break;
          }
          emit_newline();
          orig_line += 1;
        }
      }

      if (orig_line < end_line) {
        let cur_orig_line = fast_sink.out_orig_line;
        let aaca_run = 0;
        let buf = "";
        while (orig_line < end_line) {
          if (starts[orig_line + 1] - starts[orig_line] > 1) {
            const d_line = orig_line - cur_orig_line;
            if (d_line === 1) {
              aaca_run += 1;
              cur_orig_line = orig_line;
              orig_line += 1;
              continue;
            }
            if (aaca_run > 0) {
              while (aaca_run >= 64) {
                buf += AACA_RUNS[64];
                aaca_run -= 64;
              }
              if (aaca_run > 0) {
                buf += AACA_RUNS[aaca_run];
                aaca_run = 0;
              }
            }
            if (d_line === 2) {
              buf += "AAEA;";
            } else if (d_line === 3) {
              buf += "AAGA;";
            } else {
              buf += "AA" + encode_vlq(d_line) + "A;";
            }
            cur_orig_line = orig_line;
            orig_line += 1;
          } else {
            if (aaca_run > 0) {
              while (aaca_run >= 64) {
                buf += AACA_RUNS[64];
                aaca_run -= 64;
              }
              if (aaca_run > 0) {
                buf += AACA_RUNS[aaca_run];
                aaca_run = 0;
              }
            }
            const next_line = orig_line + 1;
            if (
              next_line < end_line &&
              starts[next_line + 1] - starts[next_line] > 1 &&
              next_line - cur_orig_line === 2
            ) {
              buf += ";AAEA;";
              cur_orig_line = next_line;
              orig_line = next_line + 1;
            } else {
              buf += ";";
              orig_line = next_line;
            }
          }
          if (buf.length >= 8192) {
            mapping_parts.push(buf);
            buf = "";
          }
        }
        if (aaca_run > 0) {
          while (aaca_run >= 64) {
            buf += AACA_RUNS[64];
            aaca_run -= 64;
          }
          if (aaca_run > 0) buf += AACA_RUNS[aaca_run];
        }
        if (buf.length > 0) mapping_parts.push(buf);
        fast_sink.out_orig_line = cur_orig_line;
        fast_sink.gen_col = 0;
        fast_sink.out_gen_col = 0;
        fast_sink.line_has_seg = false;
      }

      if (end_col > 0) {
        if (fast_sink.out_orig_col === 0) {
          const d_line = end_line - fast_sink.out_orig_line;
          if (d_line === 1) {
            mapping_parts.push("AACA");
          } else if (d_line === 2) {
            mapping_parts.push("AAEA");
          } else {
            mapping_parts.push("AA" + encode_vlq(d_line) + "A");
          }
          fast_sink.out_orig_line = end_line;
          fast_sink.line_has_seg = true;
        } else {
          emit_segment(0, end_line, 0);
        }
        fast_sink.gen_col = end_col;
      }
      return;
    }

    let cursor = 0;
    let nl = text.indexOf("\n");
    if (nl < 0) {
      emit_segment(fast_sink.gen_col, orig_line, orig_col);
      fast_sink.gen_col += text.length;
      return;
    }
    if (nl > 0) {
      emit_segment(fast_sink.gen_col, orig_line, orig_col);
    }
    emit_newline();
    cursor = nl + 1;
    orig_line += 1;

    let aaca_run = 0;
    const flush_aaca = () => {
      if (aaca_run > 0) {
        while (aaca_run >= 64) {
          mapping_parts.push(AACA_RUNS[64]);
          aaca_run -= 64;
        }
        if (aaca_run > 0) {
          mapping_parts.push(AACA_RUNS[aaca_run]);
          aaca_run = 0;
        }
      }
    };
    while (cursor < text.length) {
      nl = text.indexOf("\n", cursor);
      if (nl < 0) {
        flush_aaca();
        if (
          fast_sink.out_orig_col === 0 &&
          orig_line === fast_sink.out_orig_line + 1
        ) {
          mapping_parts.push("AACA");
          fast_sink.out_orig_line = orig_line;
          fast_sink.line_has_seg = true;
        } else {
          emit_segment(0, orig_line, 0);
        }
        fast_sink.gen_col = text.length - cursor;
        return;
      }
      if (
        nl > cursor && fast_sink.out_orig_col === 0 &&
        orig_line === fast_sink.out_orig_line + 1
      ) {
        aaca_run += 1;
        fast_sink.out_orig_line = orig_line;
        fast_sink.gen_col = 0;
        fast_sink.out_gen_col = 0;
        fast_sink.line_has_seg = false;
        cursor = nl + 1;
        orig_line += 1;
        continue;
      }
      flush_aaca();
      if (nl > cursor) {
        emit_segment(0, orig_line, 0);
      }
      emit_newline();
      cursor = nl + 1;
      orig_line += 1;
    }
    flush_aaca();
  }

  function stitch_edit_map(
    edit_code: string,
    edit_mappings: string,
    edit_names: readonly string[],
  ): void {
    const start_col = fast_sink.gen_col;
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
        fast_sink.gen_col = col_offset + (edit_code.length - text_cursor);
        break;
      }
      text_cursor = nl + 1;
      line_idx += 1;
    }
  }

  function print_node(
    target: Node,
    edit_comments: readonly CommentWithLoc[],
  ) {
    if (edit_comments.length === 0) {
      const language = lang === "tsx"
        ? (source_map ? cached_tsx_map : cached_tsx_nomap)
        : (source_map ? cached_ts_map : cached_ts_nomap);
      if (!source_map) {
        return print(target, language, { indent: "  " });
      }
      return print(target, language, {
        indent: "  ",
        sourceMapSource: base,
      });
    }
    const entry = lang === "tsx"
      ? (source_map
        ? (commented_tsx_map ??= make_commented_language(true, true))
        : (commented_tsx_nomap ??= make_commented_language(true, false)))
      : (source_map
        ? (commented_ts_map ??= make_commented_language(false, true))
        : (commented_ts_nomap ??= make_commented_language(false, false)));
    const buf = entry.comments;
    buf.length = 0;
    for (let i = 0; i < edit_comments.length; i += 1) {
      buf.push(edit_comments[i]);
    }
    try {
      // Reset esrap's closed-over comment_index back to 0 without recreating
      // the ~150-visitor language table.
      print(
        RESET_COMMENT_PROGRAM,
        entry.language,
        {
          sourceMapEncodeMappings: false,
        } as Parameters<typeof print>[2],
      );
      if (!source_map) {
        return print(target, entry.language, { indent: "  " });
      }
      return print(target, entry.language, {
        indent: "  ",
        sourceMapSource: base,
      });
    } finally {
      buf.length = 0;
    }
  }

  const comment_count = comments.length;
  let comment_cursor = 0;

  function next_comments_in_range(
    start: number,
    end: number,
  ): readonly CommentWithLoc[] {
    if (comment_count === 0 || end <= start) return EMPTY_COMMENTS;
    while (
      comment_cursor < comment_count && comments[comment_cursor].start < start
    ) {
      comment_cursor += 1;
    }
    if (
      comment_cursor >= comment_count || comments[comment_cursor].start >= end
    ) {
      return EMPTY_COMMENTS;
    }
    let result: CommentWithLoc[] | undefined;
    let idx = comment_cursor;
    let pos_fn: PositionLookup | undefined;
    while (idx < comment_count) {
      const comment = comments[idx];
      if (comment.start >= end) break;
      if (comment.end <= end) {
        pos_fn ??= get_position();
        result ??= [];
        result.push({
          ...comment,
          loc: { start: pos_fn(comment.start), end: pos_fn(comment.end) },
        });
      }
      idx += 1;
    }
    comment_cursor = idx;
    return result ?? EMPTY_COMMENTS;
  }

  let cursor = 0;
  for (let edit_idx = 0; edit_idx < ordered.length; edit_idx += 1) {
    const edit = ordered[edit_idx];
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
      if (edit.prefix) emit_plain_text(edit.prefix);
      if (!try_print_fast(prog, fast_sink, lang, "program")) {
        if (source_map) attach_locations(prog, get_position(), false);
        const printed = print_node(prog, EMPTY_COMMENTS);
        code_chunks.push(printed.code);
        if (source_map) {
          stitch_edit_map(
            printed.code,
            printed.map.mappings,
            printed.map.names,
          );
        }
      }
      if (edit.suffix) emit_plain_text(edit.suffix);
      cursor = edit.at;
      continue;
    }
    const edit_comments = comment_count === 0
      ? EMPTY_COMMENTS
      : next_comments_in_range(edit.start, edit.end);
    const is_stmts = edit.kind === "replace_statements";
    const target = is_stmts ? synthetic_program(edit.statements) : edit.node;
    const print_mode = is_stmts
      ? "program"
      : edit.is_expression === true
      ? "expression"
      : undefined;
    if (edit_comments.length === 0) {
      const fast_wrap = !is_stmts &&
        edit.is_expression === true &&
        !safe_unwrapped_expressions.has(edit.node.type);
      if (fast_wrap) emit_plain_text("(");
      if (try_print_fast(target, fast_sink, lang, print_mode)) {
        if (fast_wrap) emit_plain_text(")");
        cursor = edit.end;
        continue;
      }
      if (fast_wrap) {
        code_chunks.pop();
        if (source_map) fast_sink.gen_col -= 1;
      }
    }
    if (source_map || edit_comments.length > 0) {
      attach_locations(target, get_position(), edit_comments.length > 0);
    }
    const printed = print_node(target, edit_comments);
    let wrap = false;
    if (!is_stmts && edit.is_expression) {
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
