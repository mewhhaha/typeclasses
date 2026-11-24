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
