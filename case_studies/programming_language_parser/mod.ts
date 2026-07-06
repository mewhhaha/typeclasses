import {
  broken_program,
  format_program,
  type FunctionDeclaration,
  parse_program,
  sample_program,
  type TypeDeclaration,
} from "./language.ts";
import { format_error } from "./parser.ts";

export function run_programming_language_parser_case_study() {
  const parsed = parse_program(sample_program, "sample.typeclasses");
  const [parsed_tag, parsed_payload] = parsed;

  switch (parsed_tag) {
    case "parsed": {
      console.log("parser declarations", format_program(parsed_payload));

      const types = parsed_payload.declarations.filter(is_type_declaration);
      const functions = parsed_payload.declarations.filter(
        is_function_declaration,
      );
      const score = functions.find((declaration) => {
        return declaration.name === "score";
      });

      console.log("parser type count", types.length);
      console.log("parser function count", functions.length);

      if (score !== undefined) {
        console.log("parser score params", score.parameters.length);
        console.log("parser score statements", score.body.statements.length);
        console.log(
          "parser score body",
          Deno.inspect(score.body, {
            depth: 6,
            colors: false,
          }),
        );
      }
      break;
    }

    case "failed":
      console.log("parser unexpected error", format_error(parsed_payload));
      break;
  }

  const broken = parse_program(broken_program, "broken.typeclasses");
  const [broken_tag, broken_payload] = broken;

  switch (broken_tag) {
    case "parsed":
      console.log("parser unexpected success", format_program(broken_payload));
      break;
    case "failed":
      console.log("parser error", format_error(broken_payload));
      break;
  }
}

function is_type_declaration(
  declaration: unknown,
): declaration is TypeDeclaration {
  if (typeof declaration !== "object") {
    return false;
  }

  if (declaration === null) {
    return false;
  }

  return (declaration as { readonly kind?: unknown }).kind ===
    "type_declaration";
}

function is_function_declaration(
  declaration: unknown,
): declaration is FunctionDeclaration {
  if (typeof declaration !== "object") {
    return false;
  }

  if (declaration === null) {
    return false;
  }

  return (declaration as { readonly kind?: unknown }).kind ===
    "function_declaration";
}
