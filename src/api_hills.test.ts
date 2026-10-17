import { assert_equals, assert_true } from "./assert.ts";
import { get_or_else, Just, Maybe, Nothing, type RawMaybe } from "./maybe.ts";
import {
  bind_widen,
  type Either,
  Left,
  recover_or_else,
  Right,
} from "./either.ts";
import { $slot, define_union, field, kind } from "./typeclass.ts";
import { collect } from "./typeclasses.ts";
import { reader, run_reader_terminal } from "./reader.ts";
import { Effect } from "./effects.ts";
import { Invalid, Valid, type Validation } from "./validation.ts";

Deno.test("public ADT names describe fluent values and explicit raw boundaries", () => {
  const value: Maybe<number> = Just(4);
  const raw: RawMaybe<number> = value.value();
  const result: Either<string, number> = Right<string, number>(4);
  assert_equals(raw, ["Just", 4]);
  assert_equals(value.map((n) => n + 1).value(), ["Just", 5]);
  assert_equals(result.value(), ["Right", 4]);
});

Deno.test("runtime cell keys agree with static identities", () => {
  const first = reader<"shared-config", number>("shared-config");
  const second = reader<"shared-config", number>("shared-config");
  assert_equals(first[kind], second[kind]);
  assert_equals(run_reader_terminal(first, Effect.lift(second.ask()), 42), 42);
  const private_key = Symbol("shared-config");
  const isolated = reader<typeof private_key, number>(private_key);
  assert_true(isolated[kind] !== first[kind], "a symbol makes a private cell");
});

Deno.test("union schemas infer fixed and generic payloads and reject collisions", () => {
  const identity = Symbol("Outcome");
  const Outcome = define_union(identity, ["Ok", $slot], [
    "Error",
    field<string>(),
  ], ["Empty"]);
  assert_equals(
    Outcome.Ok(7).match({
      Ok: (n) => String(n),
      Error: (e) => e,
      Empty: () => "empty",
    }),
    "7",
  );
  assert_equals(Outcome.Error("bad").value(), ["Error", "bad"]);
  const collision_identity = Symbol("collision");
  for (
    const make of [
      () => define_union(collision_identity, ["same"], ["same"]),
      () => define_union(collision_identity, ["foo"], ["Foo"]),
      () => define_union(collision_identity, [kind]),
    ]
  ) {
    let failed = false;
    try {
      make();
    } catch (error) {
      failed = error instanceof TypeError;
    }
    assert_true(failed, "ambiguous schema must fail immediately");
  }
});

Deno.test("tagged matching reads payloads without calling raw conversion", () => {
  const value = Just(42);
  Object.defineProperty(value, "value", {
    value() {
      throw new Error("raw conversion");
    },
  });
  assert_equals(value.match({ Just: (n) => n, Nothing: () => 0 }), 42);
});

Deno.test("variant guards accept known wrapped values without raw extraction", () => {
  assert_true(Just.is(Just(1)), "wrapped Just");
  assert_equals(Just.is(Nothing()), false);
  assert_true(Right.is(Right(1)), "wrapped Right");
  assert_true(Left.is(Left("bad")), "wrapped Left");
});

Deno.test("collect preserves tuple and record inference including empty shapes", () => {
  const record: Maybe<{ readonly id: number; readonly label: string }> =
    collect(Maybe, { id: Just(1), label: Just("Ada") });
  const tuple: Maybe<readonly [number, string]> = collect(Maybe, [
    Just(1),
    Just("Ada"),
  ]);
  assert_equals(record.value(), ["Just", { id: 1, label: "Ada" }]);
  assert_equals(tuple.value(), ["Just", [1, "Ada"]]);
  assert_equals(collect(Maybe, {}).value(), ["Just", {}]);
  assert_equals(collect(Maybe, []).value(), ["Just", []]);
});

Deno.test("fallbacks are lazy and explicit error widening retains both errors", () => {
  let calls = 0;
  const fallback = () => {
    calls++;
    return 9;
  };
  assert_equals(get_or_else(Just(1), fallback), 1);
  assert_equals(calls, 0);
  assert_equals(get_or_else(Nothing<number>(), fallback), 9);
  assert_equals(calls, 1);
  assert_equals(recover_or_else(Right(1), fallback), 1);
  const first: Either<"first", number> = Right<"first", number>(1);
  const next: Either<"first" | "next", number> = bind_widen(
    first,
    () => Left<"next", number>("next"),
  );
  assert_equals(next.value(), ["Left", "next"]);
});

function rejected_api_shapes() {
  // @ts-expect-error mixed contexts cannot be collected
  collect(Maybe, { id: Just(1), label: Right("Ada") });
  const identity = Symbol("Outcome");
  const Outcome = define_union(identity, ["Error", field<string>()]);
  const broad: symbol = identity;
  // @ts-expect-error A widened symbol cannot provide a nominal identity.
  define_union(broad, ["Error", field<string>()]);
  // @ts-expect-error An inline Symbol call has the widened symbol type.
  define_union(Symbol(), ["Error", field<string>()]);
  const other_identity = Symbol("Other");
  const ambiguous_identity = Math.random() > 0.5 ? identity : other_identity;
  // @ts-expect-error A union of runtime symbols is not one nominal identity.
  define_union(ambiguous_identity, ["Error", field<string>()]);
  // @ts-expect-error fixed schema payload is a string
  Outcome.Error(7);
}
void rejected_api_shapes;

Deno.test("wrapped branch predicates narrow payloads without claiming raw tuples", () => {
  const present: Maybe<number> = Just(42);
  if (Just.is(present)) {
    const item: number = present.value()[1];
    assert_equals(item, 42);
  }
  const failed: Either<string, number> = Left<string, number>("bad");
  if (Left.is(failed)) {
    const error: string = failed.value()[1];
    assert_equals(error, "bad");
  }
  const succeeded: Either<string, number> = Right<string, number>(42);
  if (Right.is(succeeded)) {
    const item: number = succeeded.value()[1];
    assert_equals(item, 42);
  }
  const valid: Validation<string, number> = Valid(42);
  if (Valid.is(valid)) {
    const item: number = valid.value()[1];
    assert_equals(item, 42);
  }
  const invalid: Validation<string, number> = Invalid<string, number>("bad", {
    concat: (left, right) => left + right,
  });
  if (Invalid.is(invalid)) {
    const error: string = invalid.value()[1];
    assert_equals(error, "bad");
  }
  const unknown_value: unknown = Just(1);
  if (Just.is(unknown_value)) {
    // @ts-expect-error Guards also recognize wrapped values, so this is not a raw tuple.
    const raw: readonly ["Just", unknown] = unknown_value;
    void raw;
  }
});
