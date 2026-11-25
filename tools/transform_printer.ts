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
  gen_col: number;
  out_gen_col: number;
  out_orig_line: number;
  out_orig_col: number;
  line_has_seg: boolean;
  readonly code_chunks: string[];
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

class FastPrinter {
  private sink!: FastPrintSink;
  private source_map = false;
  private locator: FastSourceLocator | undefined;
  private lang: "ts" | "tsx" = "ts";
  private buf = "";
  private col = 0;
  private depth = 0;

  private write(text: string): void {
    this.buf += text;
    this.col += text.length;
  }

  private write_nl(): void {
    this.buf += "\n";
    if (this.source_map) this.sink.emit_newline();
    this.col = 0;
  }

  private write_indent(): void {
    const s = indent_str(this.depth);
    if (s.length > 0) {
      this.buf += s;
      this.col += s.length;
    }
  }

  private write_multiline(text: string): void {
    if (
      text.includes("\r") || text.includes("\u2028") || text.includes("\u2029")
    ) throw BAIL;
    this.buf += text;
    const nl = text.indexOf("\n");
    if (nl < 0) {
      this.col += text.length;
      return;
    }
    if (!this.source_map) {
      const last = text.lastIndexOf("\n");
      this.col = text.length - last - 1;
      return;
    }
    let pos = nl;
    let last = 0;
    while (pos >= 0) {
      this.sink.emit_newline();
      last = pos + 1;
      pos = text.indexOf("\n", last);
    }
    this.col = text.length - last;
  }

  private mark(n: Node): void {
    if (!this.source_map || n.start < 0 || this.locator === undefined) return;
    const loc = this.locator;
    loc.lookup(n.start);
    const orig_line = loc.line - 1;
    const orig_col = loc.column;
    const sink = this.sink;
    if (
      !sink.line_has_seg ||
      this.col !== sink.out_gen_col ||
      orig_line !== sink.out_orig_line ||
      orig_col !== sink.out_orig_col
    ) {
      sink.emit_segment(this.col, orig_line, orig_col);
    }
  }

  private print_type_params_decl(
    decl: TSTypeParameterDeclaration | null | undefined,
  ): void {
    if (decl == null) return;
    this.write("<");
    const params = decl.params;
    for (let i = 0; i < params.length; i += 1) {
      if (i > 0) this.write(", ");
      const p = params[i];
      if (p.const) this.write("const ");
      if (p.in) this.write("in ");
      if (p.out) this.write("out ");
      this.mark(p);
      this.write(p.name.name);
      if (p.constraint != null) {
        this.write(" extends ");
        this.print_type(p.constraint);
      }
      if (p.default != null) {
        this.write(" = ");
        this.print_type(p.default);
      }
    }
    if (
      this.lang === "tsx" && params.length === 1 &&
      params[0].constraint == null && params[0].default == null
    ) {
      this.write(",");
    }
    this.write(">");
  }

  private print_type_args(
    inst: TSTypeParameterInstantiation | null | undefined,
  ): void {
    if (inst == null) return;
    this.write("<");
    const params = inst.params;
    for (let i = 0; i < params.length; i += 1) {
      if (i > 0) this.write(", ");
      this.print_type(params[i]);
    }
    this.write(">");
  }

  private print_type_name(name: Node): void {
    if (name.type === "Identifier") {
      this.mark(name);
      this.write(name.name);
      return;
    }
    if (name.type === "TSQualifiedName") {
      this.print_type_name(name.left);
      this.write(".");
      this.mark(name.right);
      this.write(name.right.name);
      return;
    }
    throw BAIL;
  }

  private print_tuple_el(
    el: Extract<TSType, { type: "TSTupleType" }>["elementTypes"][number],
  ): void {
    if (el.type === "TSNamedTupleMember") {
      this.mark(el);
      this.write(el.label.name);
      if (el.optional) this.write("?");
      this.write(": ");
      this.print_tuple_el(el.elementType);
    } else if (el.type === "TSOptionalType") {
      const wrap = needs_type_parens_in_array_or_index(el.typeAnnotation);
      if (wrap) this.write("(");
      this.print_type(el.typeAnnotation);
      if (wrap) this.write(")");
      this.write("?");
    } else if (el.type === "TSRestType") {
      this.write("...");
      this.print_type(el.typeAnnotation);
    } else {
      this.print_type(el);
    }
  }

  private print_type(t: TSType): void {
    this.mark(t);
    switch (t.type) {
      case "TSAnyKeyword":
        this.write("any");
        return;
      case "TSUnknownKeyword":
        this.write("unknown");
        return;
      case "TSNumberKeyword":
        this.write("number");
        return;
      case "TSStringKeyword":
        this.write("string");
        return;
      case "TSBooleanKeyword":
        this.write("boolean");
        return;
      case "TSVoidKeyword":
        this.write("void");
        return;
      case "TSUndefinedKeyword":
        this.write("undefined");
        return;
      case "TSNullKeyword":
        this.write("null");
        return;
      case "TSNeverKeyword":
        this.write("never");
        return;
      case "TSObjectKeyword":
        this.write("object");
        return;
      case "TSSymbolKeyword":
        this.write("symbol");
        return;
      case "TSBigIntKeyword":
        this.write("bigint");
        return;
      case "TSThisType":
        this.write("this");
        return;
      case "TSTypeReference":
        this.print_type_name(t.typeName);
        this.print_type_args(t.typeArguments);
        return;
      case "TSTypeQuery":
        this.write("typeof ");
        this.print_type_name(t.exprName);
        this.print_type_args(t.typeArguments);
        return;
      case "TSArrayType": {
        const wrap = needs_type_parens_in_array_or_index(t.elementType);
        if (wrap) this.write("(");
        this.print_type(t.elementType);
        if (wrap) this.write(")");
        this.write("[]");
        return;
      }
      case "TSTupleType": {
        this.write("[");
        const els = t.elementTypes;
        for (let i = 0; i < els.length; i += 1) {
          if (i > 0) this.write(", ");
          this.print_tuple_el(els[i]);
        }
        this.write("]");
        return;
      }
      case "TSUnionType": {
        const types = t.types;
        for (let i = 0; i < types.length; i += 1) {
          if (i > 0) this.write(" | ");
          const item = types[i];
          const wrap = item.type === "TSFunctionType" ||
            item.type === "TSConstructorType" ||
            item.type === "TSConditionalType" ||
            item.type === "TSIntersectionType";
          if (wrap) this.write("(");
          this.print_type(item);
          if (wrap) this.write(")");
        }
        return;
      }
      case "TSIntersectionType": {
        const types = t.types;
        for (let i = 0; i < types.length; i += 1) {
          if (i > 0) this.write(" & ");
          const item = types[i];
          const wrap = item.type === "TSFunctionType" ||
            item.type === "TSConstructorType" ||
            item.type === "TSConditionalType" ||
            item.type === "TSUnionType";
          if (wrap) this.write("(");
          this.print_type(item);
          if (wrap) this.write(")");
        }
        return;
      }
      case "TSParenthesizedType":
        this.write("(");
        this.print_type(t.typeAnnotation);
        this.write(")");
        return;
      case "TSTypeLiteral": {
        const members = t.members;
        if (members.length === 0) {
          this.write("{}");
          return;
        }
        this.write("{ ");
        for (let i = 0; i < members.length; i += 1) {
          if (i > 0) this.write("; ");
          const m = members[i];
          if (m.type === "TSPropertySignature") {
            if (m.accessibility != null || m.static) throw BAIL;
            this.mark(m);
            if (m.readonly) this.write("readonly ");
            if (m.computed) {
              this.write("[");
              this.print_expr(m.key as Expression, 0, false);
              this.write("]");
            } else {
              this.print_prop_key(m.key);
            }
            if (m.optional) this.write("?");
            if (m.typeAnnotation != null) {
              this.write(": ");
              this.print_type(m.typeAnnotation.typeAnnotation);
            }
          } else if (m.type === "TSIndexSignature") {
            this.mark(m);
            if (m.readonly) this.write("readonly ");
            this.write("[");
            const p = m.parameters[0];
            if (p === undefined) throw BAIL;
            this.print_pattern(p as unknown as ParamPattern);
            this.write("]");
            if (m.typeAnnotation != null) {
              this.write(": ");
              this.print_type(m.typeAnnotation.typeAnnotation);
            }
          } else {
            throw BAIL;
          }
        }
        this.write(" }");
        return;
      }
      case "TSFunctionType": {
        this.print_type_params_decl(t.typeParameters);
        this.write("(");
        this.print_params(t.params);
        this.write(") => ");
        this.print_type(t.returnType.typeAnnotation);
        return;
      }
      case "TSLiteralType": {
        const lit = t.literal;
        if (lit.type === "Literal") this.print_literal(lit);
        else if (lit.type === "UnaryExpression") this.print_expr(lit, 0, false);
        else if (lit.type === "TemplateLiteral") this.print_expr(lit, 0, false);
        else throw BAIL;
        return;
      }
      case "TSIndexedAccessType": {
        const wrap = needs_type_parens_in_array_or_index(t.objectType);
        if (wrap) this.write("(");
        this.print_type(t.objectType);
        if (wrap) this.write(")");
        this.write("[");
        this.print_type(t.indexType);
        this.write("]");
        return;
      }
      case "TSTypeOperator": {
        this.write(t.operator + " ");
        const wrap = needs_type_parens_in_array_or_index(t.typeAnnotation);
        if (wrap) this.write("(");
        this.print_type(t.typeAnnotation);
        if (wrap) this.write(")");
        return;
      }
      case "TSTypePredicate": {
        if (t.asserts) this.write("asserts ");
        if (t.parameterName.type === "Identifier") {
          this.write(t.parameterName.name);
        } else if (t.parameterName.type === "TSThisType") {
          this.write("this");
        } else {
          throw BAIL;
        }
        if (t.typeAnnotation != null) {
          this.write(" is ");
          this.print_type(t.typeAnnotation.typeAnnotation);
        }
        return;
      }
      case "TSConditionalType": {
        const wrap_check = t.checkType.type === "TSConditionalType" ||
          t.checkType.type === "TSFunctionType" ||
          t.checkType.type === "TSConstructorType";
        if (wrap_check) this.write("(");
        this.print_type(t.checkType);
        if (wrap_check) this.write(")");
        this.write(" extends ");
        this.print_type(t.extendsType);
        this.write(" ? ");
        this.print_type(t.trueType);
        this.write(" : ");
        this.print_type(t.falseType);
        return;
      }
      case "TSInferType": {
        this.write("infer ");
        this.mark(t.typeParameter);
        this.write(t.typeParameter.name.name);
        if (t.typeParameter.constraint != null) {
          this.write(" extends ");
          this.print_type(t.typeParameter.constraint);
        }
        return;
      }
      case "TSMappedType": {
        this.write("{ ");
        if (t.readonly === true) this.write("readonly ");
        else if (t.readonly === "+") this.write("+readonly ");
        else if (t.readonly === "-") this.write("-readonly ");
        this.write("[");
        this.write(t.key.name);
        if (t.constraint != null) {
          this.write(" in ");
          this.print_type(t.constraint);
        }
        if (t.nameType != null) {
          this.write(" as ");
          this.print_type(t.nameType);
        }
        this.write("]");
        if (t.optional === true) this.write("?");
        else if (t.optional === "+") this.write("+?");
        else if (t.optional === "-") this.write("-?");
        if (t.typeAnnotation != null) {
          this.write(": ");
          this.print_type(t.typeAnnotation);
        }
        this.write(" }");
        return;
      }
      default:
        throw BAIL;
    }
  }

  private print_prop_key(key: Node): void {
    if (key.type === "Identifier") {
      this.mark(key);
      this.write(key.name);
      return;
    }
    if (key.type === "Literal") {
      this.print_literal(key);
      return;
    }
    throw BAIL;
  }

  private print_literal(
    lit: Extract<Expression, { type: "Literal" }>,
  ): void {
    this.mark(lit);
    if (lit.raw != null) {
      this.write_multiline(lit.raw);
      return;
    }
    const v = lit.value;
    if (typeof v === "string") {
      this.write(JSON.stringify(v));
    } else if (typeof v === "number") {
      this.write(Object.is(v, -0) ? "-0" : String(v));
    } else if (typeof v === "boolean") {
      this.write(v ? "true" : "false");
    } else if (v === null) {
      this.write("null");
    } else if (typeof v === "bigint") {
      this.write(v.toString() + "n");
    } else if ("regex" in lit && lit.regex != null) {
      this.write("/" + lit.regex.pattern + "/" + lit.regex.flags);
    } else {
      throw BAIL;
    }
  }

  private print_pattern(pat: BindingPattern | ParamPattern): void {
    this.mark(pat);
    switch (pat.type) {
      case "Identifier": {
        if (pat.decorators !== undefined && pat.decorators.length > 0) {
          throw BAIL;
        }
        this.write(pat.name);
        if (pat.optional) this.write("?");
        if (pat.typeAnnotation != null) {
          this.write(": ");
          this.print_type(pat.typeAnnotation.typeAnnotation);
        }
        return;
      }
      case "RestElement": {
        if (pat.decorators !== undefined && pat.decorators.length > 0) {
          throw BAIL;
        }
        this.write("...");
        this.print_pattern(pat.argument);
        if (pat.typeAnnotation != null) {
          this.write(": ");
          this.print_type(pat.typeAnnotation.typeAnnotation);
        }
        return;
      }
      case "AssignmentPattern": {
        this.print_pattern(pat.left);
        this.write(" = ");
        this.print_expr(pat.right, 1, false);
        return;
      }
      case "ObjectPattern": {
        this.write("{");
        const props = pat.properties;
        if (props.length > 0) this.write(" ");
        for (let i = 0; i < props.length; i += 1) {
          if (i > 0) this.write(", ");
          const prop = props[i];
          if (prop.type === "RestElement") {
            this.print_pattern(prop);
          } else {
            this.mark(prop);
            if (prop.shorthand) {
              this.print_pattern(prop.value);
            } else {
              if (prop.computed) {
                this.write("[");
                this.print_expr(prop.key as Expression, 0, false);
                this.write("]");
              } else {
                this.print_prop_key(prop.key);
              }
              this.write(": ");
              this.print_pattern(prop.value);
            }
          }
        }
        if (props.length > 0) this.write(" ");
        this.write("}");
        if (pat.optional) this.write("?");
        if (pat.typeAnnotation != null) {
          this.write(": ");
          this.print_type(pat.typeAnnotation.typeAnnotation);
        }
        return;
      }
      case "ArrayPattern": {
        this.write("[");
        const els = pat.elements;
        for (let i = 0; i < els.length; i += 1) {
          if (i > 0) this.write(", ");
          const el = els[i];
          if (el !== null) this.print_pattern(el);
        }
        if (els.length > 0 && els[els.length - 1] === null) this.write(",");
        this.write("]");
        if (pat.optional) this.write("?");
        if (pat.typeAnnotation != null) {
          this.write(": ");
          this.print_type(pat.typeAnnotation.typeAnnotation);
        }
        return;
      }
      default:
        throw BAIL;
    }
  }

  private print_params(params: readonly ParamPattern[]): void {
    for (let i = 0; i < params.length; i += 1) {
      if (i > 0) this.write(", ");
      this.print_pattern(params[i]);
    }
  }

  private print_args(
    args: readonly (Expression | Extract<Node, { type: "SpreadElement" }>)[],
  ): void {
    this.write("(");
    for (let i = 0; i < args.length; i += 1) {
      if (i > 0) this.write(", ");
      const arg = args[i];
      if (arg.type === "SpreadElement") {
        this.mark(arg);
        this.write("...");
        this.print_expr(arg.argument, 1, false);
      } else {
        this.print_expr(arg, 1, false);
      }
    }
    this.write(")");
  }

  private print_expr(
    expr: Expression,
    min_prec: number,
    no_in: boolean,
  ): void {
    const prec = expr_prec(expr);
    const wrap = prec < min_prec ||
      (no_in && expr.type === "BinaryExpression" && expr.operator === "in");
    if (wrap) this.write("(");
    this.mark(expr);
    switch (expr.type) {
      case "Identifier":
        this.write(expr.name);
        break;
      case "Literal":
        this.print_literal(expr);
        break;
      case "ThisExpression":
        this.write("this");
        break;
      case "Super":
        this.write("super");
        break;
      case "MetaProperty":
        this.write(expr.meta.name + "." + expr.property.name);
        break;
      case "ParenthesizedExpression":
        this.write("(");
        this.print_expr(expr.expression, 0, false);
        this.write(")");
        break;
      case "ImportExpression":
        if (expr.options != null) throw BAIL;
        this.write("import(");
        this.print_expr(expr.source, 1, false);
        this.write(")");
        break;
      case "TemplateLiteral": {
        this.write("`");
        const quasis = expr.quasis;
        const exprs = expr.expressions;
        for (let i = 0; i < quasis.length; i += 1) {
          this.write_multiline(quasis[i].value.raw);
          if (i < exprs.length) {
            this.write("${");
            this.print_expr(exprs[i], 0, false);
            this.write("}");
          }
        }
        this.write("`");
        break;
      }
      case "TaggedTemplateExpression": {
        const tag = expr.tag;
        const need_p = expr_prec(tag) < 17;
        if (need_p) this.write("(");
        this.print_expr(tag, 0, false);
        if (need_p) this.write(")");
        this.print_type_args(expr.typeArguments);
        this.print_expr(expr.quasi, 0, false);
        break;
      }
      case "ArrayExpression": {
        this.write("[");
        const els = expr.elements;
        for (let i = 0; i < els.length; i += 1) {
          if (i > 0) this.write(", ");
          const el = els[i];
          if (el === null) continue;
          if (el.type === "SpreadElement") {
            this.mark(el);
            this.write("...");
            this.print_expr(el.argument, 1, false);
          } else {
            this.print_expr(el, 1, false);
          }
        }
        if (els.length > 0 && els[els.length - 1] === null) this.write(",");
        this.write("]");
        break;
      }
      case "ObjectExpression": {
        const props = (expr as ObjectExpression).properties;
        if (props.length === 0) {
          this.write("{}");
          break;
        }
        this.write("{ ");
        for (let i = 0; i < props.length; i += 1) {
          if (i > 0) this.write(", ");
          const prop = props[i];
          if (prop.type === "SpreadElement") {
            this.mark(prop);
            this.write("...");
            this.print_expr(prop.argument, 1, false);
          } else {
            const p = prop as ObjectProperty;
            if (p.kind !== "init") throw BAIL;
            this.mark(p);
            if (p.method) {
              if (
                p.value.type !== "FunctionExpression" || p.value.body === null
              ) {
                throw BAIL;
              }
              const fn = p.value;
              if (fn.async) this.write("async ");
              if (fn.generator) this.write("*");
              if (p.computed) {
                this.write("[");
                this.print_expr(p.key as Expression, 0, false);
                this.write("]");
              } else {
                this.print_prop_key(p.key);
              }
              this.print_type_params_decl(fn.typeParameters);
              this.write("(");
              this.print_params(fn.params);
              this.write(")");
              if (fn.returnType != null) {
                this.write(": ");
                this.print_type(fn.returnType.typeAnnotation);
              }
              this.write(" ");
              this.print_block(fn.body!.body as Statement[]);
            } else if (p.shorthand) {
              this.print_expr(p.value as Expression, 1, false);
            } else {
              if (p.computed) {
                this.write("[");
                this.print_expr(p.key as Expression, 0, false);
                this.write("]");
              } else {
                this.print_prop_key(p.key);
              }
              this.write(": ");
              this.print_expr(p.value as Expression, 1, false);
            }
          }
        }
        this.write(" }");
        break;
      }
      case "MemberExpression": {
        const mem = expr as MemberExpression;
        const obj = mem.object;
        const need_num_p = !mem.computed && !mem.optional &&
          obj.type === "Literal" && typeof obj.value === "number";
        if (need_num_p) {
          this.write("(");
          this.print_expr(obj, 0, false);
          this.write(")");
        } else {
          this.print_expr(obj, 17, false);
        }
        if (mem.optional) this.write("?.");
        if (mem.computed) {
          this.write("[");
          this.print_expr(mem.property as Expression, 0, false);
          this.write("]");
        } else {
          if (!mem.optional) this.write(".");
          if (mem.property.type === "Identifier") {
            this.mark(mem.property);
            this.write(mem.property.name);
          } else if (mem.property.type === "PrivateIdentifier") {
            this.mark(mem.property);
            this.write("#" + mem.property.name);
          } else {
            throw BAIL;
          }
        }
        break;
      }
      case "CallExpression": {
        const c = expr as CallExpression;
        this.print_expr(c.callee as Expression, 17, false);
        if (c.optional) this.write("?.");
        this.print_type_args(c.typeArguments);
        this.print_args(c.arguments);
        break;
      }
      case "NewExpression": {
        const nw = expr as NewExpression;
        this.write("new ");
        const callee = nw.callee as Expression;
        const need_p = expr_prec(callee) < 17 || callee_has_call(callee);
        if (need_p) this.write("(");
        this.print_expr(callee, 0, false);
        if (need_p) this.write(")");
        this.print_type_args(nw.typeArguments);
        this.print_args(nw.arguments);
        break;
      }
      case "ChainExpression":
        this.print_expr(expr.expression as Expression, 0, false);
        break;
      case "UnaryExpression": {
        const op = expr.operator;
        const is_word = op === "typeof" || op === "void" || op === "delete";
        this.write(op);
        if (is_word) {
          this.write(" ");
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
          this.write(" ");
        }
        this.print_expr(expr.argument, 14, false);
        break;
      }
      case "UpdateExpression": {
        if (expr.prefix) {
          this.write(expr.operator);
          this.print_expr(expr.argument as Expression, 16, false);
        } else {
          this.print_expr(expr.argument as Expression, 16, false);
          this.write(expr.operator);
        }
        break;
      }
      case "AwaitExpression":
        this.write("await ");
        this.print_expr(expr.argument, 14, false);
        break;
      case "YieldExpression":
        this.write(expr.delegate ? "yield*" : "yield");
        if (expr.argument !== null) {
          this.write(" ");
          this.print_expr(expr.argument, 1, no_in);
        }
        break;
      case "BinaryExpression": {
        const op = expr.operator;
        const p = binary_prec(op);
        if (expr.left.type === "PrivateIdentifier") {
          this.mark(expr.left);
          this.write("#" + expr.left.name);
        } else if (op === "**") {
          const left_wrap = expr_prec(expr.left) <= 14;
          if (left_wrap) this.write("(");
          this.print_expr(expr.left, 0, no_in);
          if (left_wrap) this.write(")");
        } else {
          this.print_expr(expr.left, p, no_in);
        }
        this.write(" " + op + " ");
        this.print_expr(expr.right, op === "**" ? p : p + 0.5, no_in);
        break;
      }
      case "LogicalExpression": {
        const op = expr.operator;
        const p = binary_prec(op);
        const mix_left = expr.left.type === "LogicalExpression" &&
          ((op === "??" && expr.left.operator !== "??") ||
            (op !== "??" && expr.left.operator === "??"));
        if (mix_left) {
          this.write("(");
          this.print_expr(expr.left, 0, no_in);
          this.write(")");
        } else {
          this.print_expr(expr.left, p, no_in);
        }
        this.write(" " + op + " ");
        const mix_right = expr.right.type === "LogicalExpression" &&
          ((op === "??" && expr.right.operator !== "??") ||
            (op !== "??" && expr.right.operator === "??"));
        if (mix_right) {
          this.write("(");
          this.print_expr(expr.right, 0, no_in);
          this.write(")");
        } else {
          this.print_expr(expr.right, p + 0.5, no_in);
        }
        break;
      }
      case "ConditionalExpression":
        this.print_expr(expr.test, 2, no_in);
        this.write(" ? ");
        this.print_expr(expr.consequent, 1, false);
        this.write(" : ");
        this.print_expr(expr.alternate, 1, no_in);
        break;
      case "AssignmentExpression":
        if (
          expr.left.type === "Identifier" ||
          expr.left.type === "MemberExpression"
        ) {
          this.print_expr(expr.left as Expression, 17, false);
        } else {
          this.print_pattern(expr.left as BindingPattern);
        }
        this.write(" " + expr.operator + " ");
        this.print_expr(expr.right, 1, no_in);
        break;
      case "SequenceExpression": {
        const list = expr.expressions;
        for (let i = 0; i < list.length; i += 1) {
          if (i > 0) this.write(", ");
          this.print_expr(list[i], 1, no_in);
        }
        break;
      }
      case "ArrowFunctionExpression": {
        const fn = expr as ArrowFunctionExpression;
        if (fn.async) this.write("async ");
        this.print_type_params_decl(fn.typeParameters);
        this.write("(");
        this.print_params(fn.params);
        this.write(")");
        if (fn.returnType != null) {
          this.write(": ");
          this.print_type(fn.returnType.typeAnnotation);
        }
        this.write(" => ");
        if (fn.body.type === "BlockStatement") {
          this.print_block(fn.body.body as Statement[]);
        } else {
          const body_expr = fn.body as Expression;
          const need_p = starts_with_object_or_seq(body_expr);
          if (need_p) this.write("(");
          this.print_expr(body_expr, 1, no_in);
          if (need_p) this.write(")");
        }
        break;
      }
      case "FunctionExpression": {
        this.print_function(expr as FunctionNode);
        break;
      }
      case "TSAsExpression":
        this.print_expr(expr.expression, 2, no_in);
        this.write(" as ");
        this.print_type(expr.typeAnnotation);
        break;
      case "TSSatisfiesExpression":
        this.print_expr(expr.expression, 2, no_in);
        this.write(" satisfies ");
        this.print_type(expr.typeAnnotation);
        break;
      case "TSNonNullExpression":
        this.print_expr(expr.expression, 16, false);
        this.write("!");
        break;
      case "TSInstantiationExpression":
        this.print_expr(expr.expression, 16, false);
        this.print_type_args(expr.typeArguments);
        break;
      default:
        throw BAIL;
    }
    if (wrap) this.write(")");
  }

  private print_function(fn: FunctionNode): void {
    if (fn.async) this.write("async ");
    this.write(fn.generator ? "function*" : "function");
    if (fn.id !== null) {
      this.write(" ");
      this.mark(fn.id);
      this.write(fn.id.name);
    }
    this.print_type_params_decl(fn.typeParameters);
    this.write("(");
    this.print_params(fn.params);
    this.write(")");
    if (fn.returnType != null) {
      this.write(": ");
      this.print_type(fn.returnType.typeAnnotation);
    }
    this.write(" ");
    if (fn.body === null) throw BAIL;
    this.print_block(fn.body.body as Statement[]);
  }

  private print_block(stmts: readonly Statement[]): void {
    if (stmts.length === 0) {
      this.write("{}");
      return;
    }
    this.write("{");
    this.write_nl();
    this.depth += 1;
    for (let i = 0; i < stmts.length; i += 1) {
      this.write_indent();
      this.print_stmt(stmts[i]);
      this.write_nl();
    }
    this.depth -= 1;
    this.write_indent();
    this.write("}");
  }

  private print_var_decl(
    decl: VariableDeclaration,
    semicolon: boolean,
    no_in: boolean,
  ): void {
    if (decl.declare) throw BAIL;
    this.mark(decl);
    this.write(decl.kind + " ");
    const list = decl.declarations;
    for (let i = 0; i < list.length; i += 1) {
      if (i > 0) this.write(", ");
      const d = list[i];
      this.mark(d);
      this.print_pattern(d.id);
      if (d.definite) this.write("!");
      if (d.init !== null) {
        this.write(" = ");
        this.print_expr(d.init, 1, no_in);
      }
    }
    if (semicolon) this.write(";");
  }

  private print_import_decl(imp: ImportDeclaration): void {
    if (imp.attributes !== undefined && imp.attributes.length > 0) throw BAIL;
    this.mark(imp);
    this.write("import ");
    if (imp.importKind === "type") this.write("type ");
    const specs = imp.specifiers;
    if (specs.length === 0) {
      this.print_literal(imp.source);
      this.write(";");
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
        this.mark(s);
        this.write(s.local.name);
        has_default = true;
      } else if (s.type === "ImportNamespaceSpecifier") {
        if (has_default) this.write(", ");
        this.mark(s);
        this.write("* as " + s.local.name);
        has_ns = true;
      } else {
        named.push(s);
      }
    }
    if (named.length > 0) {
      if (has_default || has_ns) this.write(", ");
      this.write("{ ");
      for (let i = 0; i < named.length; i += 1) {
        if (i > 0) this.write(", ");
        const s = named[i];
        this.mark(s);
        if (s.importKind === "type") this.write("type ");
        const imported_name = s.imported.type === "Identifier"
          ? s.imported.name
          : s.imported.raw ?? JSON.stringify(s.imported.value);
        if (
          s.imported.type === "Identifier" && imported_name === s.local.name
        ) {
          this.write(imported_name);
        } else {
          this.write(imported_name + " as " + s.local.name);
        }
      }
      this.write(" }");
    }
    this.write(" from ");
    this.print_literal(imp.source);
    this.write(";");
  }

  private print_stmt(stmt: Statement): void {
    this.mark(stmt);
    switch (stmt.type) {
      case "EmptyStatement":
        this.write(";");
        return;
      case "BlockStatement":
        this.print_block(stmt.body as Statement[]);
        return;
      case "ExpressionStatement": {
        const expr = stmt.expression;
        const need_p = starts_with_brace_or_keyword(expr);
        if (need_p) this.write("(");
        this.print_expr(expr, 0, false);
        if (need_p) this.write(")");
        this.write(";");
        return;
      }
      case "VariableDeclaration":
        this.print_var_decl(stmt, true, false);
        return;
      case "ReturnStatement":
        this.write("return");
        if (stmt.argument !== null) {
          this.write(" ");
          this.print_expr(stmt.argument, 0, false);
        }
        this.write(";");
        return;
      case "ThrowStatement":
        this.write("throw ");
        this.print_expr(stmt.argument, 0, false);
        this.write(";");
        return;
      case "BreakStatement":
        this.write("break");
        if (stmt.label !== null) this.write(" " + stmt.label.name);
        this.write(";");
        return;
      case "ContinueStatement":
        this.write("continue");
        if (stmt.label !== null) this.write(" " + stmt.label.name);
        this.write(";");
        return;
      case "IfStatement": {
        this.write("if (");
        this.print_expr(stmt.test, 0, false);
        this.write(") ");
        const wrap_cons = stmt.alternate !== null &&
          ends_with_dangling_if(stmt.consequent);
        if (wrap_cons) {
          this.print_block([stmt.consequent]);
        } else {
          this.print_stmt(stmt.consequent);
        }
        if (stmt.alternate !== null) {
          this.write(" else ");
          this.print_stmt(stmt.alternate);
        }
        return;
      }
      case "ForStatement": {
        this.write("for (");
        if (stmt.init !== null) {
          if (stmt.init.type === "VariableDeclaration") {
            this.print_var_decl(stmt.init, false, true);
          } else {
            this.print_expr(stmt.init, 0, true);
          }
        }
        this.write("; ");
        if (stmt.test !== null) this.print_expr(stmt.test, 0, false);
        this.write("; ");
        if (stmt.update !== null) this.print_expr(stmt.update, 0, false);
        this.write(") ");
        this.print_stmt(stmt.body);
        return;
      }
      case "ForOfStatement": {
        this.write(stmt.await ? "for await (" : "for (");
        if (stmt.left.type === "VariableDeclaration") {
          this.print_var_decl(stmt.left, false, false);
        } else {
          this.print_pattern(stmt.left as BindingPattern);
        }
        this.write(" of ");
        this.print_expr(stmt.right, 1, false);
        this.write(") ");
        this.print_stmt(stmt.body);
        return;
      }
      case "ForInStatement": {
        this.write("for (");
        if (stmt.left.type === "VariableDeclaration") {
          this.print_var_decl(stmt.left, false, false);
        } else {
          this.print_pattern(stmt.left as BindingPattern);
        }
        this.write(" in ");
        this.print_expr(stmt.right, 0, false);
        this.write(") ");
        this.print_stmt(stmt.body);
        return;
      }
      case "WhileStatement":
        this.write("while (");
        this.print_expr(stmt.test, 0, false);
        this.write(") ");
        this.print_stmt(stmt.body);
        return;
      case "DoWhileStatement":
        this.write("do ");
        this.print_stmt(stmt.body);
        this.write(" while (");
        this.print_expr(stmt.test, 0, false);
        this.write(");");
        return;
      case "SwitchStatement": {
        this.write("switch (");
        this.print_expr(stmt.discriminant, 0, false);
        this.write(") {");
        this.write_nl();
        this.depth += 1;
        for (let i = 0; i < stmt.cases.length; i += 1) {
          const c = stmt.cases[i];
          this.write_indent();
          this.mark(c);
          if (c.test === null) {
            this.write("default:");
          } else {
            this.write("case ");
            this.print_expr(c.test, 0, false);
            this.write(":");
          }
          this.write_nl();
          this.depth += 1;
          for (let j = 0; j < c.consequent.length; j += 1) {
            this.write_indent();
            this.print_stmt(c.consequent[j] as Statement);
            this.write_nl();
          }
          this.depth -= 1;
        }
        this.depth -= 1;
        this.write_indent();
        this.write("}");
        return;
      }
      case "TryStatement": {
        this.write("try ");
        this.print_block(stmt.block.body as Statement[]);
        if (stmt.handler !== null) {
          this.write(" catch");
          if (stmt.handler.param !== null) {
            this.write(" (");
            this.print_pattern(stmt.handler.param);
            this.write(")");
          }
          this.write(" ");
          this.print_block(stmt.handler.body.body as Statement[]);
        }
        if (stmt.finalizer !== null) {
          this.write(" finally ");
          this.print_block(stmt.finalizer.body as Statement[]);
        }
        return;
      }
      case "LabeledStatement":
        this.write((stmt.label as IdentifierReference).name + ": ");
        this.print_stmt(stmt.body);
        return;
      case "FunctionDeclaration":
        this.print_function(stmt as FunctionNode);
        return;
      case "ImportDeclaration":
        this.print_import_decl(stmt);
        return;
      case "ExportNamedDeclaration":
        if (
          stmt.exportKind === "type" || stmt.source !== null ||
          stmt.declaration === null
        ) throw BAIL;
        this.write("export ");
        this.print_stmt(stmt.declaration as Statement);
        return;
      case "TSTypeAliasDeclaration":
        if (stmt.declare) throw BAIL;
        this.write("type ");
        this.mark(stmt.id);
        this.write(stmt.id.name);
        this.print_type_params_decl(stmt.typeParameters);
        this.write(" = ");
        this.print_type(stmt.typeAnnotation);
        this.write(";");
        return;
      default:
        throw BAIL;
    }
  }

  run(root: Node, sink: FastPrintSink, lang: "ts" | "tsx"): boolean {
    this.sink = sink;
    this.source_map = sink.source_map;
    this.locator = sink.locator;
    this.lang = lang;
    this.buf = "";
    this.col = sink.gen_col;
    this.depth = 0;
    try {
      if (root.type === "Program") {
        const body = (root as Program).body as Statement[];
        for (let i = 0; i < body.length; i += 1) {
          if (i > 0) this.write_nl();
          this.print_stmt(body[i]);
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
        this.print_stmt(root as Statement);
      } else {
        this.print_expr(root as Expression, 0, false);
      }
      sink.code_chunks.push(this.buf);
      sink.gen_col = this.col;
      return true;
    } catch (err) {
      if (err === BAIL) return false;
      throw err;
    } finally {
      this.buf = "";
    }
  }
}

const shared_fast_printer = /* @__PURE__ */ new FastPrinter();

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
  return shared_fast_printer.run(root, sink, lang);
}
