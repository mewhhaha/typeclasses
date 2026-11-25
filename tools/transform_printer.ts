import type {
  ArrowFunctionExpression,
  BindingPattern,
  CallExpression,
  Expression,
  Function as FunctionNode,
  IdentifierReference,
  ImportDeclaration,
  MemberExpression,
  NewExpression,
  Node,
  ObjectExpression,
  ObjectProperty,
  ParamPattern,
  Program,
  Statement,
  TSType,
  TSTypeParameterDeclaration,
  TSTypeParameterInstantiation,
  VariableDeclaration,
} from "oxc-parser";

/** Zero-allocation line/column locator interface shared with transform_splice. */
export type FastSourceLocator = {
  line: number;
  column: number;
  lookup(offset: number): void;
};

/** Direct output sink passed by splice_edits so fast printing emits final VLQ inline. */
export type FastPrintSink = {
  readonly source_map: boolean;
  readonly locator: FastSourceLocator | undefined;
  readonly emit_segment: (
    abs_gen_col: number,
    abs_orig_line: number,
    abs_orig_col: number,
  ) => void;
  readonly emit_newline: () => void;
  get_gen_col(): number;
  set_gen_col(col: number): void;
  get_line_has_seg(): boolean;
  get_out_orig_line(): number;
  get_out_orig_col(): number;
  get_out_gen_col(): number;
  push_code(text: string): void;
};

const BAIL = {};

const INDENTS = [
  "",
  "  ",
  "    ",
  "      ",
  "        ",
  "          ",
  "            ",
  "              ",
  "                ",
  "                  ",
  "                    ",
];

function indent_str(depth: number): string {
  if (depth < INDENTS.length) return INDENTS[depth];
  return "  ".repeat(depth);
}

function binary_prec(op: string): number {
  switch (op) {
    case "??":
      return 2;
    case "||":
      return 3;
    case "&&":
      return 4;
    case "|":
      return 5;
    case "^":
      return 6;
    case "&":
      return 7;
    case "==":
    case "!=":
    case "===":
    case "!==":
      return 8;
    case "<":
    case "<=":
    case ">":
    case ">=":
    case "in":
    case "instanceof":
      return 9;
    case "<<":
    case ">>":
    case ">>>":
      return 10;
    case "+":
    case "-":
      return 11;
    case "*":
    case "/":
    case "%":
      return 12;
    case "**":
      return 13;
    default:
      return 0;
  }
}

function expr_prec(expr: Expression): number {
  switch (expr.type) {
    case "SequenceExpression":
      return 0;
    case "YieldExpression":
    case "ArrowFunctionExpression":
    case "AssignmentExpression":
    case "ConditionalExpression":
      return 1;
    case "TSAsExpression":
    case "TSSatisfiesExpression":
      return 1.5;
    case "LogicalExpression":
    case "BinaryExpression":
      return binary_prec(expr.operator);
    case "UnaryExpression":
    case "AwaitExpression":
      return 14;
    case "UpdateExpression":
      return expr.prefix ? 14 : 15;
    case "TSNonNullExpression":
    case "TSInstantiationExpression":
      return 16;
    case "CallExpression":
    case "MemberExpression":
    case "NewExpression":
    case "ChainExpression":
    case "TaggedTemplateExpression":
      return 17;
    default:
      return 18;
  }
}

function starts_with_brace_or_keyword(expr: Expression): boolean {
  let cur: Expression = expr;
  while (true) {
    switch (cur.type) {
      case "ObjectExpression":
      case "FunctionExpression":
      case "ClassExpression":
        return true;
      case "SequenceExpression":
        cur = cur.expressions[0];
        continue;
      case "AssignmentExpression":
        if (cur.left.type === "ObjectPattern") return true;
        if (
          cur.left.type === "Identifier" || cur.left.type === "MemberExpression"
        ) {
          cur = cur.left as Expression;
          continue;
        }
        return false;
      case "BinaryExpression":
      case "LogicalExpression":
        if (cur.left.type === "PrivateIdentifier") return false;
        cur = cur.left;
        continue;
      case "ConditionalExpression":
        cur = cur.test;
        continue;
      case "MemberExpression":
        if (
          cur.computed && cur.object.type === "Identifier" &&
          cur.object.name === "let"
        ) return true;
        cur = cur.object;
        continue;
      case "CallExpression":
        cur = cur.callee as Expression;
        continue;
      case "ChainExpression":
        cur = cur.expression as Expression;
        continue;
      case "TaggedTemplateExpression":
        cur = cur.tag;
        continue;
      case "UpdateExpression":
        if (cur.prefix) return false;
        cur = cur.argument as Expression;
        continue;
      case "TSAsExpression":
      case "TSSatisfiesExpression":
      case "TSNonNullExpression":
      case "TSInstantiationExpression":
        cur = cur.expression;
        continue;
      default:
        return false;
    }
  }
}

function starts_with_object_or_seq(expr: Expression): boolean {
  if (expr.type === "SequenceExpression") return true;
  let cur: Expression = expr;
  while (true) {
    switch (cur.type) {
      case "ObjectExpression":
        return true;
      case "BinaryExpression":
      case "LogicalExpression":
        if (cur.left.type === "PrivateIdentifier") return false;
        cur = cur.left;
        continue;
      case "ConditionalExpression":
        cur = cur.test;
        continue;
      case "MemberExpression":
        cur = cur.object;
        continue;
      case "CallExpression":
        cur = cur.callee as Expression;
        continue;
      case "ChainExpression":
        cur = cur.expression as Expression;
        continue;
      case "TaggedTemplateExpression":
        cur = cur.tag;
        continue;
      case "TSAsExpression":
      case "TSSatisfiesExpression":
      case "TSNonNullExpression":
      case "TSInstantiationExpression":
        cur = cur.expression;
        continue;
      default:
        return false;
    }
  }
}

function ends_with_dangling_if(stmt: Statement): boolean {
  let cur: Statement = stmt;
  while (true) {
    if (cur.type === "IfStatement") {
      if (cur.alternate === null) return true;
      cur = cur.alternate;
      continue;
    }
    if (
      cur.type === "ForStatement" || cur.type === "ForOfStatement" ||
      cur.type === "ForInStatement" || cur.type === "WhileStatement" ||
      cur.type === "LabeledStatement"
    ) {
      cur = cur.body;
      continue;
    }
    return false;
  }
}

function callee_has_call(expr: Expression): boolean {
  let cur: Expression = expr;
  while (true) {
    if (cur.type === "CallExpression") return true;
    if (cur.type === "MemberExpression") {
      cur = cur.object;
      continue;
    }
    if (cur.type === "ChainExpression") {
      cur = cur.expression as Expression;
      continue;
    }
    return false;
  }
}

function needs_type_parens_in_array_or_index(t: TSType): boolean {
  switch (t.type) {
    case "TSUnionType":
    case "TSIntersectionType":
    case "TSFunctionType":
    case "TSConstructorType":
    case "TSTypeOperator":
    case "TSConditionalType":
    case "TSInferType":
    case "TSTypePredicate":
      return true;
    default:
      return false;
  }
}

/**
 * Fast direct TypeScript/JavaScript AST printer with inline V3 source map emission.
 * Returns true if printed directly into `sink`, or false (leaving `sink` untouched
 * after caller rollback) if an unsupported AST construct requires esrap fallback.
 */
export function try_print_fast(
  root: Node,
  sink: FastPrintSink,
  lang: "ts" | "tsx",
): boolean {
  const source_map = sink.source_map;
  const locator = sink.locator;
  let buf = "";
  let col = sink.get_gen_col();
  let depth = 0;

  function write(text: string): void {
    buf += text;
    col += text.length;
  }

  function write_nl(): void {
    buf += "\n";
    if (source_map) sink.emit_newline();
    col = 0;
  }

  function write_indent(): void {
    const s = indent_str(depth);
    if (s.length > 0) {
      buf += s;
      col += s.length;
    }
  }

  function write_multiline(text: string): void {
    if (
      text.includes("\r") || text.includes("\u2028") || text.includes("\u2029")
    ) throw BAIL;
    buf += text;
    const nl = text.indexOf("\n");
    if (nl < 0) {
      col += text.length;
      return;
    }
    if (!source_map) {
      const last = text.lastIndexOf("\n");
      col = text.length - last - 1;
      return;
    }
    let pos = nl;
    let last = 0;
    while (pos >= 0) {
      sink.emit_newline();
      last = pos + 1;
      pos = text.indexOf("\n", last);
    }
    col = text.length - last;
  }

  function mark(n: Node): void {
    if (!source_map || n.start < 0 || locator === undefined) return;
    locator.lookup(n.start);
    const orig_line = locator.line - 1;
    const orig_col = locator.column;
    if (
      !sink.get_line_has_seg() ||
      col !== sink.get_out_gen_col() ||
      orig_line !== sink.get_out_orig_line() ||
      orig_col !== sink.get_out_orig_col()
    ) {
      sink.emit_segment(col, orig_line, orig_col);
    }
  }

  function print_type_params_decl(
    decl: TSTypeParameterDeclaration | null | undefined,
  ): void {
    if (decl == null) return;
    write("<");
    const params = decl.params;
    for (let i = 0; i < params.length; i += 1) {
      if (i > 0) write(", ");
      const p = params[i];
      if (p.const) write("const ");
      if (p.in) write("in ");
      if (p.out) write("out ");
      mark(p);
      write(p.name.name);
      if (p.constraint != null) {
        write(" extends ");
        print_type(p.constraint);
      }
      if (p.default != null) {
        write(" = ");
        print_type(p.default);
      }
    }
    if (
      lang === "tsx" && params.length === 1 && params[0].constraint == null &&
      params[0].default == null
    ) {
      write(",");
    }
    write(">");
  }

  function print_type_args(
    inst: TSTypeParameterInstantiation | null | undefined,
  ): void {
    if (inst == null) return;
    write("<");
    const params = inst.params;
    for (let i = 0; i < params.length; i += 1) {
      if (i > 0) write(", ");
      print_type(params[i]);
    }
    write(">");
  }

  function print_type_name(name: Node): void {
    if (name.type === "Identifier") {
      mark(name);
      write(name.name);
      return;
    }
    if (name.type === "TSQualifiedName") {
      print_type_name(name.left);
      write(".");
      mark(name.right);
      write(name.right.name);
      return;
    }
    throw BAIL;
  }

  function print_type(t: TSType): void {
    mark(t);
    switch (t.type) {
      case "TSAnyKeyword":
        write("any");
        return;
      case "TSUnknownKeyword":
        write("unknown");
        return;
      case "TSNumberKeyword":
        write("number");
        return;
      case "TSStringKeyword":
        write("string");
        return;
      case "TSBooleanKeyword":
        write("boolean");
        return;
      case "TSVoidKeyword":
        write("void");
        return;
      case "TSUndefinedKeyword":
        write("undefined");
        return;
      case "TSNullKeyword":
        write("null");
        return;
      case "TSNeverKeyword":
        write("never");
        return;
      case "TSObjectKeyword":
        write("object");
        return;
      case "TSSymbolKeyword":
        write("symbol");
        return;
      case "TSBigIntKeyword":
        write("bigint");
        return;
      case "TSTypeReference":
        print_type_name(t.typeName);
        print_type_args(t.typeArguments);
        return;
      case "TSTypeQuery":
        write("typeof ");
        print_type_name(t.exprName);
        print_type_args(t.typeArguments);
        return;
      case "TSArrayType": {
        const wrap = needs_type_parens_in_array_or_index(t.elementType);
        if (wrap) write("(");
        print_type(t.elementType);
        if (wrap) write(")");
        write("[]");
        return;
      }
      case "TSTupleType": {
        const print_tuple_el = (el: typeof t.elementTypes[number]): void => {
          if (el.type === "TSNamedTupleMember") {
            mark(el);
            write(el.label.name);
            if (el.optional) write("?");
            write(": ");
            print_tuple_el(el.elementType);
          } else if (el.type === "TSOptionalType") {
            const wrap = needs_type_parens_in_array_or_index(el.typeAnnotation);
            if (wrap) write("(");
            print_type(el.typeAnnotation);
            if (wrap) write(")");
            write("?");
          } else if (el.type === "TSRestType") {
            write("...");
            print_type(el.typeAnnotation);
          } else {
            print_type(el);
          }
        };
        write("[");
        const els = t.elementTypes;
        for (let i = 0; i < els.length; i += 1) {
          if (i > 0) write(", ");
          print_tuple_el(els[i]);
        }
        write("]");
        return;
      }
      case "TSUnionType": {
        const types = t.types;
        for (let i = 0; i < types.length; i += 1) {
          if (i > 0) write(" | ");
          const item = types[i];
          const wrap = item.type === "TSFunctionType" ||
            item.type === "TSConstructorType" ||
            item.type === "TSConditionalType" ||
            item.type === "TSIntersectionType";
          if (wrap) write("(");
          print_type(item);
          if (wrap) write(")");
        }
        return;
      }
      case "TSIntersectionType": {
        const types = t.types;
        for (let i = 0; i < types.length; i += 1) {
          if (i > 0) write(" & ");
          const item = types[i];
          const wrap = item.type === "TSFunctionType" ||
            item.type === "TSConstructorType" ||
            item.type === "TSConditionalType" ||
            item.type === "TSUnionType";
          if (wrap) write("(");
          print_type(item);
          if (wrap) write(")");
        }
        return;
      }
      case "TSParenthesizedType":
        write("(");
        print_type(t.typeAnnotation);
        write(")");
        return;
      case "TSTypeLiteral": {
        const members = t.members;
        if (members.length === 0) {
          write("{}");
          return;
        }
        write("{ ");
        for (let i = 0; i < members.length; i += 1) {
          if (i > 0) write("; ");
          const m = members[i];
          if (m.type === "TSPropertySignature") {
            if (m.accessibility != null || m.static) throw BAIL;
            mark(m);
            if (m.readonly) write("readonly ");
            if (m.computed) {
              write("[");
              print_expr(m.key as Expression, 0, false);
              write("]");
            } else {
              print_prop_key(m.key);
            }
            if (m.optional) write("?");
            if (m.typeAnnotation != null) {
              write(": ");
              print_type(m.typeAnnotation.typeAnnotation);
            }
          } else if (m.type === "TSIndexSignature") {
            mark(m);
            if (m.readonly) write("readonly ");
            write("[");
            const p = m.parameters[0];
            if (p === undefined) throw BAIL;
            print_pattern(p as unknown as ParamPattern);
            write("]");
            if (m.typeAnnotation != null) {
              write(": ");
              print_type(m.typeAnnotation.typeAnnotation);
            }
          } else {
            throw BAIL;
          }
        }
        write(" }");
        return;
      }
      case "TSFunctionType": {
        print_type_params_decl(t.typeParameters);
        write("(");
        print_params(t.params);
        write(") => ");
        print_type(t.returnType.typeAnnotation);
        return;
      }
      case "TSLiteralType": {
        const lit = t.literal;
        if (lit.type === "Literal") print_literal(lit);
        else if (lit.type === "UnaryExpression") print_expr(lit, 0, false);
        else if (lit.type === "TemplateLiteral") print_expr(lit, 0, false);
        else throw BAIL;
        return;
      }
      case "TSIndexedAccessType": {
        const wrap = needs_type_parens_in_array_or_index(t.objectType);
        if (wrap) write("(");
        print_type(t.objectType);
        if (wrap) write(")");
        write("[");
        print_type(t.indexType);
        write("]");
        return;
      }
      case "TSTypeOperator": {
        write(t.operator + " ");
        const wrap = needs_type_parens_in_array_or_index(t.typeAnnotation);
        if (wrap) write("(");
        print_type(t.typeAnnotation);
        if (wrap) write(")");
        return;
      }
      case "TSTypePredicate": {
        if (t.asserts) write("asserts ");
        if (t.parameterName.type === "Identifier") {
          write(t.parameterName.name);
        } else if (t.parameterName.type === "TSThisType") {
          write("this");
        } else {
          throw BAIL;
        }
        if (t.typeAnnotation != null) {
          write(" is ");
          print_type(t.typeAnnotation.typeAnnotation);
        }
        return;
      }
      default:
        throw BAIL;
    }
  }

  function print_prop_key(key: Node): void {
    if (key.type === "Identifier") {
      mark(key);
      write(key.name);
      return;
    }
    if (key.type === "Literal") {
      print_literal(key);
      return;
    }
    throw BAIL;
  }

  function print_literal(
    lit: Extract<Expression, { type: "Literal" }>,
  ): void {
    mark(lit);
    if (lit.raw != null) {
      write_multiline(lit.raw);
      return;
    }
    const v = lit.value;
    if (typeof v === "string") {
      write(JSON.stringify(v));
    } else if (typeof v === "number") {
      write(Object.is(v, -0) ? "-0" : String(v));
    } else if (typeof v === "boolean") {
      write(v ? "true" : "false");
    } else if (v === null) {
      write("null");
    } else if (typeof v === "bigint") {
      write(v.toString() + "n");
    } else if ("regex" in lit && lit.regex != null) {
      write("/" + lit.regex.pattern + "/" + lit.regex.flags);
    } else {
      throw BAIL;
    }
  }

  function print_pattern(pat: BindingPattern | ParamPattern): void {
    mark(pat);
    switch (pat.type) {
      case "Identifier": {
        if (pat.decorators !== undefined && pat.decorators.length > 0) {
          throw BAIL;
        }
        write(pat.name);
        if (pat.optional) write("?");
        if (pat.typeAnnotation != null) {
          write(": ");
          print_type(pat.typeAnnotation.typeAnnotation);
        }
        return;
      }
      case "RestElement": {
        if (pat.decorators !== undefined && pat.decorators.length > 0) {
          throw BAIL;
        }
        write("...");
        print_pattern(pat.argument);
        if (pat.typeAnnotation != null) {
          write(": ");
          print_type(pat.typeAnnotation.typeAnnotation);
        }
        return;
      }
      case "AssignmentPattern": {
        print_pattern(pat.left);
        write(" = ");
        print_expr(pat.right, 1, false);
        return;
      }
      case "ObjectPattern": {
        write("{");
        const props = pat.properties;
        if (props.length > 0) write(" ");
        for (let i = 0; i < props.length; i += 1) {
          if (i > 0) write(", ");
          const prop = props[i];
          if (prop.type === "RestElement") {
            print_pattern(prop);
          } else {
            mark(prop);
            if (prop.shorthand) {
              print_pattern(prop.value);
            } else {
              if (prop.computed) {
                write("[");
                print_expr(prop.key as Expression, 0, false);
                write("]");
              } else {
                print_prop_key(prop.key);
              }
              write(": ");
              print_pattern(prop.value);
            }
          }
        }
        if (props.length > 0) write(" ");
        write("}");
        if (pat.optional) write("?");
        if (pat.typeAnnotation != null) {
          write(": ");
          print_type(pat.typeAnnotation.typeAnnotation);
        }
        return;
      }
      case "ArrayPattern": {
        write("[");
        const els = pat.elements;
        for (let i = 0; i < els.length; i += 1) {
          if (i > 0) write(", ");
          const el = els[i];
          if (el !== null) print_pattern(el);
        }
        if (els.length > 0 && els[els.length - 1] === null) write(",");
        write("]");
        if (pat.optional) write("?");
        if (pat.typeAnnotation != null) {
          write(": ");
          print_type(pat.typeAnnotation.typeAnnotation);
        }
        return;
      }
      default:
        throw BAIL;
    }
  }

  function print_params(params: readonly ParamPattern[]): void {
    for (let i = 0; i < params.length; i += 1) {
      if (i > 0) write(", ");
      print_pattern(params[i]);
    }
  }

  function print_args(
    args: readonly (Expression | Extract<Node, { type: "SpreadElement" }>)[],
  ): void {
    write("(");
    for (let i = 0; i < args.length; i += 1) {
      if (i > 0) write(", ");
      const arg = args[i];
      if (arg.type === "SpreadElement") {
        mark(arg);
        write("...");
        print_expr(arg.argument, 1, false);
      } else {
        print_expr(arg, 1, false);
      }
    }
    write(")");
  }

  function print_expr(
    expr: Expression,
    min_prec: number,
    no_in: boolean,
  ): void {
    const prec = expr_prec(expr);
    const wrap = prec < min_prec ||
      (no_in && expr.type === "BinaryExpression" && expr.operator === "in");
    if (wrap) write("(");
    mark(expr);
    switch (expr.type) {
      case "Identifier":
        write(expr.name);
        break;
      case "Literal":
        print_literal(expr);
        break;
      case "ThisExpression":
        write("this");
        break;
      case "Super":
        write("super");
        break;
      case "MetaProperty":
        write(expr.meta.name + "." + expr.property.name);
        break;
      case "ParenthesizedExpression":
        write("(");
        print_expr(expr.expression, 0, false);
        write(")");
        break;
      case "TemplateLiteral": {
        write("`");
        const quasis = expr.quasis;
        const exprs = expr.expressions;
        for (let i = 0; i < quasis.length; i += 1) {
          write_multiline(quasis[i].value.raw);
          if (i < exprs.length) {
            write("${");
            print_expr(exprs[i], 0, false);
            write("}");
          }
        }
        write("`");
        break;
      }
      case "TaggedTemplateExpression": {
        const tag = expr.tag;
        const need_p = expr_prec(tag) < 17;
        if (need_p) write("(");
        print_expr(tag, 0, false);
        if (need_p) write(")");
        print_type_args(expr.typeArguments);
        print_expr(expr.quasi, 0, false);
        break;
      }
      case "ArrayExpression": {
        write("[");
        const els = expr.elements;
        for (let i = 0; i < els.length; i += 1) {
          if (i > 0) write(", ");
          const el = els[i];
          if (el === null) continue;
          if (el.type === "SpreadElement") {
            mark(el);
            write("...");
            print_expr(el.argument, 1, false);
          } else {
            print_expr(el, 1, false);
          }
        }
        if (els.length > 0 && els[els.length - 1] === null) write(",");
        write("]");
        break;
      }
      case "ObjectExpression": {
        const props = (expr as ObjectExpression).properties;
        if (props.length === 0) {
          write("{}");
          break;
        }
        write("{ ");
        for (let i = 0; i < props.length; i += 1) {
          if (i > 0) write(", ");
          const prop = props[i];
          if (prop.type === "SpreadElement") {
            mark(prop);
            write("...");
            print_expr(prop.argument, 1, false);
          } else {
            const p = prop as ObjectProperty;
            if (p.kind !== "init" || p.method) throw BAIL;
            mark(p);
            if (p.shorthand) {
              print_expr(p.value as Expression, 1, false);
            } else {
              if (p.computed) {
                write("[");
                print_expr(p.key as Expression, 0, false);
                write("]");
              } else {
                print_prop_key(p.key);
              }
              write(": ");
              print_expr(p.value as Expression, 1, false);
            }
          }
        }
        write(" }");
        break;
      }
      case "MemberExpression": {
        const mem = expr as MemberExpression;
        const obj = mem.object;
        const need_num_p = !mem.computed && !mem.optional &&
          obj.type === "Literal" && typeof obj.value === "number";
        if (need_num_p) {
          write("(");
          print_expr(obj, 0, false);
          write(")");
        } else {
          print_expr(obj, 17, false);
        }
        if (mem.optional) write("?.");
        if (mem.computed) {
          write("[");
          print_expr(mem.property as Expression, 0, false);
          write("]");
        } else {
          if (!mem.optional) write(".");
          if (mem.property.type === "Identifier") {
            mark(mem.property);
            write(mem.property.name);
          } else if (mem.property.type === "PrivateIdentifier") {
            mark(mem.property);
            write("#" + mem.property.name);
          } else {
            throw BAIL;
          }
        }
        break;
      }
      case "CallExpression": {
        const c = expr as CallExpression;
        print_expr(c.callee as Expression, 17, false);
        if (c.optional) write("?.");
        print_type_args(c.typeArguments);
        print_args(c.arguments);
        break;
      }
      case "NewExpression": {
        const nw = expr as NewExpression;
        write("new ");
        const callee = nw.callee as Expression;
        const need_p = expr_prec(callee) < 17 || callee_has_call(callee);
        if (need_p) write("(");
        print_expr(callee, 0, false);
        if (need_p) write(")");
        print_type_args(nw.typeArguments);
        print_args(nw.arguments);
        break;
      }
      case "ChainExpression":
        print_expr(expr.expression as Expression, 0, false);
        break;
      case "UnaryExpression": {
        const op = expr.operator;
        const is_word = op === "typeof" || op === "void" || op === "delete";
        write(op);
        if (is_word) {
          write(" ");
        } else if (
          (op === "-" || op === "+") &&
          ((expr.argument.type === "UnaryExpression" &&
            expr.argument.operator === op) ||
            (expr.argument.type === "UpdateExpression" &&
              expr.argument.prefix &&
              expr.argument.operator[0] === op) ||
            (expr.argument.type === "Literal" &&
              typeof expr.argument.value === "number" &&
              expr.argument.value < 0 && op === "-"))
        ) {
          write(" ");
        }
        print_expr(expr.argument, 14, false);
        break;
      }
      case "UpdateExpression": {
        if (expr.prefix) {
          write(expr.operator);
          print_expr(expr.argument as Expression, 16, false);
        } else {
          print_expr(expr.argument as Expression, 16, false);
          write(expr.operator);
        }
        break;
      }
      case "AwaitExpression":
        write("await ");
        print_expr(expr.argument, 14, false);
        break;
      case "YieldExpression":
        write(expr.delegate ? "yield*" : "yield");
        if (expr.argument !== null) {
          write(" ");
          print_expr(expr.argument, 1, no_in);
        }
        break;
      case "BinaryExpression": {
        const op = expr.operator;
        const p = binary_prec(op);
        if (expr.left.type === "PrivateIdentifier") {
          mark(expr.left);
          write("#" + expr.left.name);
        } else if (op === "**") {
          // Unary left operand of ** must be parenthesized (`(-x) ** 2`).
          const left_wrap = expr_prec(expr.left) <= 14;
          if (left_wrap) write("(");
          print_expr(expr.left, 0, no_in);
          if (left_wrap) write(")");
        } else {
          print_expr(expr.left, p, no_in);
        }
        write(" " + op + " ");
        print_expr(expr.right, op === "**" ? p : p + 0.5, no_in);
        break;
      }
      case "LogicalExpression": {
        const op = expr.operator;
        const p = binary_prec(op);
        const mix_left = expr.left.type === "LogicalExpression" &&
          ((op === "??" && expr.left.operator !== "??") ||
            (op !== "??" && expr.left.operator === "??"));
        if (mix_left) {
          write("(");
          print_expr(expr.left, 0, no_in);
          write(")");
        } else {
          print_expr(expr.left, p, no_in);
        }
        write(" " + op + " ");
        const mix_right = expr.right.type === "LogicalExpression" &&
          ((op === "??" && expr.right.operator !== "??") ||
            (op !== "??" && expr.right.operator === "??"));
        if (mix_right) {
          write("(");
          print_expr(expr.right, 0, no_in);
          write(")");
        } else {
          print_expr(expr.right, p + 0.5, no_in);
        }
        break;
      }
      case "ConditionalExpression":
        print_expr(expr.test, 2, no_in);
        write(" ? ");
        print_expr(expr.consequent, 1, false);
        write(" : ");
        print_expr(expr.alternate, 1, no_in);
        break;
      case "AssignmentExpression":
        if (
          expr.left.type === "Identifier" ||
          expr.left.type === "MemberExpression"
        ) {
          print_expr(expr.left as Expression, 17, false);
        } else {
          print_pattern(expr.left as BindingPattern);
        }
        write(" " + expr.operator + " ");
        print_expr(expr.right, 1, no_in);
        break;
      case "SequenceExpression": {
        const list = expr.expressions;
        for (let i = 0; i < list.length; i += 1) {
          if (i > 0) write(", ");
          print_expr(list[i], 1, no_in);
        }
        break;
      }
      case "ArrowFunctionExpression": {
        const fn = expr as ArrowFunctionExpression;
        if (fn.async) write("async ");
        print_type_params_decl(fn.typeParameters);
        write("(");
        print_params(fn.params);
        write(")");
        if (fn.returnType != null) {
          write(": ");
          print_type(fn.returnType.typeAnnotation);
        }
        write(" => ");
        if (fn.body.type === "BlockStatement") {
          print_block(fn.body.body as Statement[]);
        } else {
          const body_expr = fn.body as Expression;
          const need_p = starts_with_object_or_seq(body_expr);
          if (need_p) write("(");
          print_expr(body_expr, 1, no_in);
          if (need_p) write(")");
        }
        break;
      }
      case "FunctionExpression": {
        print_function(expr as FunctionNode);
        break;
      }
      case "TSAsExpression":
        print_expr(expr.expression, 2, no_in);
        write(" as ");
        print_type(expr.typeAnnotation);
        break;
      case "TSSatisfiesExpression":
        print_expr(expr.expression, 2, no_in);
        write(" satisfies ");
        print_type(expr.typeAnnotation);
        break;
      case "TSNonNullExpression":
        print_expr(expr.expression, 16, false);
        write("!");
        break;
      case "TSInstantiationExpression":
        print_expr(expr.expression, 16, false);
        print_type_args(expr.typeArguments);
        break;
      default:
        throw BAIL;
    }
    if (wrap) write(")");
  }

  function print_function(fn: FunctionNode): void {
    if (fn.async) write("async ");
    write(fn.generator ? "function*" : "function");
    if (fn.id !== null) {
      write(" ");
      mark(fn.id);
      write(fn.id.name);
    }
    print_type_params_decl(fn.typeParameters);
    write("(");
    print_params(fn.params);
    write(")");
    if (fn.returnType != null) {
      write(": ");
      print_type(fn.returnType.typeAnnotation);
    }
    write(" ");
    if (fn.body === null) throw BAIL;
    print_block(fn.body.body as Statement[]);
  }

  function print_block(stmts: readonly Statement[]): void {
    if (stmts.length === 0) {
      write("{}");
      return;
    }
    write("{");
    write_nl();
    depth += 1;
    for (let i = 0; i < stmts.length; i += 1) {
      write_indent();
      print_stmt(stmts[i]);
      write_nl();
    }
    depth -= 1;
    write_indent();
    write("}");
  }

  function print_var_decl(
    decl: VariableDeclaration,
    semicolon: boolean,
    no_in: boolean,
  ): void {
    if (decl.declare) throw BAIL;
    mark(decl);
    write(decl.kind + " ");
    const list = decl.declarations;
    for (let i = 0; i < list.length; i += 1) {
      if (i > 0) write(", ");
      const d = list[i];
      mark(d);
      print_pattern(d.id);
      if (d.definite) write("!");
      if (d.init !== null) {
        write(" = ");
        print_expr(d.init, 1, no_in);
      }
    }
    if (semicolon) write(";");
  }

  function print_import_decl(imp: ImportDeclaration): void {
    if (imp.attributes !== undefined && imp.attributes.length > 0) throw BAIL;
    mark(imp);
    write("import ");
    if (imp.importKind === "type") write("type ");
    const specs = imp.specifiers;
    if (specs.length === 0) {
      print_literal(imp.source);
      write(";");
      return;
    }
    let has_default = false;
    let has_ns = false;
    const named: Extract<
      ImportDeclaration["specifiers"][number],
      { type: "ImportSpecifier" }
    >[] = [];
    for (let i = 0; i < specs.length; i += 1) {
      const s = specs[i];
      if (s.type === "ImportDefaultSpecifier") {
        mark(s);
        write(s.local.name);
        has_default = true;
      } else if (s.type === "ImportNamespaceSpecifier") {
        if (has_default) write(", ");
        mark(s);
        write("* as " + s.local.name);
        has_ns = true;
      } else {
        named.push(s);
      }
    }
    if (named.length > 0) {
      if (has_default || has_ns) write(", ");
      write("{ ");
      for (let i = 0; i < named.length; i += 1) {
        if (i > 0) write(", ");
        const s = named[i];
        mark(s);
        if (s.importKind === "type") write("type ");
        const imported_name = s.imported.type === "Identifier"
          ? s.imported.name
          : s.imported.raw ?? JSON.stringify(s.imported.value);
        if (
          s.imported.type === "Identifier" && imported_name === s.local.name
        ) {
          write(imported_name);
        } else {
          write(imported_name + " as " + s.local.name);
        }
      }
      write(" }");
    }
    write(" from ");
    print_literal(imp.source);
    write(";");
  }

  function print_stmt(stmt: Statement): void {
    mark(stmt);
    switch (stmt.type) {
      case "EmptyStatement":
        write(";");
        return;
      case "BlockStatement":
        print_block(stmt.body as Statement[]);
        return;
      case "ExpressionStatement": {
        const expr = stmt.expression;
        const need_p = starts_with_brace_or_keyword(expr);
        if (need_p) write("(");
        print_expr(expr, 0, false);
        if (need_p) write(")");
        write(";");
        return;
      }
      case "VariableDeclaration":
        print_var_decl(stmt, true, false);
        return;
      case "ReturnStatement":
        write("return");
        if (stmt.argument !== null) {
          write(" ");
          print_expr(stmt.argument, 0, false);
        }
        write(";");
        return;
      case "ThrowStatement":
        write("throw ");
        print_expr(stmt.argument, 0, false);
        write(";");
        return;
      case "BreakStatement":
        write("break");
        if (stmt.label !== null) write(" " + stmt.label.name);
        write(";");
        return;
      case "ContinueStatement":
        write("continue");
        if (stmt.label !== null) write(" " + stmt.label.name);
        write(";");
        return;
      case "IfStatement": {
        write("if (");
        print_expr(stmt.test, 0, false);
        write(") ");
        const wrap_cons = stmt.alternate !== null &&
          ends_with_dangling_if(stmt.consequent);
        if (wrap_cons) {
          print_block([stmt.consequent]);
        } else {
          print_stmt(stmt.consequent);
        }
        if (stmt.alternate !== null) {
          write(" else ");
          print_stmt(stmt.alternate);
        }
        return;
      }
      case "ForStatement": {
        write("for (");
        if (stmt.init !== null) {
          if (stmt.init.type === "VariableDeclaration") {
            print_var_decl(stmt.init, false, true);
          } else {
            print_expr(stmt.init, 0, true);
          }
        }
        write("; ");
        if (stmt.test !== null) print_expr(stmt.test, 0, false);
        write("; ");
        if (stmt.update !== null) print_expr(stmt.update, 0, false);
        write(") ");
        print_stmt(stmt.body);
        return;
      }
      case "ForOfStatement": {
        write(stmt.await ? "for await (" : "for (");
        if (stmt.left.type === "VariableDeclaration") {
          print_var_decl(stmt.left, false, false);
        } else {
          print_pattern(stmt.left as BindingPattern);
        }
        write(" of ");
        print_expr(stmt.right, 1, false);
        write(") ");
        print_stmt(stmt.body);
        return;
      }
      case "ForInStatement": {
        write("for (");
        if (stmt.left.type === "VariableDeclaration") {
          print_var_decl(stmt.left, false, false);
        } else {
          print_pattern(stmt.left as BindingPattern);
        }
        write(" in ");
        print_expr(stmt.right, 0, false);
        write(") ");
        print_stmt(stmt.body);
        return;
      }
      case "WhileStatement":
        write("while (");
        print_expr(stmt.test, 0, false);
        write(") ");
        print_stmt(stmt.body);
        return;
      case "DoWhileStatement":
        write("do ");
        print_stmt(stmt.body);
        write(" while (");
        print_expr(stmt.test, 0, false);
        write(");");
        return;
      case "SwitchStatement": {
        write("switch (");
        print_expr(stmt.discriminant, 0, false);
        write(") {");
        write_nl();
        depth += 1;
        for (let i = 0; i < stmt.cases.length; i += 1) {
          const c = stmt.cases[i];
          write_indent();
          mark(c);
          if (c.test === null) {
            write("default:");
          } else {
            write("case ");
            print_expr(c.test, 0, false);
            write(":");
          }
          write_nl();
          depth += 1;
          for (let j = 0; j < c.consequent.length; j += 1) {
            write_indent();
            print_stmt(c.consequent[j] as Statement);
            write_nl();
          }
          depth -= 1;
        }
        depth -= 1;
        write_indent();
        write("}");
        return;
      }
      case "TryStatement": {
        write("try ");
        print_block(stmt.block.body as Statement[]);
        if (stmt.handler !== null) {
          write(" catch");
          if (stmt.handler.param !== null) {
            write(" (");
            print_pattern(stmt.handler.param);
            write(")");
          }
          write(" ");
          print_block(stmt.handler.body.body as Statement[]);
        }
        if (stmt.finalizer !== null) {
          write(" finally ");
          print_block(stmt.finalizer.body as Statement[]);
        }
        return;
      }
      case "LabeledStatement":
        write((stmt.label as IdentifierReference).name + ": ");
        print_stmt(stmt.body);
        return;
      case "FunctionDeclaration":
        print_function(stmt as FunctionNode);
        return;
      case "ImportDeclaration":
        print_import_decl(stmt);
        return;
      case "ExportNamedDeclaration":
        if (
          stmt.exportKind === "type" || stmt.source !== null ||
          stmt.declaration === null
        ) throw BAIL;
        write("export ");
        print_stmt(stmt.declaration as Statement);
        return;
      case "TSTypeAliasDeclaration":
        if (stmt.declare) throw BAIL;
        write("type ");
        mark(stmt.id);
        write(stmt.id.name);
        print_type_params_decl(stmt.typeParameters);
        write(" = ");
        print_type(stmt.typeAnnotation);
        write(";");
        return;
      default:
        throw BAIL;
    }
  }

  try {
    if (root.type === "Program") {
      const body = (root as Program).body as Statement[];
      for (let i = 0; i < body.length; i += 1) {
        if (i > 0) write_nl();
        print_stmt(body[i]);
      }
    } else if (
      root.type === "ExpressionStatement" ||
      root.type === "VariableDeclaration" ||
      root.type === "ReturnStatement" ||
      root.type === "ThrowStatement" ||
      root.type === "IfStatement" ||
      root.type === "BlockStatement" ||
      root.type === "ForStatement" ||
      root.type === "ForOfStatement" ||
      root.type === "ForInStatement" ||
      root.type === "WhileStatement" ||
      root.type === "DoWhileStatement" ||
      root.type === "SwitchStatement" ||
      root.type === "TryStatement" ||
      root.type === "LabeledStatement" ||
      root.type === "BreakStatement" ||
      root.type === "ContinueStatement" ||
      root.type === "EmptyStatement" ||
      root.type === "FunctionDeclaration" ||
      root.type === "ImportDeclaration" ||
      root.type === "ExportNamedDeclaration" ||
      root.type === "TSTypeAliasDeclaration"
    ) {
      print_stmt(root as Statement);
    } else {
      print_expr(root as Expression, 0, false);
    }
    sink.push_code(buf);
    sink.set_gen_col(col);
    return true;
  } catch (err) {
    if (err === BAIL) return false;
    throw err;
  }
}
