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
  type As,
  type DataOf,
  define_data,
  define_union,
  field,
  kind,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { Applicative, type Monoid } from "./typeclasses.ts";
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

  // Round 5b: Task/ParallelTask sync lift/ap/run_concurrently & RecordT allocation-free loops
  const { parallel, sequential } = await import("./task.ts");
  const { fold_with_key, RecordT } = await import("./record.ts");
  const { Foldable } = await import("./typeclasses/foldable.ts");

  assert_equals(
    await run_task(
      Applicative.lift((a, b) => a + b, from_fn(() => 10), from_fn(() => 32)),
    ),
    42,
  );
  assert_equals(
    await run_task(
      Applicative.lift(
        (a, b, c) => a + b + c,
        from_fn(() => 1),
        from_fn(() => Promise.resolve(2)),
        Task.pure(3),
      ),
    ),
    6,
  );
  assert_equals(
    await run_task(
      Task.pure((n: number) => n * 3).ap(from_fn(() => 14)),
    ),
    42,
  );
  assert_equals(
    await run_task(
      sequential(
        Applicative.lift(
          (a, b) => a * b,
          parallel(from_fn(() => 6)),
          parallel(from_fn(() => 7)),
        ),
      ),
    ),
    42,
  );
  assert_equals(
    await run_task(
      sequential(
        Applicative.lift(
          (a, b, c) => a + b + c,
          parallel(from_fn(() => 10)),
          parallel(from_fn(() => Promise.resolve(20))),
          parallel(from_fn(() => 30)),
        ),
      ),
    ),
    60,
  );

  const record_val = RecordT({ a: 1, b: 2, c: 3 });
  assert_equals(record_val.map((n) => n * 10).value(), { a: 10, b: 20, c: 30 });
  assert_equals(Foldable.fold(record_val, 0, (acc, n) => acc + n), 6);
  assert_equals(Foldable.some(record_val, (n) => n === 2), true);
  assert_equals(Foldable.find(record_val, (n) => n > 1), 2);
  assert_equals(
    fold_with_key(record_val, "", (acc, n, k) => `${acc}${k}:${n},`),
    "a:1,b:2,c:3,",
  );
});

Deno.test("round-6 runtime speedups preserve Validation O(N) accumulation, List traverse, SetT/TypedArrayT folds, and 1-shot run_cells", async () => {
  const { Traversable } = await import("./typeclasses/traversable.ts");
  const { Foldable } = await import("./typeclasses/foldable.ts");
  const { Invalid } = await import("./validation.ts");
  const { from_array: list_from_array, to_array: list_to_array } = await import(
    "./list.ts"
  );
  const { SetT } = await import("./set.ts");
  const { TypedArrayT } = await import("./typed_array.ts");

  // 1. Validation traverse O(N) array error accumulation + valid + semigroup mismatch
  const inputs = Array.from({ length: 250 }, (_, i) => i);
  const all_bad = Traversable.traverse(
    ArrayT(inputs),
    Validation.with_error<readonly string[]>(),
    (n) => InvalidMessages<number>(`e${n}`),
  );
  const bad_raw = all_bad.value();
  assert_equals(bad_raw[0], "invalid");
  if (bad_raw[0] === "invalid") {
    assert_equals(bad_raw[1].length, 250);
    assert_equals(bad_raw[1][0], "e0");
    assert_equals(bad_raw[1][249], "e249");
  }
  const all_ok = Traversable.traverse(
    ArrayT([1, 2, 3]),
    Validation.with_error<readonly string[]>(),
    (n) => Valid(n * 2),
  );
  const ok_raw = all_ok.value();
  assert_equals(ok_raw[0], "valid");
  if (ok_raw[0] === "valid") assert_equals(ok_raw[1].value(), [2, 4, 6]);
  let sg_threw = false;
  try {
    Traversable.traverse(
      ArrayT([1, 2]),
      Validation.with_error<readonly string[]>(),
      (n) =>
        n === 1
          ? InvalidMessages<number>("a")
          : Invalid<readonly string[], number>(["b"], {
            concat: (l: readonly string[], r: readonly string[]) => [
              ...l,
              ...r,
            ],
          }),
    );
  } catch (err) {
    sg_threw = err instanceof TypeError;
  }
  assert_true(sg_threw, "mismatched semigroups must throw TypeError");

  // 2. List Traversable without generator boxing
  const list_ok = Traversable.traverse(
    list_from_array([1, 2, 3, 4]),
    Maybe,
    (n) => Just(n + 10),
  ).value();
  assert_equals(list_ok[0], "Just");
  if (list_ok[0] === "Just") {
    assert_equals(list_to_array(list_ok[1]), [11, 12, 13, 14]);
  }
  const list_none = Traversable.traverse(
    list_from_array([1, 2, 3, 4]),
    Maybe,
    (n) => (n === 2 ? Nothing<number>() : Just(n)),
  ).value();
  assert_equals(list_none, ["Nothing"]);

  // 3. SetT short-circuiting some & find
  const big_set = SetT(new Set(Array.from({ length: 500 }, (_, i) => i)));
  let set_checks = 0;
  assert_equals(
    Foldable.some(big_set, (n) => {
      set_checks += 1;
      return n === 3;
    }),
    true,
  );
  assert_equals(set_checks, 4);
  set_checks = 0;
  assert_equals(
    Foldable.find(big_set, (n) => {
      set_checks += 1;
      return n === 5;
    }),
    5,
  );
  assert_equals(set_checks, 6);
  assert_equals(Foldable.find(big_set, (n) => n === 9999), undefined);

  // 4. TypedArrayT indexed fold, some, find
  const ta = TypedArrayT(
    new Int32Array(Array.from({ length: 200 }, (_, i) => i + 1)),
  );
  assert_equals(Foldable.fold(ta, 0, (acc, n) => acc + n), 20100);
  let ta_checks = 0;
  assert_equals(
    Foldable.some(ta, (n) => {
      ta_checks += 1;
      return n === 4;
    }),
    true,
  );
  assert_equals(ta_checks, 4);
  ta_checks = 0;
  assert_equals(
    Foldable.find(ta, (n) => {
      ta_checks += 1;
      return n === 7;
    }),
    7,
  );
  assert_equals(ta_checks, 7);
  assert_equals(Foldable.find(ta, (n) => n === 9999), undefined);

  // 5. 1-shot run_cells & handle_cells (<= 3 cells fast path + 4 cells Map path)
  const r1 = reader<number>()("r1");
  const s1 = state<number>()("s1");
  const w1 = writer_cell("w1", ArrayT<number>([]));
  const s2 = state<number>()("s2");
  const p3 = Program(function* () {
    const base = yield* r1.ask();
    yield* s1.modify((n) => n + base);
    yield* w1.tell(ArrayT([base]));
    return yield* s1.get();
  });
  const res3 = run_cells(p3, {
    r: provide_reader(r1, 5),
    s: provide_state(s1, 10),
    w: provide_writer(w1),
  });
  assert_equals(res3.result, 15);
  assert_equals(res3.states, { s: 15 });
  assert_equals(res3.logs.w.value(), [5]);

  const p4 = Program(function* () {
    const base = yield* r1.ask();
    yield* s1.modify((n) => n + base);
    yield* s2.modify((n) => n + base * 2);
    yield* w1.tell(ArrayT([base]));
    return (yield* s1.get()) + (yield* s2.get());
  });
  const res4 = run_cells(p4, {
    r: provide_reader(r1, 3),
    s1: provide_state(s1, 1),
    s2: provide_state(s2, 2),
    w: provide_writer(w1),
  });
  assert_equals(res4.result, 12);
  assert_equals(res4.states, { s1: 4, s2: 8 });
  assert_equals(res4.logs.w.value(), [3]);

  const handled_p3 = handle_cells(p3, {
    r: provide_reader(r1, 7),
    s: provide_state(s1, 1),
    w: provide_writer(w1),
  });
  assert_equals(run(handled_p3).result, 8);
  assert_equals(run(handled_p3).result, 8);
});

Deno.test("round-7 core runtime optimizations preserve Do runners, sequential traversals, prelude folds, collection short-circuits, and sync async-iterable concurrency", async () => {
  const { Do, Foldable, MonadError, Traversable, Eq } = await import(
    "./typeclasses.ts"
  );
  const {
    Task,
    ParallelTask,
    parallel,
    sequential,
    succeed,
    from_fn,
    run_task,
    run_task_exit,
    traverse_task,
    is_task_cancellation,
  } = await import("./task.ts");
  const { Writer, tell } = await import("./writer.ts");
  const { State, get, put, modify } = await import("./state.ts");
  const { Reader, ask, asks } = await import("./reader.ts");
  const {
    Stm,
    new_tvar,
    read_tvar,
    write_tvar,
    modify_tvar,
    retry,
    or_else,
    atomically,
    stm_trusted,
    stm_read_journal,
    stm_write_journal,
    stm_modify_journal,
    stm_atomically_direct,
  } = await import("./stm.ts");
  const { traverse_sequential } = await import("./traversal.ts");
  const { fold_map, mconcat, length, to_array } = await import("./prelude.ts");
  const { from_array: list_from_array, to_array: list_to_array } = await import(
    "./list.ts"
  );
  const { SetT } = await import("./set.ts");
  const { MapT } = await import("./map.ts");
  const { RecordT } = await import("./record.ts");
  const { TypedArrayT } = await import("./typed_array.ts");
  const { from_bytes: ab_from_bytes } = await import(
    "./array_buffer.ts"
  );
  const { from_bytes: dv_from_bytes } = await import(
    "./data_view.ts"
  );
  const { URLSearchParamsT } = await import("./url_search_params.ts");
  const { FormDataT } = await import("./form_data.ts");
  const {
    from_sync_factory,
    map_concurrent,
    map_concurrent_unordered,
    to_array: ai_to_array,
  } = await import("./async_iterable.ts");

  // 1. Direct iterative Do(Task) runner: sync + async + replay + catch_error + cancellation
  const task_prog = Do(Task, function* () {
    let sum = 0;
    for (let i = 1; i <= 40; i += 1) {
      const v = yield* from_fn(() => (i % 10 === 0 ? Promise.resolve(i) : i));
      sum += v;
    }
    return sum;
  });
  assert_equals(await run_task(task_prog), 820);
  assert_equals(await run_task(task_prog), 820);

  const recovered = MonadError.catch_error(
    from_fn((): number => {
      throw new Error("sync-boom");
    }),
    (err) => succeed((err as Error).message.length),
  );
  assert_equals(await run_task(recovered), 9);

  const ac = new AbortController();
  ac.abort(new Error("stop-now"));
  const cancelled = await run_task_exit(task_prog, { signal: ac.signal });
  assert_equals(cancelled.status, "cancelled");
  if (cancelled.status === "cancelled") {
    assert_true(
      is_task_cancellation(cancelled.error),
      "expected cancellation",
    );
    assert_equals((cancelled.reason as Error).message, "stop-now");
  }

  // ParallelTask lift & traverse_task with sync and async items
  const par_lifted = sequential(
    Applicative.lift(
      (a: number, b: number, c: number) => a + b + c,
      parallel(from_fn(() => 10)),
      parallel(from_fn(() => Promise.resolve(20))),
      parallel(succeed(12)),
    ),
  );
  assert_equals(await run_task(par_lifted), 42);
  assert_equals(
    await run_task(
      traverse_task(
        [1, 2, 3, 4],
        2,
        (n) => from_fn(() => (n % 2 === 0 ? Promise.resolve(n * 2) : n * 2)),
      ),
    ),
    [2, 4, 6, 8],
  );
  assert_equals(
    (await run_task(
      sequential(
        Traversable.traverse(
          ArrayT([2, 3, 4]),
          ParallelTask,
          (n) => parallel(from_fn(() => n * 3)),
        ),
      ),
    )).value(),
    [6, 9, 12],
  );

  // 2. Direct Do(Writer) / Writer.with / writer_cell O(N) ArrayT buffering + sequential traversal
  const w_dict = Writer.with(ArrayT<number>([]));
  const w_prog = Do(w_dict, function* () {
    let total = 0;
    for (let i = 1; i <= 50; i += 1) {
      yield* tell(ArrayT([i]));
      total += i;
    }
    return total;
  });
  const [w_res, w_log] = w_prog.value();
  assert_equals(w_res, 1275);
  assert_equals(w_log.value().length, 50);
  assert_equals(w_log.value()[49], 50);

  const w_trav = Traversable.traverse(
    ArrayT([1, 2, 3]),
    w_dict,
    (n) => w_dict([n * 10, ArrayT([n])]),
  );
  const [wt_arr, wt_log] = w_trav.value();
  assert_equals(wt_arr.value(), [10, 20, 30]);
  assert_equals(wt_log.value(), [1, 2, 3]);

  // 3. Do(State), Do(Reader), and sequential traversals (preserving fresh ask()/get() wrappers)
  const st_prog = Do(State.with_state<number>(), function* () {
    let sum = 0;
    for (let i = 0; i < 30; i += 1) {
      const cur = yield* get<number>();
      yield* put<number>(cur + 1);
      yield* modify<number>((n) => n + 1);
      sum += cur;
    }
    return sum;
  });
  assert_equals(st_prog.run(0), [870, 60]);
  assert_equals(
    traverse_sequential(
      [1, 2, 3],
      State.with_state<number>(),
      (n) => State((s: number) => [s + n, s + 1]),
    ).run(10),
    [[11, 13, 15], 13],
  );

  const rd_prog = Do(
    Reader.with_environment<{ readonly n: number }>(),
    function* () {
      const base = yield* ask<{ readonly n: number }>();
      const twice = yield* asks((e: { readonly n: number }) => e.n * 2);
      return base.n + twice;
    },
  );
  assert_equals(rd_prog.run({ n: 7 }), 21);
  assert_equals(
    traverse_sequential(
      [1, 2, 3],
      Reader.with_environment<number>(),
      (n) => Reader((e: number) => e + n),
    ).run(10),
    [11, 12, 13],
  );

  // 4. Direct Do(Stm), pooled or_else rollback, record shapes, and trusted STM helpers
  const tv_num = new_tvar(10);
  const tv_rec = new_tvar({ count: 1, label: "a" });
  const stm_prog = Do(Stm, function* () {
    const cur = yield* read_tvar(tv_num);
    yield* modify_tvar(tv_num, (n) => n + 5);
    const rec = yield* read_tvar(tv_rec);
    yield* write_tvar(tv_rec, { count: rec.count + 1, label: "b" });
    return cur + rec.count;
  });
  assert_equals(atomically(stm_prog), 11);
  assert_equals(atomically(read_tvar(tv_num)), 15);
  assert_equals(atomically(read_tvar(tv_rec)), { count: 2, label: "b" });

  // or_else must roll back mutations from the retried left branch
  const rollback_res = atomically(
    or_else(
      Do(Stm, function* () {
        yield* write_tvar(tv_num, 999);
        return yield* retry<number>();
      }),
      read_tvar(tv_num),
    ),
  );
  assert_equals(rollback_res, 15);

  // Trusted STM helpers
  const direct_stm = stm_trusted((journal) => {
    const prev = stm_read_journal(journal, tv_num);
    stm_modify_journal(journal, tv_num, (n) => n + 2);
    stm_write_journal(journal, tv_num, prev + 3);
    return stm_read_journal(journal, tv_num);
  });
  assert_equals(atomically(direct_stm), 18);
  assert_equals(
    stm_atomically_direct((journal) => stm_read_journal(journal, tv_num)),
    18,
  );
  assert_equals(
    atomically(
      traverse_sequential([1, 2, 3], Stm, (n) =>
        Do(Stm, function* () {
          yield* modify_tvar(tv_num, (x) => x + n);
          return yield* read_tvar(tv_num);
        })),
    ),
    [19, 21, 24],
  );

  // 5. Prelude O(N) fold_map / mconcat / length / to_array
  assert_equals(
    fold_map(ArrayT, (n: number) => ArrayT([n, n * 10]), ArrayT([1, 2, 3]))
      .value(),
    [1, 10, 2, 20, 3, 30],
  );
  assert_equals(
    mconcat(
      ArrayT,
      ArrayT([ArrayT([1, 2]), ArrayT([3]), ArrayT([4, 5])]),
    ).value(),
    [1, 2, 3, 4, 5],
  );
  const lst = list_from_array([1, 2, 3, 4]);
  assert_equals(length(ArrayT([1, 2, 3])), 3);
  assert_equals(length(lst), 4);
  assert_equals(length(SetT(new Set([1, 2]))), 2);
  assert_equals(length(MapT(new Map([["a", 1], ["b", 2]]))), 2);
  assert_equals(to_array(lst), [1, 2, 3, 4]);
  assert_equals(list_to_array(lst), [1, 2, 3, 4]);

  // 6. Collection fold_while / some / find short-circuiting and Eq without exception throws
  const ta = TypedArrayT(new Uint16Array([10, 20, 30, 40]));
  let ta_steps = 0;
  assert_equals(
    Foldable.fold_while(ta, 0, (acc, n) => {
      ta_steps += 1;
      return acc + n >= 30 ? ["Done", acc + n] : ["Continue", acc + n];
    }),
    30,
  );
  assert_equals(ta_steps, 2);

  const ab = ab_from_bytes([1, 2, 3, 4, 5]);
  let ab_steps = 0;
  assert_equals(
    Foldable.find(ab, (b) => {
      ab_steps += 1;
      return b === 3;
    }),
    3,
  );
  assert_equals(ab_steps, 3);
  assert_equals(Foldable.some(ab, (b) => b === 99), false);

  const dv = dv_from_bytes([5, 6, 7, 8]);
  let dv_steps = 0;
  assert_equals(
    Foldable.some(dv, (b) => {
      dv_steps += 1;
      return b === 6;
    }),
    true,
  );
  assert_equals(dv_steps, 2);

  const rec = RecordT({ a: 1, b: 2, c: 3, d: 4 });
  let rec_steps = 0;
  assert_equals(
    Foldable.find(rec, (v) => {
      rec_steps += 1;
      return v === 2;
    }),
    2,
  );
  assert_equals(rec_steps, 2);

  const usp1 = URLSearchParamsT(new URLSearchParams([["a", "1"], ["b", "2"]]));
  const usp2 = URLSearchParamsT(new URLSearchParams([["a", "1"], ["b", "2"]]));
  const usp3 = URLSearchParamsT(new URLSearchParams([["a", "1"], ["b", "3"]]));
  assert_equals(Eq.eq(usp1, usp2), true);
  assert_equals(Eq.eq(usp1, usp3), false);
  let usp_steps = 0;
  assert_equals(
    Foldable.some(usp1, ([k]) => {
      usp_steps += 1;
      return k === "a";
    }),
    true,
  );
  assert_equals(usp_steps, 1);

  const fd_a = new FormData();
  fd_a.append("k1", "v1");
  fd_a.append("k2", "v2");
  const fd_b = new FormData();
  fd_b.append("k1", "v1");
  fd_b.append("k2", "v2");
  const fd_c = new FormData();
  fd_c.append("k1", "v1");
  assert_equals(Eq.eq(FormDataT(fd_a), FormDataT(fd_b)), true);
  assert_equals(Eq.eq(FormDataT(fd_a), FormDataT(fd_c)), false);
  let fd_steps = 0;
  assert_equals(
    Foldable.find(FormDataT(fd_a), ([k]) => {
      fd_steps += 1;
      return k === "k1";
    }),
    ["k1", "v1"],
  );
  assert_equals(fd_steps, 1);

  // 7. AsyncIterableT map_concurrent & map_concurrent_unordered sync + async callbacks
  const src_stream = from_sync_factory(() => [1, 2, 3, 4, 5]);
  const ordered = await ai_to_array(
    map_concurrent(
      src_stream,
      2,
      (n) => n % 2 === 0 ? Promise.resolve(n * 10) : n * 10,
    ),
  );
  assert_equals(ordered, [10, 20, 30, 40, 50]);

  const unordered = await ai_to_array(
    map_concurrent_unordered(src_stream, 3, (n) => n + 1),
  );
  assert_equals(unordered.sort((a, b) => a - b), [2, 3, 4, 5, 6]);
});

Deno.test("round-7 codex differential parity: Do replay, sequential snapshot, traverse_task AggregateError/signal/live-array, sparse to_array, RecordT deleted keys, ArrayBufferT detach, custom fold_map order", async () => {
  const { Do, Foldable, Monoid, Semigroup } = await import("./typeclasses.ts");
  const { Task, from_fn, run_task, traverse_task } = await import("./task.ts");
  const { Reader } = await import("./reader.ts");
  const { State } = await import("./state.ts");
  const { Stm, atomically } = await import("./stm.ts");
  const { traverse_sequential } = await import("./traversal.ts");
  const { fold_map, to_array } = await import("./prelude.ts");
  const { from_record_view } = await import("./record.ts");
  const { ArrayBufferT } = await import("./array_buffer.ts");
  const { data } = await import("./typeclass.ts");

  // 1. Do(Reader/State/Stm) replay parity: first yielded action captured at construction time
  let rd_counter = 0;
  const rd_replay = Do(Reader.with_environment<number>(), function* () {
    const snap = ++rd_counter;
    const a = yield* Reader((e: number) => snap + e);
    return a;
  });
  assert_equals(rd_replay.run(10), 11);
  assert_equals(rd_replay.run(10), 11);

  let st_counter = 0;
  const st_replay = Do(State.with_state<number>(), function* () {
    const snap = ++st_counter;
    const a = yield* State((s: number) => [snap + s, s + 1] as const);
    return a;
  });
  assert_equals(st_replay.run(10), [11, 11]);
  assert_equals(st_replay.run(10), [11, 11]);

  let stm_counter = 0;
  const stm_replay = Do(Stm, function* () {
    const snap = ++stm_counter;
    const a = yield* Stm(() => snap);
    return a;
  });
  assert_equals(atomically(stm_replay), 1);
  assert_equals(atomically(stm_replay), 1);

  // 2. traverse_sequential snapshots input array at construction time
  const seq_arr = [1, 2];
  const seq_rd = traverse_sequential(
    seq_arr,
    Reader.with_environment<number>(),
    (x) => Reader((e: number) => e + x),
  );
  seq_arr[1] = 99;
  assert_equals(seq_rd.run(10), [11, 12]);

  // 3. traverse_task: nested abort with throwing iterator cleanup yields AggregateError
  const ac = new AbortController();
  const throwing_iter: Iterable<number> = {
    [Symbol.iterator]() {
      let i = 0;
      return {
        next() {
          i += 1;
          return { done: false, value: i };
        },
        return() {
          throw new Error("cleanup-boom");
        },
      };
    },
  };
  const nested_trav = traverse_task(
    [1],
    1,
    () =>
      traverse_task(
        throwing_iter,
        1,
        () =>
          Task((sig) =>
            new Promise<number>((_res, rej) => {
              sig?.addEventListener(
                "abort",
                () => rej(new Error("inner-abort")),
                {
                  once: true,
                },
              );
              setTimeout(() => ac.abort(new Error("outer-abort")), 5);
            })
          ),
      ),
  );
  let got_agg = false;
  try {
    await run_task(nested_trav, { signal: ac.signal });
  } catch (err) {
    got_agg = err instanceof AggregateError && err.errors.length === 2;
  }
  assert_true(
    got_agg,
    "nested traverse_task abort + throwing cleanup must surface AggregateError",
  );

  // 4. traverse_task no-signal array path: passes AbortSignal to raw Task & visits live push
  const live_items = [1, 2];
  let saw_signal = false;
  const live_out = await run_task(
    traverse_task(live_items, 1, (n) => {
      if (n === 1) live_items.push(3);
      return Task((sig) => {
        if (sig !== undefined) saw_signal = true;
        return Promise.resolve(n * 10);
      });
    }),
  );
  assert_true(saw_signal, "raw Task must receive traversal AbortSignal");
  assert_equals(live_out, [10, 20, 30]);

  const live_sync = [1, 2];
  const live_sync_out = await run_task(
    traverse_task(live_sync, 1, (n) => {
      if (n === 1) live_sync.push(3);
      return from_fn(() => n * 2);
    }),
  );
  assert_equals(live_sync_out, [2, 4, 6]);

  // 5. prelude.to_array fills sparse holes with own undefined entries
  // deno-lint-ignore no-sparse-arrays
  const sparse = [1, , 3] as number[];
  const materialized = to_array(ArrayT(sparse));
  assert_equals(materialized.length, 3);
  assert_true(1 in materialized, "hole must become own undefined property");
  assert_equals(materialized[1], undefined);

  // 6. RecordT fold visits keys snapshotted before callback deletes them
  const mut_rec: Record<string, number> = { a: 1, b: 2 };
  const visited = Foldable.fold(
    from_record_view(mut_rec),
    [] as (number | undefined)[],
    (acc, v) => {
      delete mut_rec.b;
      acc.push(v);
      return acc;
    },
  );
  assert_equals(visited, [1, undefined]);

  // 7. ArrayBufferT fold throws TypeError if buffer is detached mid-fold
  const ab_wrapped = ArrayBufferT(new Uint8Array([1, 2, 3]).buffer);
  const underlying = ab_wrapped.value();
  let detach_threw = false;
  try {
    Foldable.fold(ab_wrapped, 0, (acc, b) => {
      if (acc === 0) structuredClone(underlying, { transfer: [underlying] });
      return acc + b;
    });
  } catch (err) {
    detach_threw = err instanceof TypeError;
  }
  assert_true(
    detach_threw,
    "detaching ArrayBuffer mid-fold must throw TypeError",
  );

  // 8. Custom monoid fold_map preserves observable empty() + left-to-right concat() order
  const trace: string[] = [];
  const log_sym = Symbol("TraceMonoid");
  interface AsTraceLambda {
    readonly [type_item]: unknown;
    readonly [type_data]: string;
  }
  interface AsTrace
    extends As<AsTraceLambda, typeof log_sym>, Monoid<AsTrace> {}
  const TraceM = data<AsTrace>(log_sym);
  Semigroup.instance(TraceM)({
    concat(right) {
      const l = this.value();
      const r = right.value();
      trace.push(`concat(${l},${r})`);
      return TraceM(l + r);
    },
  });
  Monoid.instance(TraceM)({
    empty() {
      trace.push("empty");
      return TraceM("");
    },
  });
  const folded = fold_map(
    TraceM,
    (s: string) => TraceM(s),
    ArrayT(["a", "b", "c"]),
  );
  assert_equals(folded.value(), "abc");
  assert_equals(trace, [
    "empty",
    "concat(,a)",
    "concat(a,b)",
    "concat(ab,c)",
  ]);
});

Deno.test("Wave 2 fast-path parity across core, Writer, Task, STM, AsyncIterableT, prelude, and handlers", async () => {
  const [
    { Do, Foldable, MonadError, MonadRec, Traversable, Eq, Ord, Monoid },
    { List, from_array: list_from_array, to_array: list_to_array },
    { SetT },
    { MapT },
    { RecordT, from_record_view },
    { ChunkLog, chunk_log, flatten_chunk_log },
    { Writer },
    { Fn },
    { Tuple },
    { Identity },
    { from_array: iter_from_array, preview: iter_preview },
    {
      AsyncIterableT,
      filter_map: ai_filter_map,
      find: ai_find,
      fold_while: ai_fold_while,
      from_async_iterable,
      from_chunks,
      from_readable_stream_source,
      from_sync_factory,
      map_concurrent,
      map_concurrent_unordered,
      preview: ai_preview,
      some: ai_some,
      to_array: ai_to_array,
    },
    { from_bytes: ab_from_bytes },
    { DataViewT },
    { from_typed_array },
    { FormDataT },
    {
      ParallelTask,
      Task,
      from_promise,
      parallel,
      sequential,
      succeed,
      traverse_task,
    },
    {
      Stm,
      abort,
      atomically,
      modify_tvar,
      new_immutable_tvar,
      new_tvar,
      or_else,
      read_tvar,
      retry,
      update_immutable_path,
      write_tvar,
    },
    { elem, fold_map, fold_while, traverse_ },
    { Reader, ask },
    { State },
    { either, from_left, from_right, hush, is_left, is_right, recover_or_else },
    { done, rec },
    { map_error: map_validation_error },
  ] = await Promise.all([
    import("./typeclasses.ts"),
    import("./list.ts"),
    import("./set.ts"),
    import("./map.ts"),
    import("./record.ts"),
    import("./chunk_log.ts"),
    import("./writer.ts"),
    import("./fn.ts"),
    import("./tuple.ts"),
    import("./identity.ts"),
    import("./iterable.ts"),
    import("./async_iterable.ts"),
    import("./array_buffer.ts"),
    import("./data_view.ts"),
    import("./typed_array.ts"),
    import("./form_data.ts"),
    import("./task.ts"),
    import("./stm.ts"),
    import("./prelude.ts"),
    import("./reader.ts"),
    import("./state.ts"),
    import("./either.ts"),
    import("./loop.ts"),
    import("./validation.ts"),
  ]);

  // 1. Overridden .value() honored exactly once across Maybe & Either fast paths
  {
    let calls = 0;
    const l = Left<string, number>("orig");
    Object.defineProperty(l, "value", {
      value() {
        calls += 1;
        return ["Left", "override"] as const;
      },
    });
    assert_equals(either((e) => "L:" + e, (v) => "R:" + v, l), "L:override");
    assert_equals(calls, 1);
    assert_equals(from_left("fb", l), "override");
    assert_equals(calls, 2);
    assert_equals(from_right(99, l), 99);
    assert_equals(calls, 3);
    assert_equals(recover_or_else(l, (e) => "rec:" + e), "rec:override");
    assert_equals(calls, 4);
    assert_true(is_left(l), "overridden is_left");
    assert_equals(calls, 5);
    assert_true(!is_right(l), "overridden is_right");
    assert_equals(calls, 6);
    assert_equals(hush(l).value(), ["Nothing"]);
    assert_equals(calls, 7);
    assert_equals(
      l.bimap((e) => e + "!", (x) => x + 1).value(),
      ["Left", "override!"],
    );
    assert_equals(calls, 8);
    assert_equals(
      MonadError.catch_error(l, (e) => Right(e.length)).value(),
      ["Right", 8],
    );
    assert_equals(calls, 9);
    assert_true(l.eq(Left("override")), "overridden eq");
    assert_equals(calls, 10);
    assert_equals(l.compare(Left("override")), "eq");
    assert_equals(calls, 11);
    assert_equals(Object.is(Nothing().value(), Nothing().value()), true);
  }

  // 2. CORE-01/02/06: Effect map/bind chains, Applicative.collect, singleton traversal
  {
    let eff = Effect.pure(1);
    for (let i = 0; i < 64; i += 1) eff = Effect.map(eff, (n) => n + 1);
    eff = Effect.bind(eff, (n) => Effect.pure(n * 2));
    assert_equals(run(eff), 130);
    assert_equals(run(eff), 130);

    const collected = Applicative.collect(Maybe, {
      a: Just(1),
      b: Just(2),
      c: Just(3),
      d: Just(4),
      e: Just(5),
    });
    assert_equals(collected.value(), [
      "Just",
      { a: 1, b: 2, c: 3, d: 4, e: 5 },
    ]);
    assert_equals(
      Applicative.collect(Maybe, { a: Just(1), b: Nothing<number>() }).value(),
      ["Nothing"],
    );

    const single_m = Traversable.traverse(
      ArrayT([10]),
      Maybe,
      (x) => Just(x + 1),
    );
    assert_true(Just.is(single_m), "single maybe");
    if (Just.is(single_m)) assert_equals(single_m.value()[1].value(), [11]);
    assert_equals(
      Traversable.traverse(ArrayT([10]), Maybe, () => Nothing<number>())
        .value(),
      ["Nothing"],
    );
    const single_e = Traversable.traverse(
      ArrayT([10]),
      Either,
      (x) => Right(x + 2),
    );
    assert_true(Right.is(single_e), "single either");
    if (Right.is(single_e)) assert_equals(single_e.value()[1].value(), [12]);
  }

  // 3. SA-01/04/05/07: Writer (ArrayT/List/SetT/MapT/ChunkLog), Validation, Fn, Tuple
  {
    const WArr = Writer.with(ArrayT<string>([]));
    const w0 = WArr.pure(1).bind((n) => WArr([n + 1, ArrayT(["a"])]));
    const w_branch1 = w0.bind((n) => WArr([n * 2, ArrayT(["b1"])]));
    const w_branch2 = w0.bind((n) => WArr([n * 3, ArrayT(["b2"])]));
    assert_equals(w_branch1.value()[0], 4);
    assert_equals(w_branch1.value()[1].value(), ["a", "b1"]);
    assert_equals(w_branch2.value()[0], 6);
    assert_equals(w_branch2.value()[1].value(), ["a", "b2"]);

    const ap_res = Applicative.ap(
      WArr([(x: number) => x + 10, ArrayT(["f"])]),
      WArr([5, ArrayT(["x"])]),
    );
    assert_equals(ap_res.value()[0], 15);
    assert_equals(ap_res.value()[1].value(), ["f", "x"]);

    const lifted2 = Applicative.lift(
      (a: number, b: number) => a + b,
      WArr([1, ArrayT(["l1"])]),
      WArr([2, ArrayT(["l2"])]),
    );
    assert_equals(lifted2.value()[0], 3);
    assert_equals(lifted2.value()[1].value(), ["l1", "l2"]);

    const many_w = Array.from(
      { length: 40 },
      (_, i) => WArr([i, ArrayT([`k${i}`])]),
    );
    const lifted_many = Applicative.lift(
      (...xs: number[]) => xs.reduce((a, b) => a + b, 0),
      many_w[0],
      ...many_w.slice(1),
    );
    assert_equals(lifted_many.value()[0], (39 * 40) / 2);
    assert_equals(lifted_many.value()[1].value().length, 40);

    // List, SetT, MapT, ChunkLog Writer lifts + traversals (array & iterable)
    const WList = Writer.with(list_from_array<string>([]));
    const wl = Applicative.lift(
      (a: number, b: number, c: number) => a + b + c,
      WList([1, list_from_array(["a"])]),
      WList([2, list_from_array(["b"])]),
      WList([3, list_from_array(["c"])]),
    );
    assert_equals(wl.value()[0], 6);
    assert_equals(list_to_array(wl.value()[1]), ["a", "b", "c"]);

    const WSet = Writer.with(SetT(new Set<number>()));
    const ws = Traversable.traverse(
      ArrayT([1, 2, 3]),
      WSet,
      (x) => WSet([x * 2, SetT(new Set([x]))]),
    );
    assert_equals(ws.value()[0].value(), [2, 4, 6]);
    assert_equals([...ws.value()[1].value()], [1, 2, 3]);

    const WMap = Writer.with(MapT(new Map<string, number>()));
    const wm = Traversable.traverse(
      list_from_array([1, 2, 3]),
      WMap,
      (x) => WMap([x, MapT(new Map([[`k${x}`, x]]))]),
    );
    assert_equals(list_to_array(wm.value()[0]), [1, 2, 3]);
    assert_equals([...wm.value()[1].value().entries()], [
      ["k1", 1],
      ["k2", 2],
      ["k3", 3],
    ]);

    const WChunk = Writer.with(chunk_log<string>([]));
    const wc = Applicative.lift(
      (a: number, b: number, c: number) => a + b + c,
      WChunk([1, chunk_log(["x"])]),
      WChunk([2, chunk_log(["y"])]),
      WChunk([3, chunk_log(["z"])]),
    );
    assert_equals(wc.value()[0], 6);
    assert_equals(flatten_chunk_log(wc.value()[1]), ["x", "y", "z"]);

    const w_do = Do(WArr, function* () {
      const a = yield* WArr([10, ArrayT(["d1"])]);
      const b = yield* WArr([20, ArrayT(["d2"])]);
      return a + b;
    });
    assert_equals(w_do.value()[0], 30);
    assert_equals(w_do.value()[1].value(), ["d1", "d2"]);

    // Validation.map_error + N-ary lift + ap + compare
    const str_sg = {
      concat: (a: readonly string[], b: readonly string[]) => [...a, ...b],
    };
    const v_ok = map_validation_error(
      Valid(10) as ReturnType<typeof InvalidMessages<number>>,
      (e) => e,
      str_sg,
    );
    assert_equals(v_ok.value(), ["valid", 10]);
    const v_err = map_validation_error(
      InvalidMessages("e1", "e2"),
      (msgs) => msgs.map((m) => m.toUpperCase()),
      str_sg,
    );
    assert_equals(v_err.value()[0], "invalid");
    assert_equals(v_err.value()[1], ["E1", "E2"]);
    const v_lift = Applicative.lift(
      (a: number, b: number, c: number, d: number) => a + b + c + d,
      Valid(1) as ReturnType<typeof InvalidMessages<number>>,
      InvalidMessages<number>("x"),
      Valid(3) as ReturnType<typeof InvalidMessages<number>>,
      InvalidMessages<number>("y"),
    );
    assert_equals(v_lift.value()[0], "invalid");
    assert_equals(
      Ord.compare(
        InvalidMessages<number>("a"),
        Valid(1) as ReturnType<typeof InvalidMessages<number>>,
      ),
      "lt",
    );

    // Fn ap, lift, Do, traverse
    const fn_lifted = Applicative.lift(
      (a: number, b: number, c: number) => a + b + c,
      Fn((x: number) => x + 1),
      Fn((x: number) => x * 2),
      Fn((x: number) => x * 3),
    );
    assert_equals(fn_lifted.run(5), 31);
    const fn_ap = Applicative.ap(
      Fn((x: number) => (y: number) => x + y),
      Fn((x: number) => x * 10),
    );
    assert_equals(fn_ap.run(3), 33);
    const fn_do = Do(Fn.with_input<number>(), function* () {
      const a = yield* Fn((x: number) => x + 1);
      const b = yield* Fn((x: number) => x * 2);
      return a + b;
    });
    assert_equals(fn_do.run(4), 13);
    const fn_trav = Traversable.traverse(
      ArrayT([1, 2, 3]),
      Fn.with_input<number>(),
      (n) => Fn((x: number) => x + n),
    );
    assert_equals(fn_trav.run(10).value(), [11, 12, 13]);

    // Tuple.with_monoid
    const TM = Tuple.with_monoid(ArrayT<number>([]));
    const tm_res = TM.pure((n: number) => n + 5).ap(TM.pure(1));
    assert_equals(tm_res.value()[0].value(), []);
    assert_equals(tm_res.value()[1], 6);
    const tm_comb = Applicative.lift(
      (a: number, b: number) => a + b,
      TM([ArrayT([1]), 10]),
      TM([ArrayT([2]), 20]),
    );
    assert_equals(tm_comb.value()[0].value(), [1, 2]);
    assert_equals(tm_comb.value()[1], 30);
    assert_equals(Monoid.empty(ArrayT).value(), []);
  }

  // 4. Task & ParallelTask sync + async fast paths
  {
    const p2_sync = Applicative.lift(
      (a: number, b: number) => a + b,
      ParallelTask.pure(10),
      parallel(from_fn(() => 20)),
    );
    assert_equals(await run_task(sequential(p2_sync)), 30);

    const p3_sync = Applicative.lift(
      (a: number, b: number, c: number) => a + b + c,
      parallel(from_fn(() => 1)),
      parallel(from_fn(() => 2)),
      parallel(from_fn(() => 3)),
    );
    assert_equals(await run_task(sequential(p3_sync)), 6);

    const p3_async = Applicative.lift(
      (a: number, b: number, c: number) => a + b + c,
      parallel(from_promise(Promise.resolve(10))),
      parallel(from_fn(() => 20)),
      parallel(from_promise(Promise.resolve(30))),
    );
    assert_equals(await run_task(sequential(p3_async)), 60);

    const p4_async = Applicative.lift(
      (a: number, b: number, c: number, d: number) => a + b + c + d,
      parallel(from_promise(Promise.resolve(1))),
      parallel(from_promise(Promise.resolve(2))),
      parallel(from_promise(Promise.resolve(3))),
      parallel(from_promise(Promise.resolve(4))),
    );
    assert_equals(await run_task(sequential(p4_async)), 10);

    // Task.ap sync + async
    assert_equals(
      await run_task(
        Applicative.ap(
          from_fn((): (n: number) => number => (n: number) => n * 3),
          from_promise(Promise.resolve(7)),
        ),
      ),
      21,
    );
    assert_equals(
      await run_task(
        Applicative.ap(
          from_promise(Promise.resolve((n: number) => n + 5)),
          from_promise(Promise.resolve(7)),
        ),
      ),
      12,
    );

    // Task tail_rec_m sync + async
    const rec_sync = MonadRec.tail_rec_m(
      Task,
      0,
      (n) => n >= 5 ? succeed(done(n)) : from_fn(() => rec(n + 1)),
    );
    assert_equals(await run_task(rec_sync), 5);
    const rec_async = MonadRec.tail_rec_m(
      Task,
      0,
      (n) =>
        n >= 3
          ? from_promise(Promise.resolve(done(n * 10)))
          : from_promise(Promise.resolve(rec(n + 1))),
    );
    assert_equals(await run_task(rec_async), 30);

    // Task Do sync + async & traverse_task sync + async
    const t_do = Do(Task, function* () {
      const a = yield* from_fn(() => 4);
      const b = yield* from_promise(Promise.resolve(6));
      return a + b;
    });
    assert_equals(await run_task(t_do), 10);
    assert_equals(
      await run_task(
        traverse_task(
          [1, 2, 3, 4],
          2,
          (n) =>
            n % 2 === 0
              ? from_promise(Promise.resolve(n * 10))
              : from_fn(() => n * 10),
        ),
      ),
      [10, 20, 30, 40],
    );
  }

  // 5. STM: trusted shape, immutable frozen subtree validation, update_immutable_path, or_else retry
  {
    const tv_shape = new_tvar(
      { id: 1, tags: ["a", "b"] },
      { shape: { record: { id: "number", tags: { array: "string" } } } },
    );
    assert_equals(atomically(read_tvar(tv_shape)), { id: 1, tags: ["a", "b"] });
    atomically(write_tvar(tv_shape, { id: 2, tags: ["c"] }));
    assert_equals(atomically(read_tvar(tv_shape)), { id: 2, tags: ["c"] });

    const frozen_inner = Object.freeze({
      score: 10,
      items: Object.freeze([1, 2, 3]),
    });
    const frozen_root = Object.freeze({
      left: frozen_inner,
      right: Object.freeze({ score: 20 }),
    });
    const tv_imm = new_immutable_tvar(frozen_root);
    const updated = atomically(
      update_immutable_path(tv_imm, ["right", "score"], () => 99),
    );
    assert_true(updated.left === frozen_inner, "structural sharing preserved");
    assert_equals(updated.right.score, 99);
    assert_equals(atomically(read_tvar(tv_imm)).right.score, 99);

    const tv_n = new_tvar(0);
    const res = atomically(
      or_else(
        Do(Stm, function* () {
          yield* write_tvar(tv_n, 999);
          return yield* retry<number>();
        }),
        Do(Stm, function* () {
          const cur = yield* read_tvar(tv_n);
          yield* modify_tvar(tv_n, (x) => x + 5);
          return cur + 1;
        }),
      ),
    );
    assert_equals(res, 1);
    assert_equals(atomically(read_tvar(tv_n)), 5);

    let aborted = false;
    try {
      atomically(abort("stm-abort"));
    } catch (e) {
      aborted = e instanceof Error && e.message.includes("stm-abort");
    }
    assert_true(aborted, "stm abort throws");
  }

  // 6. AsyncIterableT: map_concurrent (ordered & unordered), pipelines, chunks, streams, for-await
  {
    const sync_src = from_sync_factory(() => [1, 2, 3, 4, 5, 6]);
    const snap_src = await from_async_iterable((async function* () {
      for (const x of [1, 2, 3, 4, 5, 6]) yield x;
    })());
    const chunk_src = from_chunks(async function* () {
      yield [1, 2, 3];
      yield [4, 5, 6];
    });
    const make_stream_src = () =>
      from_readable_stream_source(
        new ReadableStream<number>({
          start(c) {
            for (const x of [1, 2, 3, 4, 5, 6]) c.enqueue(x);
            c.close();
          },
        }),
        false,
      );
    const gen_src = AsyncIterableT(async function* () {
      for (const x of [1, 2, 3, 4, 5, 6]) yield x;
    });

    // map_concurrent ordered & unordered (sync + async callbacks, multiple terminals)
    assert_equals(
      await ai_to_array(map_concurrent(sync_src, 3, (x) => x * 2)),
      [2, 4, 6, 8, 10, 12],
    );
    assert_equals(
      await ai_to_array(
        map_concurrent(chunk_src, 2, (x) => Promise.resolve(x * 3)),
      ),
      [3, 6, 9, 12, 15, 18],
    );
    assert_equals(
      await ai_preview(
        map_concurrent(make_stream_src(), 2, (x) => Promise.resolve(x + 1)),
        3,
      ),
      [2, 3, 4],
    );
    assert_equals(
      (await ai_find(
        map_concurrent(gen_src, 2, (x) => Promise.resolve(x * 10)),
        (x) => x >= 30,
      )).value(),
      ["Just", 30],
    );
    assert_true(
      await ai_some(
        map_concurrent_unordered(sync_src, 3, (x) => x * 2),
        (x) => x === 10,
      ),
      "unordered some",
    );
    const unord_all = await ai_to_array(
      map_concurrent_unordered(chunk_src, 3, (x) => Promise.resolve(x + 10)),
    );
    assert_equals(
      unord_all.slice().sort((a, b) => a - b),
      [11, 12, 13, 14, 15, 16],
    );
    const unord_fold = await ai_fold_while(
      map_concurrent_unordered(snap_src, 2, (x) => x),
      0,
      (acc, x) => acc + x >= 6 ? ["Done", acc + x] : ["Continue", acc + x],
    );
    assert_true(unord_fold >= 6, "unordered fold_while stops early");

    // Pipeline stage specializations + async transition + for-await generator
    assert_equals(
      await ai_to_array(
        sync_src.map((x) => x * 2).filter((x) => x > 4).take(2),
      ),
      [6, 8],
    );
    assert_equals(
      await ai_to_array(
        sync_src.filter((x) => x % 2 === 0).map((x) =>
          Promise.resolve(x + 1) as unknown as number
        ),
      ),
      [3, 5, 7],
    );
    assert_equals(
      await ai_to_array(
        chunk_src.map((x) => x + 1).filter((x) => x % 2 === 0).take(2),
      ),
      [2, 4],
    );
    assert_equals(
      await ai_to_array(
        ai_filter_map(
          make_stream_src(),
          (x) => x % 2 === 0 ? Just(x * 10) : Nothing(),
        ).take(2),
      ),
      [20, 40],
    );
    assert_equals(
      await ai_to_array(
        gen_src.map((x) => x * 2).filter((x) => x >= 6).take(2),
      ),
      [6, 8],
    );
    // Direct for-await over pipeline (exercises async function* generator path)
    const iterated: number[] = [];
    for await (
      const v of chunk_src.map((x) => x + 10).filter((x) => x % 2 === 0)
        .take(2).value()()
    ) {
      iterated.push(v);
    }
    assert_equals(iterated, [12, 14]);
  }

  // 7. Collections, binary equality, prelude, and handlers (prepare_operations 1/2/3/4 tags)
  {
    assert_equals(
      fold_while(
        ArrayT([1, 2, 3, 4, 5]),
        0,
        (a, x) => a + x >= 6 ? ["Done", a + x] : ["Continue", a + x],
      ),
      6,
    );
    assert_equals(
      fold_while(
        list_from_array([1, 2, 3, 4]),
        0,
        (a, x) => a + x >= 3 ? ["Done", a + x] : ["Continue", a + x],
      ),
      3,
    );
    assert_equals(
      fold_while(
        SetT(new Set([10, 20, 30])),
        0,
        (a, x) => x === 20 ? ["Done", a + x] : ["Continue", a + x],
      ),
      30,
    );
    assert_equals(
      fold_while(
        MapT(new Map([["a", 1], ["b", 2], ["c", 3]])),
        0,
        (a, x) => x === 2 ? ["Done", a + x] : ["Continue", a + x],
      ),
      3,
    );
    // Empty-dim Cartesian lift short-circuit
    assert_equals(
      Applicative.lift(
        (a: number, b: number, c: number) => a + b + c,
        ArrayT([1, 2, 3]),
        ArrayT<number>([]),
        ArrayT([4, 5, 6]),
      ).value(),
      [],
    );
    assert_equals(
      list_to_array(
        Applicative.lift(
          (a: number, b: number) => a + b,
          list_from_array([1, 2]),
          list_from_array<number>([]),
        ),
      ),
      [],
    );

    // IterableT preview/eq/fold
    assert_equals(iter_preview(iter_from_array([1, 2, 3, 4]), 2), [1, 2]);
    assert_true(
      Eq.eq(iter_from_array([1, 2, 3]), iter_from_array([1, 2, 3])),
      "IterableT eq",
    );
    assert_equals(
      Foldable.fold(iter_from_array([1, 2, 3]), 0, (a, b) => a + b),
      6,
    );

    // Binary eq / from_bytes / RecordT / MapT / FormDataT
    const b1 = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const b2 = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const b3 = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 11]);
    assert_true(Eq.eq(ab_from_bytes(b1), ab_from_bytes(b2)), "ArrayBufferT eq");
    assert_true(
      !Eq.eq(ab_from_bytes(b1), ab_from_bytes(b3)),
      "ArrayBufferT neq",
    );
    assert_true(
      Eq.eq(from_typed_array(b1), from_typed_array(b2)),
      "TypedArrayT eq",
    );
    assert_true(
      Eq.eq(
        DataViewT(new DataView(b1.buffer)),
        DataViewT(new DataView(b2.buffer)),
      ),
      "DataViewT eq",
    );
    assert_true(
      Eq.eq(from_record_view({ a: 1, b: 2 }), RecordT({ a: 1, b: 2 })),
      "RecordT eq",
    );
    assert_true(
      Eq.eq(MapT(new Map([["a", 1]])), MapT(new Map([["a", 1]]))),
      "MapT eq",
    );
    const fd1 = new FormData();
    fd1.append("k", "1");
    const fd2 = new FormData();
    fd2.append("k", "2");
    assert_equals(
      [...FormDataT(fd1).concat(FormDataT(fd2)).value().entries()],
      [["k", "1"], ["k", "2"]],
    );

    // prelude.elem, prelude.fold_map, prelude.traverse_
    assert_true(elem(2, SetT(new Set([1, 2, 3]))), "elem SetT hit");
    assert_true(!elem(9, SetT(new Set([1, 2, 3]))), "elem SetT miss");
    assert_true(elem(3, ArrayT([1, 2, 3])), "elem ArrayT");
    assert_true(elem(2, list_from_array([1, 2, 3])), "elem List");
    assert_equals(
      fold_map(ArrayT, (n: number) => ArrayT([n, n * 2]), ArrayT([1, 2]))
        .value(),
      [1, 2, 2, 4],
    );
    assert_equals(
      list_to_array(
        fold_map(
          List,
          (n: number) => list_from_array([n]),
          list_from_array([3, 4]),
        ),
      ),
      [3, 4],
    );
    assert_equals(
      [
        ...fold_map(
          SetT,
          (n: number) => SetT(new Set([n])),
          SetT(new Set([5, 6])),
        ).value(),
      ],
      [5, 6],
    );
    assert_equals(
      flatten_chunk_log(
        fold_map(ChunkLog, (n: number) => chunk_log([n]), ArrayT([7, 8])),
      ),
      [7, 8],
    );
    // traverse_ across State, Reader, Task, Writer, Stm, Validation, ArrayT, Maybe, Either
    assert_equals(
      traverse_(
        (n: number) => State((s: number) => [undefined, s + n]),
        State.with_state<number>(),
        ArrayT([1, 2, 3]),
      ).run(10)[1],
      16,
    );
    let r_sum = 0;
    traverse_(
      (n: number) =>
        ask<number>().map((env) => {
          r_sum += env * n;
        }),
      Reader.with_environment<number>(),
      ArrayT([1, 2, 3]),
    ).run(10);
    assert_equals(r_sum, 60);
    let t_sum = 0;
    await run_task(
      traverse_(
        (n: number) =>
          from_fn(() => {
            t_sum += n;
          }),
        Task,
        ArrayT([2, 4, 6]),
      ),
    );
    assert_equals(t_sum, 12);
    const WArr2 = Writer.with(ArrayT<number>([]));
    assert_equals(
      traverse_(
        (n: number) => WArr2([undefined, ArrayT([n])]),
        WArr2,
        ArrayT([1, 2]),
      )
        .value()[1].value(),
      [1, 2],
    );
    const tv_tr = new_tvar(0);
    atomically(
      traverse_(
        (n: number) => modify_tvar(tv_tr, (x) => x + n),
        Stm,
        ArrayT([3, 4]),
      ),
    );
    assert_equals(atomically(read_tvar(tv_tr)), 7);
    assert_equals(
      traverse_(
        (n: number) =>
          n > 0
            ? (Valid(undefined) as ReturnType<
              typeof InvalidMessages<undefined>
            >)
            : InvalidMessages<undefined>(`bad:${n}`),
        Validation.with_error<readonly string[]>(),
        ArrayT([1, -1, -2]),
      ).value()[0],
      "invalid",
    );
    assert_equals(
      traverse_(
        (n: number) => n > 0 ? Just(undefined) : Nothing(),
        Maybe,
        ArrayT([1, 2]),
      )
        .value(),
      ["Just", undefined],
    );
    assert_equals(
      traverse_(
        (n: number) => n > 0 ? Right(undefined) : Left("neg"),
        Either.with_left<string>(),
        ArrayT([1, -1]),
      ).value(),
      ["Left", "neg"],
    );
    assert_equals(
      traverse_((n: number) => Identity(n), Identity, ArrayT([1, 2])).value(),
      undefined,
    );

    // handlers: prepare_operations with 1, 2, 3, and 4 tags
    const Op1 = Effect.operation<number, number>()("w2_op1");
    const Op2 = Effect.operation<number, number>()("w2_op2");
    const Op3 = Effect.operation<number, number>()("w2_op3");
    const Op4 = Effect.operation<number, number>()("w2_op4");
    const h2 = prepare_operations({
      w2_op1: (op: readonly ["w2_op1", number]) => Effect.pure(op[1] + 1),
      w2_op2: (op: readonly ["w2_op2", number]) => Effect.pure(op[1] * 2),
    });
    const h3 = prepare_operations({
      w2_op1: (op: readonly ["w2_op1", number]) => Effect.pure(op[1] + 1),
      w2_op2: (op: readonly ["w2_op2", number]) => Effect.pure(op[1] * 2),
      w2_op3: (op: readonly ["w2_op3", number]) => Effect.pure(op[1] + 10),
    });
    const h4 = prepare_operations({
      w2_op1: (op: readonly ["w2_op1", number]) => Effect.pure(op[1] + 1),
      w2_op2: (op: readonly ["w2_op2", number]) => Effect.pure(op[1] * 2),
      w2_op3: (op: readonly ["w2_op3", number]) => Effect.pure(op[1] + 10),
      w2_op4: (op: readonly ["w2_op4", number]) => Effect.pure(op[1] - 3),
    });
    assert_equals(
      run(
        h2(
          Program(function* () {
            const a = yield* Op1.send(5);
            return yield* Op2.send(a);
          }),
        ),
      ),
      12,
    );
    assert_equals(
      run(
        h3(
          Program(function* () {
            const a = yield* Op1.send(5);
            const b = yield* Op2.send(a);
            return yield* Op3.send(b);
          }),
        ),
      ),
      22,
    );
    assert_equals(
      run(
        h4(
          Program(function* () {
            const a = yield* Op1.send(5);
            const b = yield* Op2.send(a);
            const c = yield* Op3.send(b);
            return yield* Op4.send(c);
          }),
        ),
      ),
      19,
    );
    // 1-shot run_cells with reader + state + writer
    const r_cell = reader<number>()("w2_r");
    const s_cell = state<number>()("w2_s");
    const w_cell = writer_cell("w2_w", ArrayT<string>([]));
    const cell_out = run_cells(
      Program(function* () {
        const rv = yield* r_cell.ask();
        const sv = yield* s_cell.get();
        yield* s_cell.put(rv + sv);
        yield* w_cell.tell(ArrayT([`sum:${rv + sv}`]));
        return rv + sv;
      }),
      {
        r: provide_reader(r_cell, 10),
        s: provide_state(s_cell, 5),
        w: provide_writer(w_cell),
      },
    );
    assert_equals(cell_out.result, 15);
    assert_equals(cell_out.states.s, 15);
    assert_equals(cell_out.logs.w.value(), ["sum:15"]);
  }
});

Deno.test("Codex Wave 2 review regressions (STM, Writer, Task, AsyncIterableT, Fn, Traversal, Array, Prelude, Handlers)", async () => {
  const [
    { Do, Traversable },
    { Writer },
    { Fn },
    {
      from_sync_factory,
      map_concurrent,
      map_concurrent_unordered,
      to_array: ai_to_array,
    },
    { from_fn, run_task, traverse_task },
    { atomically, new_tvar, read_tvar },
    { to_array: prelude_to_array },
    { State },
  ] = await Promise.all([
    import("./typeclasses.ts"),
    import("./writer.ts"),
    import("./fn.ts"),
    import("./async_iterable.ts"),
    import("./task.ts"),
    import("./stm.ts"),
    import("./prelude.ts"),
    import("./state.ts"),
  ]);

  // P1-3: STM trusted shape clone must not turn an aliased array into a plain object
  {
    const a = [7];
    const tv = new_tvar(
      { asArray: a, asRecord: a as unknown as Record<string, unknown> },
      {
        shape: {
          record: {
            asRecord: { record: {} },
            asArray: { array: "number" },
          },
        },
      },
    );
    const out = atomically(read_tvar(tv));
    assert_true(Array.isArray(out.asArray), "asArray remains an array");
    assert_true(Object.is(out.asArray, out.asRecord), "aliases preserved");
    assert_equals(out.asArray, [7]);
  }

  // P1-4: Writer must not expose shared backing storage across chained values
  {
    const W = Writer.with(ArrayT<number>([]));
    const a = W([undefined, ArrayT([0])]).bind(() =>
      W([undefined, ArrayT([1])])
    );
    const b = a.bind(() => W([undefined, ArrayT([2])]));
    const b_val = b.value();
    const b_log = b_val[1].value() as number[];
    assert_equals(b_log, [0, 1, 2]);
    b_log[0] = 9;
    assert_equals(a.value()[1].value(), [0, 1]);

    const c = a.map(() => "ok");
    const c_log = c.value()[1].value() as number[];
    c_log[1] = 88;
    assert_equals(a.value()[1].value(), [0, 1]);
  }

  // P1-5: Task traversal must deliver a real AbortSignal to default-param and rest-param callbacks
  {
    const res_no_outer = await run_task(
      traverse_task([0], 1, () => from_fn((s = undefined) => !!s)),
    );
    assert_equals(res_no_outer, [true]);

    const ctrl = new AbortController();
    const res_with_outer = await run_task(
      traverse_task([0], 1, () => from_fn((s = undefined) => !!s)),
      { signal: ctrl.signal },
    );
    assert_equals(res_with_outer, [true]);

    const res_rest = await run_task(
      traverse_task([0], 1, () => from_fn((...args) => !!args[0])),
      { signal: ctrl.signal },
    );
    assert_equals(res_rest, [true]);
  }

  // P1-7 & P2-1: Concurrent AsyncIterable single factory open, thenable normalization, huge concurrency & cleanup
  {
    let ordered_calls = 0;
    const ord_set = await ai_to_array(
      map_concurrent(
        from_sync_factory(() => new Set([++ordered_calls])),
        2,
        (x) => x,
      ),
    );
    assert_equals(ordered_calls, 1);
    assert_equals(ord_set, [1]);

    let unordered_calls = 0;
    const unord_set = await ai_to_array(
      map_concurrent_unordered(
        from_sync_factory(() => new Set([++unordered_calls])),
        2,
        (x) => x,
      ),
    );
    assert_equals(unordered_calls, 1);
    assert_equals(unord_set, [1]);

    // Sync factory yielding Promise.resolve(7) must normalize to 7
    const seen_ord: unknown[] = [];
    const ord_prom = await ai_to_array(
      map_concurrent(
        from_sync_factory(() => [Promise.resolve(7) as unknown as number]),
        2,
        (x) => {
          seen_ord.push(x);
          return x;
        },
      ),
    );
    assert_equals(seen_ord, [7]);
    assert_equals(ord_prom, [7]);

    const seen_unord: unknown[] = [];
    const unord_prom = await ai_to_array(
      map_concurrent_unordered(
        from_sync_factory(() => [Promise.resolve(7) as unknown as number]),
        2,
        (x) => {
          seen_unord.push(x);
          return x;
        },
      ),
    );
    assert_equals(seen_unord, [7]);
    assert_equals(unord_prom, [7]);

    // Mixed sync-async callback + later promise element (hits finish_concurrent_sync_array)
    const mixed_ord = await ai_to_array(
      map_concurrent(
        from_sync_factory(() => [1, Promise.resolve(7) as unknown as number]),
        2,
        (x) => Promise.resolve(x * 10),
      ),
    );
    assert_equals(mixed_ord, [10, 70]);

    const mixed_unord = await ai_to_array(
      map_concurrent_unordered(
        from_sync_factory(() => [1, Promise.resolve(7) as unknown as number]),
        2,
        (x) => Promise.resolve(x * 10),
      ),
    );
    assert_equals(mixed_unord.slice().sort((a, b) => a - b), [10, 70]);

    // P2-1: Huge concurrency (2 ** 32) succeeds without RangeError and cleans up abort listener
    let added = 0;
    let removed = 0;
    const ctrl = new AbortController();
    const orig_add = ctrl.signal.addEventListener.bind(ctrl.signal);
    const orig_rem = ctrl.signal.removeEventListener.bind(ctrl.signal);
    ctrl.signal.addEventListener = ((...args: Parameters<typeof orig_add>) => {
      added += 1;
      return orig_add(...args);
    }) as typeof ctrl.signal.addEventListener;
    ctrl.signal.removeEventListener = ((
      ...args: Parameters<typeof orig_rem>
    ) => {
      removed += 1;
      return orig_rem(...args);
    }) as typeof ctrl.signal.removeEventListener;

    const async_one = from_sync_factory(() => [42]);
    const big_ord = await ai_to_array(
      map_concurrent(async_one, 2 ** 32, (x) => Promise.resolve(x + 1), {
        signal: ctrl.signal,
      }),
    );
    assert_equals(big_ord, [43]);
    const big_unord = await ai_to_array(
      map_concurrent_unordered(
        async_one,
        2 ** 32,
        (x) => Promise.resolve(x + 2),
        { signal: ctrl.signal },
      ),
    );
    assert_equals(big_unord, [44]);
    assert_equals(added, 2);
    assert_equals(removed, 2);
  }

  // P2-2: Fn Do replay after first action throws + eager Fn array traverse
  {
    const FnNum = Fn.with_input<number>();
    let counter = 0;
    let attempts = 0;
    const fn_prog = Do(FnNum, function* () {
      const n = ++counter;
      const v = yield* FnNum((x: number) => {
        attempts += 1;
        if (attempts === 1) throw new Error("boom");
        return x + 10;
      });
      return n * 100 + v;
    });
    let threw = false;
    try {
      fn_prog.value()(5);
    } catch {
      threw = true;
    }
    assert_true(threw, "first Fn run throws");
    assert_equals(fn_prog.value()(5), 115);

    let constructed = 0;
    const trav_fn = Traversable.traverse(
      ArrayT([1, 2]),
      FnNum,
      (n) => {
        constructed += 1;
        return FnNum((env: number) => env + n);
      },
    );
    assert_equals(constructed, 2);
    assert_equals(trav_fn.value()(10).value(), [11, 12]);
  }

  // P2-3: Observable array mutation during traverse and custom array [Symbol.iterator]
  {
    const live = [1, 2];
    const m_res = Traversable.traverse(ArrayT(live), Maybe, (n) => {
      if (n === 1) live.push(3);
      return Just(n);
    });
    assert_equals(m_res.value(), ["Just", ArrayT([1, 2, 3])]);

    const StateNum = State.with_state<number>();
    const live_single = [1];
    const s_res = Traversable.traverse(
      ArrayT(live_single),
      StateNum,
      (n) => {
        if (n === 1) live_single.push(2);
        return StateNum((s: number) => [n + s, s + 1] as const);
      },
    );
    const [s_arr, s_final] = s_res.value()(0);
    assert_equals(s_arr.value(), [1, 3]);
    assert_equals(s_final, 2);

    const custom_iter_arr = [1, 2] as number[];
    Object.defineProperty(custom_iter_arr, Symbol.iterator, {
      value: function* () {
        yield 7;
      },
    });
    assert_equals(
      ArrayT(custom_iter_arr).concat(ArrayT([3])).value(),
      [7, 3],
    );
    assert_equals(prelude_to_array(ArrayT(custom_iter_arr)), [7]);
  }

  // P2-4: run_cells one-shot fallback reads each binding getter at most once
  {
    const r1 = reader<number>()("p24_r1");
    const r2 = reader<number>()("p24_r2");
    const r3 = reader<number>()("p24_r3");
    const r4 = reader<number>()("p24_r4");
    let getter_reads = 0;
    const bindings = {
      get a() {
        getter_reads += 1;
        return provide_reader(r1, 1);
      },
      get b() {
        getter_reads += 1;
        return provide_reader(r2, 2);
      },
      get c() {
        getter_reads += 1;
        return provide_reader(r3, 3);
      },
      get d() {
        getter_reads += 1;
        return provide_reader(r4, 4);
      },
    };
    const out = run_cells(Effect.pure(99), bindings);
    assert_equals(out.result, 99);
    assert_equals(getter_reads, 4);
  }

  // Codex signoff follow-up regressions (5 P1s + 5 P2s)
  {
    // 1. Task traverse_task sync-to-async handoff shares the same AbortController & aborts sibling
    let sig0: AbortSignal | undefined;
    let sig1: AbortSignal | undefined;
    let rejected = false;
    try {
      await run_task(
        traverse_task([0, 1], 2, (item) =>
          from_fn((signal) => {
            if (item === 0) {
              sig0 = signal;
              return new Promise<number>(() => {});
            }
            sig1 = signal;
            return Promise.reject(new Error("sibling boom"));
          })),
      );
    } catch {
      rejected = true;
    }
    assert_true(rejected, "traverse_task rejects on sibling failure");
    assert_true(sig0 !== undefined && sig0 === sig1, "siblings share signal");
    assert_true(
      sig0!.aborted,
      "first sibling signal aborted on second failure",
    );

    // 2. Concurrent AsyncIterable reads getter-backed promised array element only once
    const getter_arr: unknown[] = [1, 0];
    let elem_reads = 0;
    Object.defineProperty(getter_arr, "1", {
      enumerable: true,
      configurable: true,
      get() {
        elem_reads += 1;
        return elem_reads === 1 ? Promise.resolve(7) : 9;
      },
    });
    const ord_once = await ai_to_array(
      map_concurrent(
        from_sync_factory(() => getter_arr as number[]),
        2,
        (x) => x,
      ),
    );
    assert_equals(elem_reads, 1);
    assert_equals(ord_once, [1, 7]);

    elem_reads = 0;
    const unord_once = await ai_to_array(
      map_concurrent_unordered(
        from_sync_factory(() => getter_arr as number[]),
        2,
        (x) => x,
      ),
    );
    assert_equals(elem_reads, 1);
    assert_equals(unord_once.slice().sort((a, b) => a - b), [1, 7]);

    // 3. Fn replay preserves original first action result
    const FnNum = Fn.with_input<number>();
    let fn_prefix = 0;
    const fn_replay = Do(FnNum, function* () {
      const n = ++fn_prefix;
      return yield* FnNum(() => n);
    });
    assert_equals(
      [fn_replay.value()(0), fn_replay.value()(0), fn_replay.value()(0)],
      [1, 1, 1],
    );

    // 4. Raw sync iterator yielding rejected promise closes upstream once on rejection
    let sync_closed = 0;
    const rej_src = from_sync_factory(() => ({
      [Symbol.iterator]() {
        let yielded = false;
        return {
          next() {
            if (!yielded) {
              yielded = true;
              return {
                done: false,
                value: Promise.reject(
                  new Error("raw rej"),
                ) as unknown as number,
              };
            }
            return { done: true, value: undefined };
          },
          return() {
            sync_closed += 1;
            return { done: true, value: undefined };
          },
        };
      },
    }));
    const raw_it = rej_src.value()()[Symbol.asyncIterator]();
    let raw_threw = false;
    try {
      await raw_it.next();
    } catch {
      raw_threw = true;
    }
    assert_true(raw_threw, "raw sync iterator rejected promise rejects next()");
    assert_equals(sync_closed, 1);

    // 5. Collection Symbol.iterator getter is read at most once
    const make_getter_arr = () => {
      const arr = [1] as number[];
      let reads = 0;
      Object.defineProperty(arr, Symbol.iterator, {
        configurable: true,
        get() {
          reads += 1;
          const tag = reads;
          return function* () {
            yield tag * 10;
          };
        },
      });
      return { arr, get_reads: () => reads };
    };
    const g1 = make_getter_arr();
    assert_equals(prelude_to_array(ArrayT(g1.arr)), [10]);
    assert_equals(g1.get_reads(), 1);

    const g2 = make_getter_arr();
    assert_equals(ArrayT(g2.arr).concat(ArrayT([3])).value(), [10, 3]);
    assert_equals(g2.get_reads(), 1);

    const g3 = make_getter_arr();
    const StateNum = State.with_state<number>();
    const [g3_out] = Traversable.traverse(
      ArrayT(g3.arr),
      StateNum,
      (n) => StateNum((s: number) => [n + s, s + 1] as const),
    ).value()(0);
    assert_equals(g3_out.value(), [10]);
    assert_equals(g3.get_reads(), 1);

    // Also test generic binary-carry singleton traversal path (List has no specialization)
    const { List, to_array: list_to_array } = await import("./list.ts");
    const g4 = make_getter_arr();
    const g4_res = list_to_array(
      Traversable.traverse(
        ArrayT(g4.arr),
        List,
        (n) => List.pure(n),
      ),
    );
    assert_equals(g4_res.map((a) => a.value()), [[10]]);
    assert_equals(g4.get_reads(), 1);

    // 6. Array concat consumes left iterator before reading right getter, and Reflect.apply works when .call is overwritten
    let concat_state = 1;
    const left_ord = [0] as number[];
    const right_ord = [0] as number[];
    Object.defineProperty(left_ord, Symbol.iterator, {
      configurable: true,
      get() {
        const fn = function* () {
          concat_state = 2;
          yield 10;
        };
        (fn as unknown as { call: unknown }).call = undefined;
        return fn;
      },
    });
    Object.defineProperty(right_ord, Symbol.iterator, {
      configurable: true,
      get() {
        const seen = concat_state;
        const fn = function* () {
          yield seen * 100;
        };
        (fn as unknown as { call: unknown }).call = undefined;
        return fn;
      },
    });
    assert_equals(
      ArrayT(left_ord).concat(ArrayT(right_ord)).value(),
      [10, 200],
    );

    const no_call_arr = [1] as number[];
    const no_call_iter = function* () {
      yield 77;
    };
    (no_call_iter as unknown as { call: unknown }).call = undefined;
    Object.defineProperty(no_call_arr, Symbol.iterator, {
      configurable: true,
      value: no_call_iter,
    });
    assert_equals(prelude_to_array(ArrayT(no_call_arr)), [77]);
    assert_equals(
      ArrayT([1]).concat(ArrayT(no_call_arr)).value(),
      [1, 77],
    );
    assert_equals(
      list_to_array(
        Traversable.traverse(ArrayT(no_call_arr), List, (n) => List.pure(n)),
      ).map((a) => a.value()),
      [[77]],
    );
  }
});
