// deno-lint-ignore-file no-constant-condition -- compile-only negative API assertions
import { assert_equals, assert_true } from "./assert.ts";
import { ArrayT } from "./array.ts";
import { Effect, Program, run } from "./effects.ts";
import { type Either, Left, map_left, Right, try_catch } from "./either.ts";
import {
  fail,
  from_maybe,
  from_nullable as except_from_nullable,
  from_validation,
  map_error as map_except_error,
  run_except,
} from "./except.ts";
import {
  handle_cells,
  handle_operations,
  prepare_handle_cells,
  provide_reader,
  provide_state,
  provide_writer,
  run_cells,
} from "./handlers.ts";
import { filter, Just, type Maybe, Nothing } from "./maybe.ts";
import { reader } from "./reader.ts";
import { state } from "./state.ts";
import { from_fn, run_task } from "./task.ts";
import {
  $slot,
  type DataOf,
  define_data,
  define_union,
  field,
  kind,
} from "./typeclass.ts";
import { Applicative } from "./typeclasses.ts";
import {
  InvalidMessages,
  Valid,
  Validation,
  validation_to_either,
} from "./validation.ts";
import { run_writer, run_writer_terminal, writer_cell } from "./writer.ts";

Deno.test("DataOf extracts clean wrapped types from define_union, define_data, and union dictionaries", () => {
  const outcome_id = Symbol("Outcome");
  const Outcome = define_union(outcome_id, ["Ok", $slot], [
    "Failed",
    field<string>(),
  ]);
  type OutcomeValue<item> = DataOf<typeof Outcome, item>;

  const ok: OutcomeValue<number> = Outcome.Ok(42);
  const failed: OutcomeValue<number> = Outcome.Failed("oops");
  assert_equals(
    ok.match({ Ok: (n) => n, Failed: () => 0 }),
    42,
  );
  assert_equals(
    failed.match({ Ok: (n) => String(n), Failed: (e) => e }),
    "oops",
  );

  const ok_has_constructor: "Ok" extends keyof OutcomeValue<number> ? true
    : false = false;
  assert_equals(ok_has_constructor, false);

  const box_id = Symbol("Box");
  const Box = define_data(box_id, { value: $slot, tag: field<string>() });
  type BoxValue<item> = DataOf<typeof Box, item>;
  const boxed: BoxValue<number> = Box({ value: 7, tag: "n" });
  assert_equals(boxed.value(), { value: 7, tag: "n" });

  const maybe_value: DataOf<typeof Maybe, number> = Just(9);
  const maybe_has_just: "Just" extends keyof typeof maybe_value ? true
    : false = false;
  assert_equals(maybe_has_just, false);
  assert_equals(maybe_value.value(), ["Just", 9]);
});

Deno.test("curried reader and state cells infer literal and symbol keys without repetition", () => {
  const config = reader<{ readonly factor: number }>()("curried-config");
  const same_config = reader<"curried-config", { readonly factor: number }>(
    "curried-config",
  );
  const counter = state<number>()("curried-counter");
  const private_symbol = Symbol("private-state");
  const isolated = state<string>()(private_symbol);

  assert_equals(config[kind], same_config[kind]);
  assert_true(isolated[kind] !== counter[kind], "symbol cell is isolated");

  const program = Program(function* () {
    const { factor } = yield* config.ask();
    yield* counter.modify((n) => n * factor);
    yield* isolated.put("done");
    return yield* counter.get();
  });

  const out = run_cells(program, {
    config: provide_reader(config, { factor: 3 }),
    counter: provide_state(counter, 4),
    isolated: provide_state(isolated, "init"),
  });
  assert_equals(out.result, 12);
  assert_equals(out.states.counter, 12);
  assert_equals(out.states.isolated, "done");

  if (false) {
    const widened: string = "curried-config";
    // @ts-expect-error widened string keys are rejected by curried reader
    reader<number>()(widened);
    // @ts-expect-error widened string keys are rejected by curried state
    state<number>()(widened);
    // @ts-expect-error inline Symbol() is widened and rejected
    state<number>()(Symbol("inline"));
  }
});

Deno.test("Effect.operation supports typed payloads, zero-payload void, .send, .is, and .tag", () => {
  const Read = Effect.operation<string, { readonly path: string }>()(
    "erg.read",
  );
  const Now = Effect.operation<number, void>()("erg.now");
  const Unconstrained = Effect.operation<number>()("erg.unconstrained");

  assert_equals(Read.tag, "erg.read");
  assert_equals(Now.tag, "erg.now");
  assert_equals(Unconstrained.tag, "erg.unconstrained");

  const read_op = Read({ path: "/a" });
  const now_op = Now();
  const free_op = Unconstrained("any");

  assert_equals(read_op, ["erg.read", { path: "/a" }]);
  assert_equals(now_op, ["erg.now"]);
  assert_equals(free_op, ["erg.unconstrained", "any"]);

  assert_true(Read.is(read_op), "Read.is matches Read operation");
  assert_equals(Read.is(now_op), false);
  assert_true(Now.is(now_op), "Now.is matches zero-payload operation");
  assert_equals(Now.is(["erg.now", 1, 2]), false);
  assert_equals(Now.is("erg.now"), false);
  assert_true(Unconstrained.is(free_op), "unconstrained .is matches");

  const unknown_op: unknown = read_op;
  if (Read.is(unknown_op)) {
    const path: string = unknown_op[1].path;
    assert_equals(path, "/a");
  }

  const program = Program(function* () {
    const content = yield* Read.send({ path: "/notes" });
    const timestamp = yield* Now.send();
    const score = yield* Unconstrained.send("bonus");
    return `${content}@${timestamp}:${score}`;
  });

  const handled = handle_operations(program, {
    "erg.read": (op) => Effect.pure("file:" + op[1].path),
    "erg.now": () => Effect.pure(100),
    "erg.unconstrained": (op) => Effect.pure(op[1].length),
  });
  assert_equals(run(handled), "file:/notes@100:5");

  if (false) {
    // @ts-expect-error typed payload rejects mismatched shape
    Read({ path: 123 });
    // @ts-expect-error typed payload .send rejects mismatched shape
    Read.send({ path: 123 });
    // @ts-expect-error zero-payload operation rejects arguments
    Now(123);
    // @ts-expect-error zero-payload .send rejects arguments
    Now.send(123);
  }
});

Deno.test("handle_cells and default writer empty logs compose with Task, Fails, and custom operations", async () => {
  const config = reader<{ readonly prefix: string }>()("comp-config");
  const counter = state<number>()("comp-counter");
  const audit = writer_cell("comp-audit", ArrayT<string>([]));
  const Fetch = Effect.operation<string, string>()("comp.fetch");

  const program = Program(function* () {
    const { prefix } = yield* config.ask();
    const fetched = yield* Fetch.send("item");
    const extra = yield* from_fn(async () => {
      await Promise.resolve();
      return fetched.toUpperCase();
    });
    yield* counter.modify((n) => n + 1);
    yield* audit.tell(ArrayT([`${prefix}:${extra}`]));
    return `${prefix}:${extra}`;
  });

  const handle_app_cells = prepare_handle_cells({
    cfg: provide_reader(config, { prefix: "v1" }),
    count: provide_state(counter, 10),
    audit: provide_writer(audit),
  });

  const run_once = () =>
    Effect.interpret(program)
      .handle((effect) =>
        handle_operations(effect, {
          "comp.fetch": (op) => Effect.pure("got-" + op[1]),
        })
      )
      .handle(handle_app_cells)
      .run(run_task);

  const first = await run_once();
  const second = await run_once();

  assert_equals(first.result, "v1:GOT-ITEM");
  assert_equals(first.states.count, 11);
  assert_equals(first.logs.audit.value(), ["v1:GOT-ITEM"]);
  assert_equals(second.states.count, 11);
  assert_equals(second.logs.audit.value(), ["v1:GOT-ITEM"]);

  // Direct handle_cells with Fails remaining
  const fallible = Program(function* () {
    yield* audit.tell(ArrayT(["before"]));
    const n = yield* counter.get();
    if (n === 0) yield* fail("zero");
    return n;
  });
  const ok_outcome = run(
    run_except(
      handle_cells(fallible, {
        count: provide_state(counter, 5),
        audit: provide_writer(audit),
      }),
    ),
  );
  assert_true(Right.is(ok_outcome), "expected Right outcome");
  if (Right.is(ok_outcome)) {
    assert_equals(ok_outcome.value()[1].result, 5);
    assert_equals(ok_outcome.value()[1].logs.audit.value(), ["before"]);
  }

  // 2-arg run_writer and run_writer_terminal default to the cell's empty output
  const writer_only = Program(function* () {
    yield* audit.tell(ArrayT(["a"]));
    yield* audit.tell(ArrayT(["b"]));
    return 99;
  });
  const [r1, l1] = run(run_writer(audit, writer_only));
  const [r2, l2] = run_writer_terminal(audit, writer_only);
  const [r3, l3] = run_writer_terminal(audit, audit.write(7, ArrayT(["x"])));
  assert_equals([r1, l1.value()], [99, ["a", "b"]]);
  assert_equals([r2, l2.value()], [99, ["a", "b"]]);
  assert_equals([r3, l3.value()], [7, ["x"]]);

  if (false) {
    // @ts-expect-error remaining Task capability cannot pass synchronous run
    run(handle_cells(program, {
      cfg: provide_reader(config, { prefix: "v1" }),
      count: provide_state(counter, 0),
      audit: provide_writer(audit),
    }));
    // @ts-expect-error mismatched initial log type is rejected by provide_writer
    provide_writer(audit, ArrayT([1]));
  }
});

Deno.test("except bridges from_maybe, from_nullable, from_validation, and map_error work lazily", () => {
  let calls = 0;
  const lazy_err = () => {
    calls += 1;
    return "missing" as const;
  };

  const ok_program = Program(function* () {
    const a = yield* from_maybe(Just(10), lazy_err);
    const b = yield* except_from_nullable(20 as number | null, lazy_err);
    const c = yield* from_validation(Valid(12));
    return a + b + c;
  });
  assert_equals(run(run_except(ok_program)).value(), ["Right", 42]);
  assert_equals(calls, 0);

  const missing_maybe = Program(function* () {
    return yield* from_maybe(Nothing<number>(), lazy_err);
  });
  assert_equals(run(run_except(missing_maybe)).value(), ["Left", "missing"]);
  assert_equals(calls, 1);

  const missing_null = Program(function* () {
    return yield* except_from_nullable(
      undefined as number | undefined,
      () => "absent" as const,
    );
  });
  assert_equals(run(run_except(missing_null)).value(), ["Left", "absent"]);

  const invalid_program = Program(function* () {
    return yield* from_validation(InvalidMessages<number>("bad-a", "bad-b"));
  });
  const mapped_error = map_except_error(
    invalid_program,
    (errors) => errors.join(";"),
  );
  assert_equals(
    run(run_except(mapped_error)).value(),
    ["Left", "bad-a;bad-b"],
  );
});

Deno.test("Maybe.filter, Either.map_left, Either.try_catch, and Validation bridges preserve types", () => {
  const is_string = (value: string | number): value is string =>
    typeof value === "string";
  const mixed: Maybe<string | number> = Just("ada");
  const narrowed: Maybe<string> = filter(mixed, is_string);
  assert_equals(narrowed.value(), ["Just", "ada"]);
  assert_equals(filter(Just(42), (n) => n > 50).value(), ["Nothing"]);
  assert_equals(filter(Nothing<number>(), () => true).value(), ["Nothing"]);

  const left_mapped: Either<number, string> = map_left(
    Left<string, string>("boom"),
    (error) => error.length,
  );
  assert_equals(left_mapped.value(), ["Left", 4]);
  const right_untouched: Either<number, string> = map_left(
    Right<string, string>("ok"),
    (error) => error.length,
  );
  assert_equals(right_untouched.value(), ["Right", "ok"]);

  const parsed_ok = try_catch(
    () => JSON.parse('{"a":1}') as { a: number },
    (cause) => String(cause),
  );
  assert_equals(parsed_ok.value(), ["Right", { a: 1 }]);
  const parsed_err = try_catch(
    () => JSON.parse("{bad"),
    () => "invalid-json" as const,
  );
  assert_equals(parsed_err.value(), ["Left", "invalid-json"]);

  const Errors = Validation.with_semigroup<readonly string[]>({
    concat: (left, right) => [...left, ...right],
  });
  let null_calls = 0;
  const present = Errors.from_nullable("Ada" as string | null, () => {
    null_calls += 1;
    return ["required"];
  });
  assert_equals(null_calls, 0);
  const missing = Errors.from_nullable(null as string | null, () => {
    null_calls += 1;
    return ["email required"];
  });
  assert_equals(null_calls, 1);
  const from_err = Errors.from_either(
    Left<readonly string[], number>(["bad age"]),
  );
  const combined = Applicative.lift(
    (name, email, age) => ({ name, email, age }),
    present,
    missing,
    from_err,
  );
  assert_equals(validation_to_either(combined).value(), [
    "Left",
    ["email required", "bad age"],
  ]);
  assert_equals(
    validation_to_either(
      Errors.from_either(Right<readonly string[], number>(7)),
    )
      .value(),
    ["Right", 7],
  );
});
