// deno-lint-ignore-file no-constant-condition -- compile-only negative API assertions
import { assert_equals, assert_true } from "./assert.ts";
import {
  $slot,
  type As,
  type Data,
  data,
  define_data,
  dictionary_of,
  field,
  kind,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { collect, Eq, Monad } from "./typeclasses.ts";
import { Just, Maybe } from "./maybe.ts";
import { identity } from "./identity.ts";
import { Effect, Program, run } from "./effects.ts";
import {
  handle_operations,
  provide_reader,
  provide_state,
  provide_writer,
  run_cells,
} from "./handlers.ts";
import { reader } from "./reader.ts";
import { state } from "./state.ts";
import { writer_cell } from "./writer.ts";
import { ArrayT, type AsArray } from "./array.ts";

Deno.test("inferred collect preserves record, tuple, symbol and context types", () => {
  const key = Symbol("key");
  const result: Maybe<{ readonly a: number; readonly b: string }> = collect({
    a: Just(1),
    b: Just("two"),
  });
  assert_equals(result.value(), ["Just", { a: 1, b: "two" }]);
  const tuple: Maybe<readonly [number, string]> = collect([
    Just(1),
    Just("two"),
  ]);
  assert_equals(tuple.value(), ["Just", [1, "two"]]);
  assert_equals(collect({ [key]: Just(3) }).value(), ["Just", { [key]: 3 }]);
  assert_equals(dictionary_of(Just(1)), Maybe);
  if (false) {
    // @ts-expect-error an empty record needs an explicit dictionary
    collect({});
    // @ts-expect-error an empty tuple needs an explicit dictionary
    collect([]);
    // @ts-expect-error different contexts cannot be inferred as one dictionary
    collect({ a: Just(1), b: identity(1) });
  }
});

Deno.test("record schemas infer generic and fixed fields", () => {
  const token = Symbol("Box");
  const Box = define_data(token, { item: $slot, label: field<string>() });
  const value = Box({ item: 42, label: "answer" });
  const item: number = value.value().item;
  assert_equals(item, 42);
  assert_equals(value[kind], token);
  if (false) {
    // @ts-expect-error fixed schema fields retain their declared type
    Box({ item: 42, label: 1 });
  }
});

Deno.test("explicit dictionary tokens align repeated constructions", () => {
  const token = Symbol("Box");
  interface AsBox extends As<AsBox, typeof token>, Eq<AsBox>, Monad<AsBox> {
    readonly [type_item]: unknown;
    readonly [type_data]: readonly this[typeof type_item][];
  }
  const first = data<AsBox>(token);
  const second = data<AsBox>(token);
  for (const dictionary of [first, second]) {
    Eq.instance(dictionary)({
      eq(right) {
        return Object.is(this.value()[0], right.value()[0]);
      },
    });
    Monad.derive(dictionary)({
      pure<item>(value: item): Data<AsBox, item> {
        return dictionary([value]);
      },
      bind(fn) {
        return fn(this.value()[0]);
      },
    });
  }
  assert_true(
    first([1]).eq(second([1])),
    "same token must mean the same context",
  );
  assert_equals(first([1]).bind((n) => second([n + 1])).value(), [2]);
  const other = Symbol("other");
  if (false) {
    // @ts-expect-error a dictionary's runtime token must match its static identity
    data<AsBox>(other);
    // @ts-expect-error The runtime identity must be supplied.
    data<AsBox>();
  }
});

Deno.test("handler tables preserve operation output and remaining capabilities", () => {
  const read = Effect.operation<number>()("read");
  const write = Effect.operation<void>()("write");
  const events: string[] = [];
  const program = Program(function* () {
    const number = yield* Effect.send(read("counter"));
    yield* Effect.send(write(String(number)));
    return number + 1;
  });
  const handled = handle_operations(program, {
    read: (operation) => Effect.pure(operation[1].length),
    write: (operation) => {
      events.push(operation[1]);
      return Effect.pure(undefined);
    },
  });
  assert_equals(run(handled), 8);
  assert_equals(events, ["7"]);
  if (false) {
    // @ts-expect-error operation output must remain numeric
    handle_operations(program, { read: () => Effect.pure("wrong") });
    // @ts-expect-error handling read leaves write pending
    run(handle_operations(program, { read: () => Effect.pure(1) }));
  }
});

Deno.test("named cell results preserve handler order and replay", () => {
  const config = reader<"config", string>("config");
  const counter = state<"counter", number>("counter");
  const audit = writer_cell<"audit", AsArray, string>(
    "audit",
    ArrayT<string>([]),
  );
  const program = Program(function* () {
    const name = yield* config.ask();
    yield* counter.modify((n) => n + 1);
    yield* audit.tell(ArrayT([name]));
    return yield* counter.get();
  });
  const bindings = {
    configuration: provide_reader(config, "run"),
    count: provide_state(counter, 10),
    audit: provide_writer(audit, ArrayT<string>([])),
  };
  const result = run_cells(program, bindings);
  const count: number = result.states.count;
  assert_equals(count, 11);
  assert_equals(result.result, 11);
  assert_equals(result.logs.audit.value(), ["run"]);
  assert_equals(run_cells(program, bindings).states.count, 11);
  if (false) {
    // @ts-expect-error initial state must match the cell
    provide_state(counter, "wrong");
    // @ts-expect-error missing writer and reader bindings remain requirements
    run_cells(program, { count: provide_state(counter, 0) });
  }
});

Deno.test("handler tables retain emitted operations and ignore absent handlers", () => {
  const first = Effect.operation<number>()("first");
  const second = Effect.operation<number>()("second");
  const source = Effect.send(first(undefined));
  const intermediate = handle_operations(source, {
    first: () => Effect.send(second(undefined)),
  });
  const final = handle_operations(intermediate, {
    second: () => Effect.pure(42),
  });
  assert_equals(run(final), 42);
  assert_equals(run(final), 42);
  if (false) {
    // @ts-expect-error emitted operations still need handlers
    run(intermediate);
    // @ts-expect-error an undefined handler does not discharge an operation
    run(handle_operations(source, { first: undefined }));
  }
});

Deno.test("named cells preserve symbol names and own special properties", () => {
  const cell = state<"counter", number>("counter");
  const name = Symbol("final");
  const source = Program(function* () {
    yield* cell.modify((n) => n + 1);
    return yield* cell.get();
  });
  const result = run_cells(source, { [name]: provide_state(cell, 1) });
  const final: number = result.states[name];
  assert_equals(final, 2);
  const special = run_cells(source, { ["__proto__"]: provide_state(cell, 3) });
  assert_equals(special.states.__proto__, 4);
  assert_true(
    Object.hasOwn(special.states, "__proto__"),
    "special names are own fields",
  );
});
