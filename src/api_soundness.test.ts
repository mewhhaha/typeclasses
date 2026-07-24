import { ArrayT } from "./array.ts";
import { assert_equals, assert_true } from "./assert.ts";
import { Either } from "./either.ts";
import {
  type Effect,
  Program,
  run,
  type Uses,
  type WithoutLift,
} from "./effects.ts";
import { fn } from "./fn.ts";
import { Cons, Nil } from "./list.ts";
import { Just, Maybe, Nothing } from "./maybe.ts";
import { ask, run_reader, run_reader_terminal } from "./reader.ts";
import { get, put, run_state, run_state_terminal } from "./state.ts";
import { run_writer, tell } from "./writer.ts";
import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { Applicative, MonadError, Parse } from "./typeclasses.ts";

type Box<item> = readonly ["Box", item];

declare const first_identity: unique symbol;
declare const second_identity: unique symbol;

interface AsFirst extends As<AsFirst, typeof first_identity> {
  readonly [type_item]: unknown;
  readonly [type_data]: Box<this[typeof type_item]>;
}

interface AsSecond extends As<AsSecond, typeof second_identity> {
  readonly [type_item]: unknown;
  readonly [type_data]: Box<this[typeof type_item]>;
}

// @ts-expect-error every dictionary family requires an explicit identity token
interface AsUnidentified extends As<AsUnidentified> {
  readonly [type_item]: unknown;
  readonly [type_data]: Box<this[typeof type_item]>;
}

const First = data<AsFirst>();
const Second = data<AsSecond>();

type Config = { readonly url: string };
type Database = { readonly pool: string };

function two_environments() {
  return Program(function* () {
    const config = yield* ask<Config>();
    const database = yield* ask<Database>();
    return config.url + "/" + database.pool;
  });
}

function two_states() {
  return Program(function* () {
    const total = yield* get<number>();
    const label = yield* get<string>();
    yield* put<string>(label + "!");
    return total + ":" + label;
  });
}

function reader_and_state() {
  return Program(function* () {
    const config = yield* ask<Config>();
    const total = yield* get<number>();
    yield* put<number>(total + 1);
    return config.url + total;
  });
}

Deno.test("wrapped values retain fluent methods without becoming callable", () => {
  const incremented = Just(41).map((value) => value + 1);

  assert_equals(typeof incremented, "object");
  assert_equals(incremented instanceof Function, false);
  assert_equals(First(["Box", 1]) instanceof Function, false);
  assert_equals(incremented.value(), ["Just", 42] as const);
});

Deno.test("a dictionary without an instance leaves the method undefined", () => {
  const boxed = First(["Box", 1]) as unknown as {
    readonly bind?: unknown;
    readonly call?: unknown;
  };

  assert_equals(boxed.bind, undefined);
  assert_equals(boxed.call, undefined);
});

Deno.test("string contexts render a wrapped value through its Show instance", () => {
  assert_equals(String(Just(1)), "Just(1)");
  assert_equals(`${Nothing()}`, "Nothing");
  assert_equals(Just(1) + "", "Just(1)");
  assert_equals([Just(1), Nothing()].join(" "), "Just(1) Nothing");
  assert_equals(new Error("bad: " + Just(1)).message, "bad: Just(1)");
});

Deno.test("string contexts fall back to the raw value without a Show instance", () => {
  const rendered = String(First(["Box", 1]));

  assert_true(
    rendered.includes("Box"),
    "expected the raw tagged tuple in " + rendered,
  );
});

Deno.test("JSON round-trips a wrapped value through its dictionary", () => {
  const encoded = JSON.stringify(Just(1));

  assert_equals(encoded, '["Just",1]');
  assert_equals(JSON.stringify(Nothing()), '["Nothing"]');
  assert_equals(JSON.stringify(Either.Left(1)), '["Left",1]');
  assert_equals(JSON.stringify({ result: Just(1) }), '{"result":["Just",1]}');
  assert_equals(Maybe(JSON.parse(encoded)).value(), ["Just", 1] as const);
});

Deno.test("tagged payloads stay hidden from ordinary property access", () => {
  const list = Cons(1, Nil().value());

  assert_equals(Object.keys(Just(1)), []);
  assert_equals(Object.keys(list), []);
  assert_equals("payload" in Just(1), false);
  assert_equals("first" in list, false);
  assert_equals("second" in list, false);
  assert_equals(list.value(), ["Cons", 1, ["Nil"]] as const);
});

Deno.test("MonadError preserves a configured Either error type", () => {
  const Strings = Either.with_left<string>();
  const recovered = Strings.Left<number>("missing").catch_error((error) => {
    expect_type<string>(error);
    return Strings.Right(error.length);
  });

  assert_equals(recovered.value(), ["Right", 7] as const);
});

Deno.test("Parse runs only string-input functions", () => {
  const integer = fn((value: string) => Number.parseInt(value, 10));

  assert_equals(integer.parse("42"), 42);
  assert_equals(Parse.parse(integer, "41"), 41);
});

Deno.test("Applicative.lift infers functions beyond five arguments", () => {
  const total = Applicative.lift(
    (first, second, third, fourth, fifth, sixth) => {
      expect_type<number>(first);
      expect_type<number>(second);
      expect_type<number>(third);
      expect_type<number>(fourth);
      expect_type<number>(fifth);
      expect_type<number>(sixth);
      return first + second + third + fourth + fifth + sixth;
    },
    Just(1),
    Just(2),
    Just(3),
    Just(4),
    Just(5),
    Just(6),
  );

  assert_equals(total.value(), ["Just", 21] as const);
});

Deno.test("tagged guards reject malformed tuple arities", () => {
  assert_equals(Either.Left.is(["Left", "missing"]), true);
  assert_equals(Either.Left.is(["Left"]), false);
  assert_equals(Either.Left.is(["Left", "missing", "extra"]), false);
  assert_equals(Maybe.Just.is(["Just"]), false);
  assert_equals(Maybe.Nothing.is(["Nothing", undefined]), false);
});

Deno.test("run_reader answers every ask in the program from one environment", () => {
  const environment = { url: "https://example.test", pool: "main" };

  assert_equals(
    run(run_reader(two_environments(), environment)),
    "https://example.test/main",
  );
  assert_equals(
    run_reader_terminal(two_environments(), environment),
    "https://example.test/main",
  );
});

Deno.test("handling one dictionary leaves the other's lifts pending", () => {
  assert_equals(
    run(run_state(run_reader(reader_and_state(), { url: "a" }), 1)),
    ["a1", 2] as const,
  );
  assert_equals(
    run(run_reader(run_state(reader_and_state(), 1), { url: "a" })),
    ["a1", 2] as const,
  );
});

Deno.test("the prelude module is safe to import dynamically", async () => {
  const prelude = await import("./prelude.ts");

  assert_equals(typeof prelude.sequence_right, "function");
  assert_equals("then" in prelude, false);
});

function check_api_types(): void {
  const wrapped = Just(1);
  const number_fn = fn((value: number) => value + 1);
  const Strings = Either.with_left<string>();
  const string_error_witness = Strings.Right(1);
  const first = First(["Box", 1]);
  const second = Second(["Box", 1]);

  expect_type<Data<AsFirst, number>>(first);
  expect_type<Data<AsSecond, number>>(second);

  // @ts-expect-error wrapped values expose methods, not constructor calls
  wrapped(["Just", 2]);

  // @ts-expect-error numeric functions cannot parse string input
  number_fn.parse("41");
  // @ts-expect-error the top-level Parse operation has the same constraint
  Parse.parse(number_fn, "41");

  Strings.throw_error<number>("missing");
  MonadError.throw_error(Strings, "missing");
  MonadError.throw_error(string_error_witness, "missing");
  // @ts-expect-error the configured Either accepts only string errors
  Strings.throw_error<number>(new Error("missing"));
  // @ts-expect-error top-level MonadError preserves the associated error type
  MonadError.throw_error(Strings, new Error("missing"));
  // @ts-expect-error wrapped witnesses preserve the associated error type
  MonadError.throw_error(string_error_witness, new Error("missing"));

  // @ts-expect-error nominal identities separate identical raw shapes
  expect_type<Data<AsFirst, number>>(second);

  type Remaining = WithoutLift<Uses<AsFirst> | Uses<AsSecond>, AsFirst>;
  expect_type<Uses<AsSecond>>(null as unknown as Remaining);
  // @ts-expect-error handling First must not remove the Second requirement
  expect_type<Uses<AsFirst>>(null as unknown as Remaining);

  check_effect_handler_types();
}

// One handler consumes every lift of its dictionary, so the value it is given
// has to satisfy all of them at once. Before this was enforced, `run_reader`
// answered a `Db` ask with a `Config` and `run_state` wrote a string through a
// number slot, while the types still reported the second requirement pending.
function check_effect_handler_types(): void {
  run_reader(two_environments(), { url: "a", pool: "b" });
  // @ts-expect-error one environment has to answer both asks
  run_reader(two_environments(), { url: "a" });
  // @ts-expect-error the terminal runner reads the same environment
  run_reader_terminal(two_environments(), { url: "a" });

  // @ts-expect-error one cell cannot hold both a number and a string
  run_state(two_states(), 1);
  // @ts-expect-error the terminal runner threads the same cell
  run_state_terminal(two_states(), 1);

  const two_outputs = Program(function* () {
    yield* tell(ArrayT<string>(["a"]));
    yield* tell(ArrayT<number>([1]));
    return "done";
  });
  // @ts-expect-error one accumulator cannot concatenate both Monoids
  run_writer(two_outputs, ArrayT<string>([]));

  const reader_handled = run_reader(reader_and_state(), { url: "a" });
  const state_handled = run_state(reader_and_state(), 1);

  // @ts-expect-error handling Reader must leave the State lift pending
  expect_type<Effect<never, string>>(reader_handled);
  // @ts-expect-error handling State must leave the Reader lift pending
  expect_type<Effect<never, readonly [string, number]>>(state_handled);

  // @ts-expect-error a terminal runner cannot discharge another dictionary
  run_reader_terminal(reader_and_state(), { url: "a" });
  // @ts-expect-error a terminal runner cannot discharge another dictionary
  run_state_terminal(reader_and_state(), 1);
}

void check_api_types;

function expect_type<expected>(_value: expected): void {}
