import { Do } from "../../src/typeclasses.ts";
import {
  attempt,
  char,
  choice,
  fail,
  label,
  lazy,
  many,
  optional,
  parse_all,
  type ParseOutcome,
  type ParserValue,
  right,
  satisfy,
  sep_end_by,
  succeed,
  take_while,
} from "./parser.ts";
import {
  angles,
  braces,
  brackets,
  comma,
  is_digit,
  is_identifier_continue,
  is_identifier_start,
  keyword,
  lexeme,
  parens,
  quoted_string_body,
  skip_hidden,
  symbol,
} from "./token.ts";

export type Program = {
  readonly kind: "program";
  readonly declarations: readonly Declaration[];
};

export type Declaration =
  | ImportDeclaration
  | TypeDeclaration
  | FunctionDeclaration
  | LetDeclaration;

export type ImportDeclaration = {
  readonly kind: "import_declaration";
  readonly path: string;
  readonly alias: string | undefined;
};

export type TypeDeclaration = {
  readonly kind: "type_declaration";
  readonly name: string;
  readonly value: TypeNode;
};

export type FunctionDeclaration = {
  readonly kind: "function_declaration";
  readonly name: string;
  readonly parameters: readonly Parameter[];
  readonly returns: TypeNode | undefined;
  readonly body: BlockStatement;
};

export type LetDeclaration = {
  readonly kind: "let_declaration";
  readonly name: string;
  readonly annotation: TypeNode | undefined;
  readonly value: Expression;
};

export type Parameter = {
  readonly name: string;
  readonly value_type: TypeNode;
};

export type TypeNode =
  | NamedType
  | ArrayType
  | RecordType;

export type NamedType = {
  readonly kind: "named_type";
  readonly name: string;
  readonly arguments: readonly TypeNode[];
};

export type ArrayType = {
  readonly kind: "array_type";
  readonly item: TypeNode;
};

export type RecordType = {
  readonly kind: "record_type";
  readonly fields: readonly TypeField[];
};

export type TypeField = {
  readonly name: string;
  readonly value_type: TypeNode;
};

export type Statement =
  | BlockStatement
  | LetStatement
  | ReturnStatement
  | IfStatement
  | WhileStatement
  | ExpressionStatement;

export type BlockStatement = {
  readonly kind: "block_statement";
  readonly statements: readonly Statement[];
};

export type LetStatement = {
  readonly kind: "let_statement";
  readonly name: string;
  readonly annotation: TypeNode | undefined;
  readonly value: Expression;
};

export type ReturnStatement = {
  readonly kind: "return_statement";
  readonly value: Expression | undefined;
};

export type IfStatement = {
  readonly kind: "if_statement";
  readonly condition: Expression;
  readonly then_branch: BlockStatement;
  readonly else_branch: BlockStatement | undefined;
};

export type WhileStatement = {
  readonly kind: "while_statement";
  readonly condition: Expression;
  readonly body: BlockStatement;
};

export type ExpressionStatement = {
  readonly kind: "expression_statement";
  readonly expression: Expression;
};

export type Expression =
  | LiteralExpression
  | IdentifierExpression
  | ArrayExpression
  | RecordExpression
  | UnaryExpression
  | BinaryExpression
  | AssignmentExpression
  | CallExpression
  | MemberExpression
  | IndexExpression;

export type LiteralExpression = {
  readonly kind: "literal_expression";
  readonly value: string | number | boolean | null;
};

export type IdentifierExpression = {
  readonly kind: "identifier_expression";
  readonly name: string;
};

export type ArrayExpression = {
  readonly kind: "array_expression";
  readonly items: readonly Expression[];
};

export type RecordExpression = {
  readonly kind: "record_expression";
  readonly fields: readonly RecordField[];
};

export type RecordField = {
  readonly name: string;
  readonly value: Expression;
};

export type UnaryExpression = {
  readonly kind: "unary_expression";
  readonly operator: UnaryOperator;
  readonly argument: Expression;
};

export type BinaryExpression = {
  readonly kind: "binary_expression";
  readonly operator: BinaryOperator;
  readonly left: Expression;
  readonly right: Expression;
};

export type AssignmentExpression = {
  readonly kind: "assignment_expression";
  readonly target: Expression;
  readonly value: Expression;
};

export type CallExpression = {
  readonly kind: "call_expression";
  readonly callee: Expression;
  readonly arguments: readonly Expression[];
};

export type MemberExpression = {
  readonly kind: "member_expression";
  readonly object: Expression;
  readonly property: string;
};

export type IndexExpression = {
  readonly kind: "index_expression";
  readonly object: Expression;
  readonly index: Expression;
};

export type UnaryOperator = "!" | "-";

export type BinaryOperator =
  | "||"
  | "&&"
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "+"
  | "-"
  | "*"
  | "/"
  | "%";

type PostfixSuffix =
  | readonly ["call", readonly Expression[]]
  | readonly ["member", string]
  | readonly ["index", Expression];

const reserved_words = new Set([
  "as",
  "else",
  "false",
  "fn",
  "if",
  "import",
  "let",
  "null",
  "return",
  "true",
  "type",
  "while",
]);

export const program: ParserValue<Program> = lazy("program", () => {
  return label(
    right(
      skip_hidden(),
      Do(function* () {
        const declarations = yield* many(declaration);

        return {
          kind: "program",
          declarations,
        } satisfies Program;
      }),
    ),
    "program",
  );
});

export function parse_program(
  source: string,
  source_name = "program.traits",
): ParseOutcome<Program> {
  return parse_all(program, source, source_name);
}

export function format_program(value: Program): string {
  const labels: string[] = [];

  for (const declaration of value.declarations) {
    switch (declaration.kind) {
      case "import_declaration":
        labels.push("import:" + declaration.path);
        break;
      case "type_declaration":
        labels.push("type:" + declaration.name);
        break;
      case "function_declaration":
        labels.push("fn:" + declaration.name);
        break;
      case "let_declaration":
        labels.push("let:" + declaration.name);
        break;
    }
  }

  return labels.join(", ");
}

const declaration: ParserValue<Declaration> = lazy("declaration", () => {
  return choice<Declaration>([
    import_declaration,
    type_declaration,
    function_declaration,
    let_declaration,
  ]);
});

const import_declaration: ParserValue<ImportDeclaration> = label(
  Do(function* () {
    yield* keyword("import");
    const path = yield* string_literal;
    const alias = yield* optional(right(keyword("as"), identifier));
    yield* symbol(";");

    return {
      kind: "import_declaration",
      path,
      alias,
    } satisfies ImportDeclaration;
  }),
  "import declaration",
);

const type_declaration: ParserValue<TypeDeclaration> = label(
  Do(function* () {
    yield* keyword("type");
    const name = yield* identifier;
    yield* symbol("=");
    const value = yield* type_node;
    yield* symbol(";");

    return {
      kind: "type_declaration",
      name,
      value,
    } satisfies TypeDeclaration;
  }),
  "type declaration",
);

const function_declaration: ParserValue<FunctionDeclaration> = label(
  Do(function* () {
    yield* keyword("fn");
    const name = yield* identifier;
    const parameters = yield* parens(sep_end_by(parameter, comma()));
    const returns = yield* optional(right(symbol("->"), type_node));
    const body = yield* block_statement;

    return {
      kind: "function_declaration",
      name,
      parameters,
      returns,
      body,
    } satisfies FunctionDeclaration;
  }),
  "function declaration",
);

const let_declaration: ParserValue<LetDeclaration> = label(
  Do(function* () {
    const binding = yield* let_binding();

    return {
      kind: "let_declaration",
      name: binding.name,
      annotation: binding.annotation,
      value: binding.value,
    } satisfies LetDeclaration;
  }),
  "let declaration",
);

const parameter: ParserValue<Parameter> = lazy("parameter", () => {
  return label(
    Do(function* () {
      const name = yield* identifier;
      yield* symbol(":");
      const value_type = yield* type_node;

      return {
        name,
        value_type,
      } satisfies Parameter;
    }),
    "parameter",
  );
});

const type_node: ParserValue<TypeNode> = lazy("type", () => {
  return choice<TypeNode>([
    array_type,
    record_type,
    named_type,
  ]);
});

const named_type: ParserValue<NamedType> = lazy("named type", () => {
  return label(
    Do(function* () {
      const name = yield* identifier;
      const type_arguments = yield* optional(
        angles(sep_end_by(type_node, comma())),
      );
      let arguments_: readonly TypeNode[] = [];

      if (type_arguments !== undefined) {
        arguments_ = type_arguments;
      }

      return {
        kind: "named_type",
        name,
        arguments: arguments_,
      } satisfies NamedType;
    }),
    "named type",
  );
});

const array_type: ParserValue<ArrayType> = label(
  brackets(type_node).map((item) => {
    return {
      kind: "array_type",
      item,
    } satisfies ArrayType;
  }),
  "array type",
);

const record_type: ParserValue<RecordType> = lazy("record type", () => {
  return label(
    braces(sep_end_by(type_field, comma())).map((fields) => {
      return {
        kind: "record_type",
        fields,
      } satisfies RecordType;
    }),
    "record type",
  );
});

const type_field: ParserValue<TypeField> = lazy("type field", () => {
  return label(
    Do(function* () {
      const name = yield* identifier;
      yield* symbol(":");
      const value_type = yield* type_node;

      return {
        name,
        value_type,
      } satisfies TypeField;
    }),
    "type field",
  );
});

const statement: ParserValue<Statement> = lazy("statement", () => {
  return choice<Statement>([
    let_statement,
    return_statement,
    if_statement,
    while_statement,
    attempt(block_statement),
    expression_statement,
  ]);
});

const block_statement: ParserValue<BlockStatement> = label(
  braces(many(statement)).map((statements) => {
    return {
      kind: "block_statement",
      statements,
    } satisfies BlockStatement;
  }),
  "block",
);

const let_statement: ParserValue<LetStatement> = label(
  Do(function* () {
    const binding = yield* let_binding();

    return {
      kind: "let_statement",
      name: binding.name,
      annotation: binding.annotation,
      value: binding.value,
    } satisfies LetStatement;
  }),
  "let statement",
);

const return_statement: ParserValue<ReturnStatement> = label(
  Do(function* () {
    yield* keyword("return");
    const value = yield* optional(expression);
    yield* symbol(";");

    return {
      kind: "return_statement",
      value,
    } satisfies ReturnStatement;
  }),
  "return statement",
);

const if_statement: ParserValue<IfStatement> = label(
  Do(function* () {
    yield* keyword("if");
    const condition = yield* expression;
    const then_branch = yield* block_statement;
    const else_branch = yield* optional(
      right(keyword("else"), block_statement),
    );

    return {
      kind: "if_statement",
      condition,
      then_branch,
      else_branch,
    } satisfies IfStatement;
  }),
  "if statement",
);

const while_statement: ParserValue<WhileStatement> = label(
  Do(function* () {
    yield* keyword("while");
    const condition = yield* expression;
    const body = yield* block_statement;

    return {
      kind: "while_statement",
      condition,
      body,
    } satisfies WhileStatement;
  }),
  "while statement",
);

const expression_statement: ParserValue<ExpressionStatement> = lazy(
  "expression statement",
  () => {
    return label(
      Do(function* () {
        const parsed_expression = yield* expression;
        yield* symbol(";");

        return {
          kind: "expression_statement",
          expression: parsed_expression,
        } satisfies ExpressionStatement;
      }),
      "expression statement",
    );
  },
);

const expression: ParserValue<Expression> = lazy("expression", () => {
  return assignment_expression;
});

const assignment_expression: ParserValue<Expression> = lazy(
  "assignment",
  () => {
    return logical_or_expression.bind((target) => {
      return optional(right(symbol("="), assignment_expression)).map(
        (value) => {
          if (value === undefined) {
            return target;
          }

          return {
            kind: "assignment_expression",
            target,
            value,
          } satisfies AssignmentExpression;
        },
      );
    });
  },
);

const logical_or_expression: ParserValue<Expression> = lazy(
  "logical or",
  () => {
    return chain_left(logical_and_expression, ["||"]);
  },
);
const logical_and_expression: ParserValue<Expression> = lazy(
  "logical and",
  () => {
    return chain_left(equality_expression, ["&&"]);
  },
);
const equality_expression: ParserValue<Expression> = lazy("equality", () => {
  return chain_left(comparison_expression, ["==", "!="]);
});
const comparison_expression: ParserValue<Expression> = lazy(
  "comparison",
  () => {
    return chain_left(term_expression, [
      "<=",
      ">=",
      "<",
      ">",
    ]);
  },
);
const term_expression: ParserValue<Expression> = lazy("term", () => {
  return chain_left(factor_expression, ["+", "-"]);
});
const factor_expression: ParserValue<Expression> = lazy("factor", () => {
  return chain_left(unary_expression, ["*", "/", "%"]);
});

const unary_expression: ParserValue<Expression> = lazy("unary", () => {
  const operator = choice<UnaryOperator>([
    symbol("!").map(() => {
      return "!";
    }),
    symbol("-").map(() => {
      return "-";
    }),
  ]);

  const prefixed = Do(function* () {
    const parsed_operator = yield* operator;
    const argument = yield* unary_expression;

    return {
      kind: "unary_expression",
      operator: parsed_operator,
      argument,
    } satisfies UnaryExpression;
  });

  return choice<Expression>([
    prefixed,
    postfix_expression,
  ]);
});

const postfix_expression: ParserValue<Expression> = lazy("postfix", () => {
  return label(
    primary_expression.bind((base) => {
      return many(postfix_suffix).map((suffixes) => {
        let current = base;

        for (const suffix of suffixes) {
          const [tag, payload] = suffix;

          switch (tag) {
            case "call":
              current = {
                kind: "call_expression",
                callee: current,
                arguments: payload,
              } satisfies CallExpression;
              break;
            case "member":
              current = {
                kind: "member_expression",
                object: current,
                property: payload,
              } satisfies MemberExpression;
              break;
            case "index":
              current = {
                kind: "index_expression",
                object: current,
                index: payload,
              } satisfies IndexExpression;
              break;
          }
        }

        return current;
      });
    }),
    "postfix expression",
  );
});

const postfix_suffix: ParserValue<PostfixSuffix> = lazy(
  "postfix suffix",
  () => {
    const call_suffix = parens(sep_end_by(expression, comma())).map((args) => {
      return ["call", args] as const;
    });
    const member_suffix = right(symbol("."), identifier).map((name) => {
      return ["member", name] as const;
    });
    const index_suffix = brackets(expression).map((index) => {
      return ["index", index] as const;
    });

    return choice<PostfixSuffix>([
      call_suffix,
      member_suffix,
      index_suffix,
    ]);
  },
);

const primary_expression: ParserValue<Expression> = lazy("primary", () => {
  return choice<Expression>([
    literal_expression,
    array_expression,
    record_expression,
    identifier_expression,
    parens(expression),
  ]);
});

const literal_expression: ParserValue<LiteralExpression> = lazy(
  "literal",
  () => {
    return label(
      choice<LiteralExpression>([
        string_literal.map((value) => {
          return {
            kind: "literal_expression",
            value,
          } satisfies LiteralExpression;
        }),
        integer_literal.map((value) => {
          return {
            kind: "literal_expression",
            value,
          } satisfies LiteralExpression;
        }),
        keyword("true").map(() => {
          return {
            kind: "literal_expression",
            value: true,
          } satisfies LiteralExpression;
        }),
        keyword("false").map(() => {
          return {
            kind: "literal_expression",
            value: false,
          } satisfies LiteralExpression;
        }),
        keyword("null").map(() => {
          return {
            kind: "literal_expression",
            value: null,
          } satisfies LiteralExpression;
        }),
      ]),
      "literal",
    );
  },
);

const identifier_expression: ParserValue<IdentifierExpression> = lazy(
  "identifier expression",
  () => {
    return label(
      identifier.map((name) => {
        return {
          kind: "identifier_expression",
          name,
        } satisfies IdentifierExpression;
      }),
      "identifier expression",
    );
  },
);

const array_expression: ParserValue<ArrayExpression> = label(
  brackets(sep_end_by(expression, comma())).map((items) => {
    return {
      kind: "array_expression",
      items,
    } satisfies ArrayExpression;
  }),
  "array expression",
);

const record_expression: ParserValue<RecordExpression> = lazy(
  "record expression",
  () => {
    return label(
      braces(sep_end_by(record_field, comma())).map((fields) => {
        return {
          kind: "record_expression",
          fields,
        } satisfies RecordExpression;
      }),
      "record expression",
    );
  },
);

const record_field: ParserValue<RecordField> = lazy("record field", () => {
  return label(
    Do(function* () {
      const name = yield* identifier;
      yield* symbol(":");
      const value = yield* expression;

      return {
        name,
        value,
      } satisfies RecordField;
    }),
    "record field",
  );
});

function let_binding(): ParserValue<{
  readonly name: string;
  readonly annotation: TypeNode | undefined;
  readonly value: Expression;
}> {
  return Do(function* () {
    yield* keyword("let");
    const name = yield* identifier;
    const annotation = yield* optional(right(symbol(":"), type_node));
    yield* symbol("=");
    const value = yield* expression;
    yield* symbol(";");

    return {
      name,
      annotation,
      value,
    };
  });
}

function chain_left(
  operand: ParserValue<Expression>,
  operators: readonly BinaryOperator[],
): ParserValue<Expression> {
  const operator = choice(
    operators.map((value) => {
      return symbol(value).map(() => {
        return value;
      });
    }),
  );
  const tail = Do(function* () {
    const parsed_operator = yield* operator;
    const right = yield* operand;

    return {
      operator: parsed_operator,
      right,
    };
  });

  return operand.bind((first) => {
    return many(tail).map((items) => {
      let current = first;

      for (const item of items) {
        current = {
          kind: "binary_expression",
          operator: item.operator,
          left: current,
          right: item.right,
        } satisfies BinaryExpression;
      }

      return current;
    });
  });
}

const identifier: ParserValue<string> = label(
  lexeme(
    Do(function* () {
      const first = yield* satisfy("identifier start", is_identifier_start);
      const rest = yield* take_while(
        "identifier character",
        is_identifier_continue,
      );
      const name = first + rest;

      if (reserved_words.has(name)) {
        yield* fail("identifier", "reserved word");
      }

      return name;
    }),
  ),
  "identifier",
);

const integer_literal: ParserValue<number> = label(
  lexeme(
    take_while("digit", is_digit, 1).bind((text) => {
      const value = Number.parseInt(text, 10);

      if (!Number.isSafeInteger(value)) {
        return fail("safe integer", "integer is too large");
      }

      return succeed(value);
    }),
  ),
  "integer",
);

const string_literal: ParserValue<string> = lazy("string literal", () => {
  return label(
    lexeme(
      quoted_string_body(many(string_character)).map((characters) => {
        return characters.join("");
      }),
    ),
    "string literal",
  );
});

const string_character: ParserValue<string> = choice([
  right(
    char("\\"),
    choice([
      char("n").map(() => {
        return "\n";
      }),
      char("r").map(() => {
        return "\r";
      }),
      char("t").map(() => {
        return "\t";
      }),
      char('"').map(() => {
        return '"';
      }),
      char("\\").map(() => {
        return "\\";
      }),
    ]),
  ),
  satisfy("string character", (value) => {
    if (value === '"') {
      return false;
    }

    if (value === "\\") {
      return false;
    }

    if (value === "\n") {
      return false;
    }

    if (value === "\r") {
      return false;
    }

    return true;
  }),
]);

export const sample_program = `// A deliberately nontrivial source file.
import "std/http" as http;

type User = {
  id: Int,
  name: String,
  active: Bool,
  roles: [String]
};

fn score(user: User, events: [Event]) -> Int {
  let total: Int = 0;
  let adjusted = user.profile.weight + events[0].weight * 2;

  if adjusted > 10 && user.active {
    return adjusted;
  } else {
    return total;
  }
}

fn main() -> Int {
  let user = { id: 42, name: "Ada", active: true, roles: ["admin", "ops"] };
  return score(user, [{ weight: 7 }, { weight: 3 }]);
}
`;

export const broken_program = `fn broken(user: User) -> Int {
  let adjusted = user.profile.weight + ;
  return adjusted;
}
`;
