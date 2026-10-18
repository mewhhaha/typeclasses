import { assert_equals } from "../src/assert.ts";
import { documented_calls } from "./documentation_calls.ts";
import { documented_dictionary } from "./documentation_dictionary.ts";

Deno.test("generated documentation calling styles execute equally", () => {
  assert_equals(documented_calls(), [["Just", 42], ["Just", 42], ["Just", 42]]);
});
Deno.test("generated documentation dictionary has matching runtime identity and methods", () => {
  assert_equals(documented_dictionary(), { item: 42 });
});
