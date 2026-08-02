import { ArrayT, type AsArray, to_array } from "./array.ts";
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
import { ask, reader, run_reader, run_reader_terminal } from "./reader.ts";
import { get, put, run_state, run_state_terminal, state } from "./state.ts";
import {
  run_writer,
  run_writer_terminal,
  tell,
  writer_cell,
} from "./writer.ts";
import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { Applicative, Eq, MonadError, Parse } from "./typeclasses.ts";

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

const counter = state<"counter", number>();
const cursor = state<"cursor", string>();

const config_cell = reader<"config", Config>();
const database_cell = reader<"database", Database>();

const audit = writer_cell<"audit", AsArray, string>();
const metrics = writer_cell<"metrics", AsArray, number>();

type TwoEnvironments = Uses<typeof config_cell> | Uses<typeof database_cell>;

function two_environment_cells() {
  return Program.scope<TwoEnvironments>()(function* () {
    const config = yield* config_cell.ask();
    const pool = yield* database_cell.asks((value) => value.pool);
    return config.url + "/" + pool;
  });
}

type TwoOutputs = Uses<typeof audit> | Uses<typeof metrics>;

function two_output_cells() {
  return Program.scope<TwoOutputs>()(function* () {
    yield* audit.tell(ArrayT(["started"]));
    yield* metrics.tell(ArrayT([1]));
    return "done";
  });
}

type TwoCells = Uses<typeof counter> | Uses<typeof cursor>;

function two_cells() {
  return Program.scope<TwoCells>()(function* () {
    const total = yield* counter.get();
    const label = yield* cursor.get();
    yield* cursor.put(label + "!");
    yield* counter.modify((value) => value + 1);
    return label + ":" + total.toString();
  });
}

function cell_and_reader() {
  return Program(function* () {
    const config = yield* ask<Config>();
    const total = yield* counter.get();
    return config.url + total.toString();
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

Deno.test("tagged dictionaries reject malformed raw values", () => {
  for (
    const malformed of [
      null,
      ["Unknown"],
      ["Just"],
      ["Nothing", 1],
    ]
  ) {
    let failure: unknown;

    try {
      Maybe(malformed as never);
    } catch (error) {
      failure = error;
    }

    assert_true(
      failure instanceof TypeError,
      `expected ${JSON.stringify(malformed)} to be rejected`,
    );
  }
});

Deno.test("typeclass dispatch reports missing and mismatched dictionaries", () => {
  let missing: unknown;
  let mismatched: unknown;

  try {
    Eq.eq(First(["Box", 1]) as never, First(["Box", 1]) as never);
  } catch (error) {
    missing = error;
  }

  try {
    Just(1).eq(ArrayT([1]) as never);
  } catch (error) {
    mismatched = error;
  }

  assert_true(
    missing instanceof TypeError && missing.message.includes("Missing Eq"),
    "missing instances name the requested typeclass",
  );
  assert_true(
    mismatched instanceof TypeError &&
      mismatched.message.includes("same dictionary"),
    "binary methods reject values from different dictionaries",
  );
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

Deno.test("each cell is handled by its own runner, in either order", () => {
  assert_equals(
    run(run_state(cursor, run_state(counter, two_cells(), 10), "x")),
    [["x:10", 11], "x!"] as const,
  );
  assert_equals(
    run(run_state(counter, run_state(cursor, two_cells(), "x"), 10)),
    [["x:10", "x!"], 11] as const,
  );
});

Deno.test("a cell holds no initial value, so one program runs from many", () => {
  assert_equals(
    run(run_state(cursor, run_state(counter, two_cells(), 1), "a")),
    [["a:1", 2], "a!"] as const,
  );
  assert_equals(
    run(run_state(cursor, run_state(counter, two_cells(), 99), "z")),
    [["z:99", 100], "z!"] as const,
  );
});

Deno.test("a cell runner and the anonymous runner ignore each other", () => {
  const anonymous = Program(function* () {
    const value = yield* get<number>();
    yield* put(value + 1);
    return value;
  });

  assert_equals(run(run_state(anonymous, 41)), [41, 42] as const);

  const only_counter = Program(function* () {
    yield* counter.put(5);
    return yield* counter.get();
  });

  assert_equals(run_state_terminal(counter, only_counter, 0), [5, 5] as const);
});

Deno.test("Reader cells answer two environments independently", () => {
  const environment = { url: "https://example.test" };
  const database = { pool: "main" };

  assert_equals(
    run(
      run_reader(
        database_cell,
        run_reader(config_cell, two_environment_cells(), environment),
        database,
      ),
    ),
    "https://example.test/main",
  );
  assert_equals(
    run(
      run_reader(
        config_cell,
        run_reader(database_cell, two_environment_cells(), database),
        environment,
      ),
    ),
    "https://example.test/main",
  );
});

Deno.test("Writer cells accumulate into separate Monoids", () => {
  const [[value, audit_log], metric_log] = run(
    run_writer(
      metrics,
      run_writer(audit, two_output_cells(), ArrayT<string>([])),
      ArrayT<number>([]),
    ),
  );

  assert_equals(value, "done");
  assert_equals(to_array(audit_log), ["started"]);
  assert_equals(to_array(metric_log), [1]);
});

Deno.test("every cell family composes in one program", () => {
  const mixed = Program(function* () {
    const config = yield* config_cell.ask();
    const total = yield* counter.get();

    yield* audit.tell(ArrayT([config.url]));
    yield* counter.put(total + 1);

    return config.url + ":" + total.toString();
  });

  const [[value, final], log] = run(
    run_writer(
      audit,
      run_state(counter, run_reader(config_cell, mixed, { url: "u" }), 5),
      ArrayT<string>([]),
    ),
  );

  assert_equals(value, "u:5");
  assert_equals(final, 6);
  assert_equals(to_array(log), ["u"]);
});

Deno.test("terminal cell runners exist for every cell family", () => {
  const state_only = Program(function* () {
    return yield* counter.get();
  });
  const reader_only = Program(function* () {
    return yield* config_cell.asks((value) => value.url);
  });
  const writer_only = Program(function* () {
    yield* audit.tell(ArrayT(["entry"]));
    return "done";
  });

  assert_equals(run_state_terminal(counter, state_only, 7), [7, 7] as const);
  assert_equals(
    run_reader_terminal(config_cell, reader_only, { url: "u" }),
    "u",
  );

  const [value, log] = run_writer_terminal(
    audit,
    writer_only,
    ArrayT<string>([]),
  );
  assert_equals(value, "done");
  assert_equals(to_array(log), ["entry"]);
});

Deno.test("a terminal cell runner names the cell it cannot discharge", () => {
  let message = "";

  try {
    run_state_terminal(counter, cursor.get() as never, 0);
  } catch (error) {
    message = (error as Error).message;
  }

  assert_equals(message, "Unhandled effect operation: lift");
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

  check_state_cell_types();
}

// A cell carries its key in both worlds at once: as a `unique symbol` type the
// compiler can tell apart, and as the runtime kind its lifts are stamped with.
// Neither can drift from the other, so a handler removes exactly its own cell's
// lifts — where the anonymous `State` removes every State lift there is.
function check_state_cell_types(): void {
  run_state(counter, two_cells(), 0);
  // @ts-expect-error the counter cell holds a number
  run_state(counter, two_cells(), "nope");
  // @ts-expect-error the cursor cell holds a string
  run_state(cursor, two_cells(), 0);

  const counter_handled = run_state(counter, two_cells(), 0);
  expect_type<Effect<Uses<typeof cursor>, readonly [string, number]>>(
    counter_handled,
  );
  // @ts-expect-error handling counter must leave the cursor lift pending
  expect_type<Effect<never, readonly [string, number]>>(counter_handled);

  expect_type<Effect<never, readonly [string, never]>>(
    // @ts-expect-error the anonymous runner must not discharge cell lifts
    run_state(two_cells(), 0 as never),
  );

  const anonymous = Program(function* () {
    return yield* get<number>();
  });
  expect_type<Effect<never, readonly [number, number]>>(
    // @ts-expect-error a cell runner must not discharge anonymous State lifts
    run_state(counter, anonymous, 0),
  );

  // @ts-expect-error the cursor lift is still pending
  run_state_terminal(counter, two_cells(), 0);

  expect_type<Effect<never, readonly [string, number]>>(
    // @ts-expect-error handling a cell must leave the Reader lift pending
    run_state(counter, cell_and_reader(), 0),
  );

  // A key that is not a literal carries no identity, so every cell declared
  // that way would share one type over distinct runtime symbols — the compiler
  // believing two cells were one. Rejected at the declaration instead.
  // @ts-expect-error `string` is not a key
  state<string, number>().get();
  // @ts-expect-error `symbol` is not a key
  state<symbol, number>().get();
  // @ts-expect-error `PropertyKey` is not a key
  state<PropertyKey, number>().get();

  // @ts-expect-error distinct keys give distinct cells
  expect_type<ReturnType<typeof counter.get>>(cursor.get());

  check_reader_cell_types();
  check_writer_cell_types();
}

function check_reader_cell_types(): void {
  run_reader(config_cell, two_environment_cells(), { url: "a" });
  // @ts-expect-error the config cell reads a Config
  run_reader(config_cell, two_environment_cells(), { pool: "a" });

  const config_handled = run_reader(config_cell, two_environment_cells(), {
    url: "a",
  });
  expect_type<Effect<Uses<typeof database_cell>, string>>(config_handled);
  // @ts-expect-error answering config must leave the database lift pending
  expect_type<Effect<never, string>>(config_handled);

  expect_type<Effect<never, string>>(
    // @ts-expect-error the anonymous runner must not answer cell lifts
    run_reader(two_environment_cells(), {} as never),
  );

  // @ts-expect-error the database lift is still pending
  run_reader_terminal(config_cell, two_environment_cells(), { url: "a" });

  // @ts-expect-error `string` is not a key
  reader<string, Config>().ask();
}

function check_writer_cell_types(): void {
  run_writer(audit, two_output_cells(), ArrayT<string>([]));
  // @ts-expect-error the audit cell accumulates strings
  run_writer(audit, two_output_cells(), ArrayT<number>([]));

  const audit_handled = run_writer(
    audit,
    two_output_cells(),
    ArrayT<string>([]),
  );
  expect_type<Effect<Uses<typeof metrics>, readonly [string, unknown]>>(
    audit_handled,
  );
  // @ts-expect-error draining audit must leave the metrics lift pending
  expect_type<Effect<never, readonly [string, unknown]>>(audit_handled);

  // @ts-expect-error the metrics lift is still pending
  run_writer_terminal(audit, two_output_cells(), ArrayT<string>([]));

  // @ts-expect-error `string` is not a key
  writer_cell<string, AsArray, string>().tell(ArrayT(["x"]));
}

void check_api_types;

function expect_type<expected>(_value: expected): void {}
