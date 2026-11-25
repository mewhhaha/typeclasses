// deno-lint-ignore-file no-constant-condition -- compile-only negative API assertions
import { assert_equals, assert_true } from "./assert.ts";
import { ArrayT } from "./array.ts";
import { Effect, Program, run } from "./effects.ts";
import { Either, Left, map_left, Right, try_catch } from "./either.ts";
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
  prepare_cells,
  prepare_handle_cells,
  prepare_operations,
  provide_reader,
  provide_state,
  provide_writer,
  run_cells,
} from "./handlers.ts";
import { filter, Just, Maybe, Nothing } from "./maybe.ts";
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

Deno.test("fused multi-cell handlers and buffered run_writer preserve replay isolation and custom concat", async () => {
  const {
    from_array: iter_from_array,
    to_array: iter_to_array,
    compile_fold,
    filter_map,
  } = await import("./iterable.ts");
  const { Foldable } = await import("./typeclasses/foldable.ts");

  // 1. Multi-cell replay safety with branching ArrayT + Fails + buffered Writer
  const cnt = state<number>()("replay_cnt");
  const log = writer_cell("replay_log", ArrayT<string>([]));
  const step_op = Effect.operation<number, void>()("branch.pick");
  const prog = Program(function* () {
    yield* cnt.modify((n) => n + 1);
    yield* log.tell(ArrayT(["a"]));
    yield* log.tell(ArrayT(["b"]));
    const branch = yield* step_op.send();
    yield* cnt.modify((n) => n + branch);
    yield* log.tell(ArrayT([`branch:${branch}`]));
    return yield* cnt.get();
  });
  const handled = handle_cells(prog, {
    cnt: provide_state(cnt, 10),
    log: provide_writer(log),
  });
  assert_true(handled[0] === "impure", "expected suspended branch op");
  if (handled[0] === "impure") {
    const first = handled[2](1);
    const second = handled[2](5);
    assert_true(
      first[0] === "pure" && second[0] === "pure",
      "expected both resumed branches to complete",
    );
    if (first[0] === "pure" && second[0] === "pure") {
      assert_equals(first[1].result, 12);
      assert_equals(first[1].states.cnt, 12);
      assert_equals(first[1].logs.log.value(), ["a", "b", "branch:1"]);
      assert_equals(second[1].result, 16);
      assert_equals(second[1].states.cnt, 16);
      assert_equals(second[1].logs.log.value(), ["a", "b", "branch:5"]);
    }
  }

  // 2. Non-terminal run_writer replay isolation
  const wprog = Program(function* () {
    yield* log.tell(ArrayT(["init"]));
    const branch = yield* step_op.send();
    yield* log.tell(ArrayT([`w:${branch}`]));
    return branch;
  });
  const whandled = run_writer(log, wprog);
  assert_true(whandled[0] === "impure", "expected suspended writer op");
  if (whandled[0] === "impure") {
    const a = whandled[2](1);
    const b = whandled[2](2);
    assert_true(
      a[0] === "pure" && b[0] === "pure",
      "expected both resumed writer branches to complete",
    );
    if (a[0] === "pure" && b[0] === "pure") {
      assert_equals(a[1][1].value(), ["init", "w:1"]);
      assert_equals(b[1][1].value(), ["init", "w:2"]);
    }
  }

  // 3. Duplicate cell keys preserve property-order precedence (first wins)
  const dup = run_cells(
    Program(function* () {
      yield* cnt.modify((n) => n + 3);
      return yield* cnt.get();
    }),
    {
      first: provide_state(cnt, 10),
      second: provide_state(cnt, 99),
    },
  );
  assert_equals(dup.result, 13);
  assert_equals(dup.states, { first: 13, second: 99 });

  // 4. Generalized generator-less IterableT pipelines across shapes and take(0)
  let opened = 0;
  const tracked = iter_from_array([1, 2, 3, 4, 5, 6]);
  const mf = tracked.map((n) => n * 2).filter((n) => n > 4);
  const fm = tracked.filter((n) => n % 2 === 0).map((n) => n + 10);
  const fmp = filter_map(
    tracked,
    (n) => (n % 2 === 1 ? Just(n * 10) : Nothing<number>()),
  );
  const multi = tracked.map((n) => n + 1).filter((n) => n > 2).map((n) => n * 2)
    .take(2);
  assert_equals(iter_to_array(mf), [6, 8, 10, 12]);
  assert_equals(compile_fold(mf)(0, (a, b) => a + b), 36);
  assert_equals(iter_to_array(fm), [12, 14, 16]);
  assert_equals(compile_fold(fm)(0, (a, b) => a + b), 42);
  assert_equals(iter_to_array(fmp), [10, 30, 50]);
  assert_equals(compile_fold(fmp)(0, (a, b) => a + b), 90);
  assert_equals(iter_to_array(multi), [6, 8]);
  assert_equals(compile_fold(multi)(0, (a, b) => a + b), 14);
  assert_equals(Foldable.some(mf, (n) => n === 10), true);
  assert_equals(Foldable.find(mf, (n) => n > 8), 10);

  const never_open = (await import("./iterable.ts")).from_factory(function* () {
    opened += 1;
    yield 1;
  }).take(0);
  assert_equals(iter_to_array(never_open), []);
  assert_equals(compile_fold(never_open)(0, (a, b) => a + b), 0);
  assert_equals(Foldable.some(never_open, () => true), false);
  assert_equals(opened, 0);
});

Deno.test("round-2 runtime hills preserve operation table, STM journal, and multi-cell invariants", async () => {
  const {
    Stm,
    atomically,
    new_tvar,
    or_else,
    read_tvar,
    retry,
    write_tvar,
  } = await import("./stm.ts");
  const { run_reader, run_reader_terminal } = await import("./reader.ts");

  // 1. Direct handle_operations & prepare_operations loops preserve isolation,
  // replay, `this` binding, and invalid handler return errors.
  const Add = Effect.operation<number, number>()("add");
  const AskExt = Effect.operation<number, null>()("ask_ext");
  let offset = 10;
  const table = {
    add: (op: readonly ["add", number]): Effect<never, number> =>
      Effect.pure(op[1] + offset),
  };
  const prepared = prepare_operations(table);
  offset = 100;
  table.add = (op: readonly ["add", number]) => Effect.pure(op[1] + 999);
  const eff_ops = Program(function* () {
    const x = yield* AskExt.send(null);
    return yield* Add.send(x);
  });
  const suspended_prepared = prepared(eff_ops);
  assert_true(
    suspended_prepared[0] === "impure",
    "unmatched op must remain suspended",
  );
  if (suspended_prepared[0] === "impure") {
    assert_equals(run(suspended_prepared[2](5) as Effect<never, number>), 105);
    assert_equals(run(suspended_prepared[2](7) as Effect<never, number>), 107);
  }
  const live = handle_operations(Add.send(5), table);
  assert_equals(run(live), 1004);

  let threw_invalid = false;
  try {
    prepare_operations({
      add: () => "not-an-effect" as unknown as Effect<never, number>,
    })(Add.send(1));
  } catch (error) {
    threw_invalid = error instanceof TypeError;
  }
  assert_true(threw_invalid, "invalid handler return must throw TypeError");

  // 2. Tuple-free run_reader preserves replay isolation on non-terminal suspension.
  const rcell = reader<number>()("r_replay");
  const r_prog = Program(function* () {
    const a = yield* rcell.ask();
    const b = yield* AskExt.send(null);
    const c = yield* rcell.ask();
    return a + b + c;
  });
  const r_susp = run_reader(rcell, r_prog, 10);
  assert_true(r_susp[0] === "impure", "unmatched op must stay suspended");
  if (r_susp[0] === "impure") {
    assert_equals(run(r_susp[2](3) as Effect<never, number>), 23);
    assert_equals(run(r_susp[2](4) as Effect<never, number>), 24);
  }
  assert_equals(
    run_reader_terminal(
      rcell,
      Program(function* () {
        const x = yield* rcell.ask();
        const y = yield* rcell.asks((n) => n * 2);
        return x + y;
      }),
      7,
    ),
    21,
  );

  // 3. Inline STM journal handles 1-TVar, 2..8 TVars, >8 TVar Map promotion,
  // nested or_else rollback/merge, and escaped journal reads/writes getters.
  const tv1 = new_tvar(1);
  assert_equals(
    atomically(
      read_tvar(tv1).bind((n) => write_tvar(tv1, n + 4).map(() => n + 4)),
    ),
    5,
  );
  assert_equals(atomically(read_tvar(tv1)), 5);

  const tvars = Array.from({ length: 12 }, (_, i) => new_tvar(i));
  const sum_12 = atomically(
    tvars.reduce(
      (acc, tv, idx) =>
        acc.bind((total) =>
          read_tvar(tv).bind((v) =>
            write_tvar(tv, v + idx).map(() => total + v + idx)
          )
        ),
      Stm.pure(0),
    ),
  );
  assert_equals(sum_12, 132);
  assert_equals(atomically(read_tvar(tvars[11])), 22);

  const tv_obj = new_tvar({ count: 1 });
  const leaked = atomically(
    or_else(
      read_tvar(tv_obj).bind((o) =>
        write_tvar(tv_obj, { count: o.count + 50 }).bind(() =>
          retry<{ count: number }>()
        )
      ),
      read_tvar(tv_obj).bind((o) =>
        write_tvar(tv_obj, { count: o.count + 2 }).bind(() => read_tvar(tv_obj))
      ),
    ),
  );
  leaked.count = 999; // Mutating exposed read after commit must not corrupt TVar.
  assert_equals(atomically(read_tvar(tv_obj)), { count: 3 });

  const escaped_ok = atomically(
    read_tvar(tv1).bind((before) =>
      Stm((journal) => {
        const key = tv1 as unknown as typeof tv1 & {
          readonly [k: symbol]: (x: unknown) => unknown;
        };
        assert_true(
          journal.reads.get(key as never) === before,
          "escaped journal.reads must materialize inline reads",
        );
        journal.writes.set(key as never, before + 10);
        return journal.writes.size;
      })
    ),
  );
  assert_equals(escaped_ok, 1);
  assert_equals(atomically(read_tvar(tv1)), 15);

  // 4. Multi-cell inline dispatch (<=3 cells) and Map fallback (5 cells).
  const c1 = reader<number>()("c1");
  const c2 = state<number>()("c2");
  const c3 = state<number>()("c3");
  const c4 = state<number>()("c4");
  const c5 = writer_cell("c5", ArrayT<number>([]));
  const run5 = prepare_cells({
    c1: provide_reader(c1, 2),
    c2: provide_state(c2, 10),
    c3: provide_state(c3, 20),
    c4: provide_state(c4, 30),
    c5: provide_writer(c5),
  });
  const out5 = run5(
    Program(function* () {
      const k = yield* c1.ask();
      yield* c2.modify((n) => n + k);
      yield* c3.modify((n) => n + k);
      yield* c4.modify((n) => n + k);
      yield* c5.tell(ArrayT([k]));
      return (yield* c2.get()) + (yield* c3.get()) + (yield* c4.get());
    }),
  );
  assert_equals(out5.result, 66);
  assert_equals(out5.states, { c2: 12, c3: 22, c4: 32 });
  assert_equals(out5.logs.c5.value(), [2]);
});

Deno.test("round-3 runtime hills preserve deep Effect fusion, fast Do semantics, IterableT pipelines, and iterative run_state", async () => {
  const { Identity, identity } = await import("./identity.ts");
  const { Do } = await import("./typeclasses.ts");
  const { from_array: iter_from_array, to_array: iter_to_array } = await import(
    "./iterable.ts"
  );
  const { Foldable } = await import("./typeclasses/foldable.ts");
  const { get, modify, run_state, run_state_terminal } = await import(
    "./state.ts"
  );

  // R1: 50,000-deep Effect.bind right-identity fusion stays stack-safe
  const step_inc = modify((n: number) => n + 1);
  let deep = Effect.from(step_inc);
  for (let i = 0; i < 49_999; i += 1) {
    deep = Effect.bind(deep, () => Effect.from(step_inc));
  }
  const [, deep_state] = run_state_terminal(deep, 0);
  assert_equals(deep_state, 50_000);

  // R1: Program direct Data lifting preserves multi-shot branch replay
  const pick = Effect.operation<number, void>()("r3.pick");
  const replayable = Program(function* () {
    yield* modify((n: number) => n + 1);
    const k = yield* pick.send();
    yield* modify((n: number) => n + k);
    return yield* get<number>();
  });
  const suspended = run_state(replayable, 10);
  assert_true(suspended[0] === "impure", "expected suspended op");
  if (suspended[0] === "impure") {
    const a = suspended[2](2);
    const b = suspended[2](7);
    assert_true(a[0] === "pure" && b[0] === "pure", "expected pure branches");
    if (a[0] === "pure" && b[0] === "pure") {
      assert_equals(a[1], [13, 13]);
      assert_equals(b[1], [18, 18]);
    }
  }

  // R2: Fast Do(Maybe / Either / Identity) preserves short-circuit, try/catch, and throw-to-Left
  const m_ok = Do(Maybe, function* () {
    const a = yield* Just(10);
    const b = yield* Just(20);
    return a + b;
  });
  assert_equals(m_ok.value(), ["Just", 30]);
  const m_none = Do(Maybe, function* () {
    const a = yield* Just(10);
    const b = yield* Nothing<number>();
    return a + b;
  });
  assert_equals(m_none.value(), ["Nothing"]);
  const e_ok = Do(Either, function* () {
    const a = yield* Right(4);
    const b = yield* Right(6);
    return a * b;
  });
  assert_equals(e_ok.value(), ["Right", 24]);
  const e_left = Do(Either.with_left<string>(), function* () {
    const a = yield* Right<string, number>(4);
    const b = yield* Left<string, number>("nope");
    return a + b;
  });
  assert_equals(e_left.value(), ["Left", "nope"]);
  const e_throw = Do(Either, function* () {
    const a = yield* Right<unknown, number>(4);
    if (a > 0) throw "boom";
    return a;
  });
  assert_equals(e_throw.value(), ["Left", "boom"]);
  const id_val = Do(Identity, function* () {
    const a = yield* identity(3);
    const b = yield* identity(9);
    return a + b;
  });
  assert_equals(id_val.value(), 12);

  // R3: Specialized 1- and 2-stage IterableT push loops observe live array growth and early exit
  const growing = [1, 2, 3];
  const grown = iter_to_array(
    iter_from_array(growing)
      .filter((n) => {
        if (n === 2) growing.push(4);
        return n % 2 === 0;
      })
      .map((n) => n * 10),
  );
  assert_equals(grown, [20, 40]);

  let visited = 0;
  const found = Foldable.find(
    iter_from_array([1, 2, 3, 4, 5])
      .map((n) => {
        visited += 1;
        return n * 3;
      })
      .filter((n) => n > 6),
    (n) => n >= 9,
  );
  assert_equals(found, 9);
  assert_equals(visited, 3);
});

Deno.test("round-4 runtime hills cover specialized traversals, dense collect, Task fast plans, merged Computation, and Writer ArrayT concat", async () => {
  const { Identity, identity } = await import("./identity.ts");
  const { collect, Traversable } = await import("./typeclasses.ts");
  const { traverse_sequential } = await import("./traversal.ts");
  const { Reader, ask } = await import("./reader.ts");
  const { State, get, modify } = await import("./state.ts");
  const { ParallelTask, sequential, Task, traverse_task } = await import(
    "./task.ts"
  );
  const { tell, run_writer_terminal } = await import("./writer.ts");

  // R1a: Specialized Maybe / Either / Identity Traversable.traverse preserves Applicative eager evaluation
  let maybe_calls = 0;
  const m_trav_ok = Traversable.traverse(
    ArrayT([1, 2, 3, 4]),
    Maybe,
    (n) => {
      maybe_calls += 1;
      return Just(n * 10);
    },
  );
  assert_equals(maybe_calls, 4);
  const m_trav_raw = m_trav_ok.value();
  assert_equals(m_trav_raw[0], "Just");
  if (m_trav_raw[0] === "Just") {
    assert_equals(m_trav_raw[1].value(), [10, 20, 30, 40]);
  }
  maybe_calls = 0;
  const m_trav_none = Traversable.traverse(
    ArrayT([1, 2, 3, 4]),
    Maybe,
    (n) => {
      maybe_calls += 1;
      return n === 2 ? Nothing<number>() : Just(n);
    },
  );
  assert_equals(maybe_calls, 4);
  assert_equals(m_trav_none.value(), ["Nothing"]);

  let either_calls = 0;
  const e_trav_err = Traversable.traverse(
    ArrayT([1, 2, 3, 4]),
    Either.with_left<string>(),
    (n) => {
      either_calls += 1;
      return n >= 2
        ? Left<string, number>(`err:${n}`)
        : Right<string, number>(n);
    },
  );
  assert_equals(either_calls, 4);
  assert_equals(e_trav_err.value(), ["Left", "err:2"]);

  const id_trav = Traversable.traverse(
    ArrayT([2, 4, 6]),
    Identity,
    (n) => identity(n + 1),
  );
  assert_equals(id_trav.value().value(), [3, 5, 7]);

  // R1a: traverse_sequential short-circuits immediately on first failure
  let seq_calls = 0;
  const seq_m = traverse_sequential([1, 2, 3, 4], Maybe, (n) => {
    seq_calls += 1;
    return n === 2 ? Nothing<number>() : Just(n * 2);
  });
  assert_equals(seq_calls, 2);
  assert_equals(seq_m.value(), ["Nothing"]);

  seq_calls = 0;
  const seq_e = traverse_sequential(
    [1, 2, 3, 4],
    Either.with_left<string>(),
    (n) => {
      seq_calls += 1;
      return n === 3
        ? Left<string, number>("stop")
        : Right<string, number>(n * 3);
    },
  );
  assert_equals(seq_calls, 3);
  assert_equals(seq_e.value(), ["Left", "stop"]);

  const seq_id = traverse_sequential([1, 2, 3], Identity, (n) => identity(n));
  assert_equals(seq_id.value(), [1, 2, 3]);

  // R1b: Dense array & record collect preserve exact values, __proto__, symbols, and mixed-dict errors
  const tup = collect([Just(1), Just("a"), Just(true)]);
  assert_equals(tup.value(), ["Just", [1, "a", true]]);
  assert_equals(collect(Maybe, []).value(), ["Just", []]);
  const rec = collect(Either.with_left<string>(), {
    a: Right<string, number>(1),
    b: Right<string, string>("ok"),
  });
  assert_equals(rec.value(), ["Right", { a: 1, b: "ok" }]);
  let mixed_err = false;
  try {
    collect(Maybe, [
      Just(1),
      Right(2) as unknown as ReturnType<typeof Just<number>>,
    ]);
  } catch (e) {
    mixed_err = e instanceof TypeError;
  }
  assert_true(mixed_err, "collect must reject mixed dictionaries");

  // R1c: Specialized Validation traversal & configured semigroup
  const Errors = Validation.with_semigroup<readonly string[]>({
    concat: (a, b) => [...a, ...b],
  });
  const v_ok = Traversable.traverse(
    ArrayT([1, 2, 3]),
    Errors,
    (n) => Errors.Valid(n * 2),
  );
  const v_ok_raw = v_ok.value();
  assert_equals(v_ok_raw[0], "valid");
  if (v_ok_raw[0] === "valid") {
    assert_equals(v_ok_raw[1].value(), [2, 4, 6]);
  }
  const v_err = Traversable.traverse(
    ArrayT([1, 2, 3, 4]),
    Errors,
    (n) => n % 2 === 0 ? Errors.Invalid([`even:${n}`]) : Errors.Valid(n),
  );
  assert_equals(validation_to_either(v_err).value(), [
    "Left",
    ["even:2", "even:4"],
  ]);
  const v_lift_4 = Applicative.lift(
    (a, b, c, d) => a + b + c + d,
    Errors.Valid(1),
    Errors.Invalid<number>(["e1"]),
    Errors.Valid(3),
    Errors.Invalid<number>(["e2"]),
  );
  assert_equals(validation_to_either(v_lift_4).value(), [
    "Left",
    ["e1", "e2"],
  ]);

  // R1e: Specialized Reader & State traversals (unkeyed and keyed cells)
  const r_cell = reader<number>()("r4_reader");
  const r_trav = Traversable.traverse(
    ArrayT([1, 2, 3]),
    Reader.with_environment<number>(),
    (n) => ask<number>().map((env) => env + n),
  );
  assert_equals(r_trav.run(10).value(), [11, 12, 13]);
  const rc_trav = Traversable.traverse(
    ArrayT([1, 2, 3]),
    r_cell,
    (n) => r_cell.asks((env) => env * n),
  );
  assert_equals(rc_trav.run(5).value(), [5, 10, 15]);

  const s_cell = state<number>()("r4_state");
  const s_trav = Traversable.traverse(
    ArrayT([1, 2, 3]),
    State.with_state<number>(),
    (n) => modify((s: number) => s + n).bind(() => get<number>()),
  );
  const [s_res, s_final] = s_trav.run(0);
  assert_equals([s_res.value(), s_final], [[1, 3, 6], 6]);
  const sc_trav = Traversable.traverse(
    ArrayT([10, 20]),
    s_cell,
    (n) => s_cell.modify((s) => s + n).bind(() => s_cell.get()),
  );
  const [sc_res, sc_final] = sc_trav.run(1);
  assert_equals([sc_res.value(), sc_final], [[11, 31], 31]);

  // R2: Task single-frame fast loop, deep stack-safe chain, and Task/ParallelTask traversals
  const short_task = Task.pure(5).map((n) => n * 2).bind((n) =>
    Task.pure(n + 3)
  );
  assert_equals(await run_task(short_task), 13);
  assert_equals(await run_task(short_task), 13);

  let deep_task = Task.pure(0);
  for (let i = 0; i < 2000; i += 1) {
    deep_task = deep_task.map((n) => n + 1);
  }
  assert_equals(await run_task(deep_task), 2000);
  assert_equals(await run_task(deep_task), 2000);

  const t_trav = Traversable.traverse(
    ArrayT([1, 2, 3]),
    Task,
    (n) => from_fn(() => n * 4),
  );
  assert_equals((await run_task(t_trav)).value(), [4, 8, 12]);
  const pt_trav = Traversable.traverse(
    ArrayT([1, 2, 3]),
    ParallelTask,
    (n) => ParallelTask.pure(n * 5),
  );
  assert_equals((await run_task(sequential(pt_trav))).value(), [5, 10, 15]);
  assert_equals(
    await run_task(traverse_task([2, 4, 6], 2, (n) => from_fn(() => n + 1))),
    [3, 5, 7],
  );

  // R3: Merged Computation plans (single-step + deep reuse for State & Reader)
  let deep_state = get<number>();
  for (let i = 0; i < 2000; i += 1) {
    deep_state = deep_state.bind((n) =>
      State((_s: number) => [n + 1, n + 1] as const)
    );
  }
  assert_equals(deep_state.run(0), [2000, 2000]);
  assert_equals(deep_state.run(5), [2005, 2005]);

  let deep_reader = ask<number>();
  for (let i = 0; i < 2000; i += 1) {
    deep_reader = deep_reader.map((n) => n + 1);
  }
  assert_equals(deep_reader.run(10), 2010);
  assert_equals(deep_reader.run(20), 2020);

  // R4: Writer single-element and multi-element ArrayT tell
  const [w_res, w_log] = run_writer_terminal(
    Program(function* () {
      yield* tell(ArrayT([1]));
      yield* tell(ArrayT([2, 3]));
      yield* tell(ArrayT([4]));
      return "done";
    }),
    ArrayT<number>([]),
  );
  assert_equals([w_res, w_log.value()], ["done", [1, 2, 3, 4]]);
});

Deno.test("round-5 runtime hills cover AsyncIterableT push pipelines, Stm primitive/journal fast paths, Task sync from_fn, and Except dispatch", async () => {
  const {
    filter_map: async_filter_map,
    find: async_find,
    fold_while: async_fold_while,
    from_async_iterable,
    from_chunks,
    from_sync_factory,
    preview: async_preview,
    some: async_some,
    to_array: async_to_array,
  } = await import("./async_iterable.ts");
  const { Do } = await import("./typeclasses.ts");
  const {
    atomically,
    new_tvar,
    read_tvar,
    Stm,
    write_tvar,
  } = await import("./stm.ts");
  const { Task, traverse_task } = await import("./task.ts");
  const { done, rec } = await import("./loop.ts");
  const { fail, recover, run_except } = await import("./except.ts");
  const { run } = await import("./effects.ts");

  // AsyncIterableT: sync factory, chunks, and snapshot push pipelines (sync + async stages)
  const sync_src = from_sync_factory(() => [1, 2, 3, 4, 5, 6, 7, 8]);
  assert_equals(
    await async_to_array(
      sync_src.filter((n) => n % 2 === 0).map((n) => n * 10).take(3),
    ),
    [20, 40, 60],
  );
  assert_equals(
    await async_to_array(
      sync_src
        .filter((n) => n % 2 === 1)
        .map((n) => n === 5 ? Promise.resolve(n * 100) : n * 10),
    ),
    [10, 30, 500, 70],
  );
  assert_equals(
    await async_preview(
      async_filter_map(sync_src, (n) => n % 2 === 0 ? Just(n + 1) : Nothing()),
      2,
    ),
    [3, 5],
  );
  assert_equals(
    (await async_find(
      sync_src.map((n) => n * 3).filter((n) => n > 10),
      (n) => n % 2 === 0,
    )).value(),
    ["Just", 12],
  );
  assert_equals(
    await async_some(
      sync_src.map((n) => n * 2),
      async (n) => await Promise.resolve(n === 14),
    ),
    true,
  );
  assert_equals(
    await async_fold_while(
      sync_src.map((n) => n * 2),
      0,
      (acc, n) => acc + n >= 12 ? ["Done", acc + n] : ["Continue", acc + n],
    ),
    12,
  );

  // from_chunks fast path + early-exit generator cleanup
  let chunks_closed = false;
  const chunk_src = from_chunks(async function* () {
    try {
      yield [1, 2, 3];
      yield [4, 5, 6];
      yield [7, 8, 9];
    } finally {
      chunks_closed = true;
    }
  });
  assert_equals(
    await async_to_array(
      chunk_src.filter((n) => n % 2 === 0).map((n) => n * 10),
    ),
    [20, 40, 60, 80],
  );
  chunks_closed = false;
  assert_equals(
    (await async_find(
      chunk_src.map((n) => n * 2),
      (n) => n === 6,
    )).value(),
    ["Just", 6],
  );
  assert_true(chunks_closed, "from_chunks early exit must close generator");

  // from_async_iterable snapshot registered for fast array push pipeline
  async function* gen_vals() {
    yield 10;
    yield 20;
    yield 30;
  }
  const snap = await from_async_iterable(gen_vals());
  assert_equals(
    await async_to_array(snap.map((n) => n + 1).filter((n) => n > 15)),
    [21, 31],
  );

  // Stm: primitive fast-path, cached read_tvar, Journal pooling, object isolation, lift 0/1/2/3
  const counter = new_tvar(0);
  const obj_var = new_tvar({ count: 1 });
  assert_true(
    read_tvar(counter) === read_tvar(counter),
    "read_tvar should cache reader action per TVar",
  );
  for (let i = 0; i < 10; i += 1) {
    const next = await atomically(
      read_tvar(counter).bind((v) =>
        write_tvar(counter, v + 1).map(() => v + 1)
      ),
    );
    assert_equals(next, i + 1);
  }
  const read_obj = await atomically(read_tvar(obj_var));
  read_obj.count = 999;
  assert_equals((await atomically(read_tvar(obj_var))).count, 1);

  const lifted_1 = await atomically(
    Applicative.lift((a) => a * 2, read_tvar(counter)),
  );
  const lifted_2 = await atomically(
    Applicative.lift((a, b) => a + b, read_tvar(counter), Stm.pure(5)),
  );
  const lifted_3 = await atomically(
    Applicative.lift(
      (a, b, c) => a + b + c,
      read_tvar(counter),
      Stm.pure(5),
      Stm.pure(2),
    ),
  );
  assert_equals([lifted_1, lifted_2, lifted_3], [20, 15, 17]);

  const stm_do = await atomically(
    Do(Stm, function* () {
      const cur = yield* read_tvar(counter);
      yield* write_tvar(counter, cur + 3);
      return yield* read_tvar(counter);
    }),
  );
  assert_equals(stm_do, 13);

  // Task: sync from_fn fast-path across bind chains, tail_rec_m, traverse_task, throws & abort
  let chain = from_fn(() => 0);
  for (let i = 0; i < 100; i += 1) {
    chain = chain.bind((n) => from_fn(() => n + 1));
  }
  assert_equals(await run_task(chain), 100);
  assert_equals(
    await run_task(
      Task.tail_rec_m(
        0,
        (n) => from_fn(() => n >= 50 ? done(n) : rec(n + 1)),
      ),
    ),
    50,
  );
  assert_equals(
    await run_task(traverse_task([1, 2, 3, 4], 2, (n) => from_fn(() => n * 3))),
    [3, 6, 9, 12],
  );
  assert_equals(
    await run_task(
      from_fn(() => 2).bind((n) => from_fn(() => Promise.resolve(n * 21))),
    ),
    42,
  );
  let sync_threw = false;
  try {
    await run_task(
      from_fn((): number => {
        throw new Error("sync-boom");
      }),
    );
  } catch (e) {
    sync_threw = e instanceof Error && e.message === "sync-boom";
  }
  assert_true(sync_threw, "sync throw in from_fn must reject run_task");

  const controller = new AbortController();
  controller.abort("cancelled-now");
  let aborted_err = false;
  try {
    await run_task(from_fn(() => 123), { signal: controller.signal });
  } catch {
    aborted_err = true;
  }
  assert_true(aborted_err, "aborted signal must reject sync from_fn");

  // Except: single-tag check in run_except & recover
  const recovered = run(
    run_except(
      recover(
        Program(function* () {
          return yield* fail("bad-input" as const);
        }),
        (err) => Effect.pure(`fixed:${err}`),
      ),
    ),
  );
  assert_equals(recovered.value(), ["Right", "fixed:bad-input"]);
  const handled_fail = run(
    run_except(
      Program(function* () {
        return yield* fail("bad-tag" as const);
      }),
    ),
  );
  assert_equals(handled_fail.value(), ["Left", "bad-tag"]);
});
