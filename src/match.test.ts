import { assert_equals, assert_true } from "./assert.ts";
import { Left, Right } from "./either.ts";
import { Fn } from "./fn.ts";
import { from_array } from "./list.ts";
import { Just, Nothing } from "./maybe.ts";
import { match } from "./tagged.ts";
import { InvalidMessages } from "./validation.ts";
import {
  type Validation,
  Validation as ValidationDictionary,
} from "./validation.ts";

Deno.test("fluent match handles all built-in tagged wrappers", () => {
  assert_equals(
    Just(41).map((value) => value + 1).match({
      Just: (value) => value,
      Nothing: () => 0,
    }),
    42,
  );
  assert_equals(
    Nothing<number>().match({
      Just: (value) => value,
      Nothing: () => 0,
    }),
    0,
  );
  assert_equals(
    Right<string, number>(42).match({
      Left: (error) => "error: " + error,
      Right: (value) => "ok: " + String(value),
    }),
    "ok: 42",
  );
  assert_equals(
    Left<string, number>("missing").match({
      Left: (error) => "error: " + error,
      Right: (value) => "ok: " + String(value),
    }),
    "error: missing",
  );
  const validation = ValidationDictionary.with_error<string>()(
    ["valid", 2] as Validation<string, number>,
  );

  assert_equals(
    validation.match({
      valid: (value) => value * 2,
      invalid: () => 0,
    }),
    4,
  );
  assert_equals(
    InvalidMessages("bad").match({
      valid: (value) => String(value),
      invalid: (messages) => messages.join(", "),
    }),
    "bad",
  );
  assert_equals(
    from_array([1, 2]).match({
      Cons: (head) => head,
      Nil: () => 0,
    }),
    1,
  );
});

Deno.test("standalone match remains available for raw and wrapped values", () => {
  assert_equals(match(["ok", 42] as const, { ok: (value) => value + 1 }), 43);
  assert_equals(
    match(Just(2), {
      Just: (value) => value * 2,
      Nothing: () => 0,
    }),
    4,
  );
});

Deno.test("non-tagged wrapped values reject runtime matching", () => {
  let threw = false;

  try {
    (Fn((value: number) => value + 1).match as unknown as (
      cases: Record<PropertyKey, never>,
    ) => unknown)({});
  } catch (error) {
    threw = error instanceof TypeError;
  }

  assert_true(threw, "matching a non-tagged value throws TypeError");
});

Deno.test({
  name: "fluent match type errors",
  ignore: true,
  fn() {
    // @ts-expect-error exhaustive fluent matches require Nothing
    Just(1).match({ Just: (value) => value });

    // @ts-expect-error non-tagged wrapped values expose match as never
    Fn((value: number) => value).match({});
  },
});
