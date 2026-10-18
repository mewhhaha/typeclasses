import { assert_equals } from "./assert.ts";
import { Identity } from "./identity.ts";
import { Just } from "./maybe.ts";
import { Fn } from "./fn.ts";
import { $slot, define_data, field } from "./typeclass.ts";

const maybe = Just(1);
const fn = Fn((value: number) => value + 1);
const maybe_has_run: "run" extends keyof typeof maybe ? true : false = false;
const fn_has_match: "match" extends keyof typeof fn ? true : false = false;
void [maybe_has_run, fn_has_match];

Deno.test("capability members preserve callable and tagged raw Identity values", () => {
  assert_equals(Identity((value: number) => value + 1).run(2), 3);
  assert_equals(
    Identity(["tag", 2] as const).match({ tag: (value) => value + 1 }),
    3,
  );
  const token = Symbol("schema-capabilities");
  const Schema = define_data(token, [field<"tag">(), $slot] as const);
  assert_equals(Schema(["tag", 4]).match({ tag: (value) => value + 1 }), 5);
});
