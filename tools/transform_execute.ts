import { transformSync } from "oxc-transform";

/** Execute fixtures through Oxc's TypeScript erasure, without a type checker. */
export function executable_typescript(
  source: string,
  file_name = "fixture.ts",
): string {
  const result = transformSync(file_name, source, { target: "esnext" });
  if (result.errors.length > 0) {
    throw new Error(result.errors.map((error) => error.message).join("\n"));
  }
  return result.code;
}
