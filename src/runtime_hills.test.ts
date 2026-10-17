import { assert_equals, assert_true } from "./assert.ts";
import { ArrayT } from "./array.ts";
import { Effect, Program } from "./effects.ts";
import {
  atomically,
  new_immutable_tvar,
  new_tvar,
  or_else,
  read_tvar,
  retry,
  Stm,
  write_tvar,
} from "./stm.ts";
import {
  from_fn,
  run_task,
  run_task_exit,
  succeed,
  traverse_task,
} from "./task.ts";
import { Do } from "./typeclasses.ts";
import { Reader, reader } from "./reader.ts";
import { State, state } from "./state.ts";
import { run_writer_terminal, tell } from "./writer.ts";

Deno.test("named operations infer payloads and suspend continuation output", () => {
  const Read = Effect.operation<number>()("read");
  const operation = Read({ key: "answer" });
  const suspended = Effect.suspend(
    operation,
    (value) => Effect.pure(value * 2),
  );
  assert_equals(operation, ["read", { key: "answer" }]);
  if (suspended[0] !== "impure") throw new Error("Expected suspension");
  assert_equals(suspended[2](21)[1], 42);
  // @ts-expect-error A number-producing operation cannot resume with a string.
  Effect.suspend(operation, (value: string) => Effect.pure(value));
});

Deno.test("Task traversal bounds 10k inputs at eight and preserves order", async () => {
  let active = 0;
  let peak = 0;
  const inputs = Array.from({ length: 10_000 }, (_, index) => index);
  const result = await run_task(
    traverse_task(inputs, 8, (input) =>
      from_fn(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active -= 1;
        return input * 2;
      })),
  );
  assert_equals(peak, 8);
  assert_equals(result, inputs.map((input) => input * 2));
});

Deno.test("Task traversal cancellation stops lazy input admission and closes source", async () => {
  const controller = new AbortController();
  let admitted = 0;
  let closed = false;
  function* inputs() {
    try {
      while (true) {
        admitted += 1;
        yield admitted;
      }
    } finally {
      closed = true;
    }
  }
  const task = traverse_task(
    inputs(),
    8,
    () => from_fn(() => new Promise<number>(() => {})),
  );
  const pending = run_task_exit(task, { signal: controller.signal });
  await Promise.resolve();
  controller.abort("done");
  const result = await pending;
  await Promise.resolve();
  assert_equals(result.status, "cancelled");
  assert_equals(admitted, 8);
  assert_true(closed, "cancelled traversal closes its source");
});

Deno.test("Program repeated and branched runs restart only the selected path", async () => {
  let starts = 0;
  let advances = 0;
  const program = Program(function* () {
    starts += 1;
    let total = 0;
    for (let index = 0; index < 100; index += 1) {
      advances += 1;
      total += yield* succeed(1);
    }
    return total;
  });
  assert_equals(await run_task(program), 100);
  assert_equals(await run_task(program), 100);
  assert_equals(starts, 2);
  assert_equals(advances, 200);
});

Deno.test("STM lazy branch journals touch only selected values", () => {
  const variables = Array.from({ length: 100 }, () => new_tvar({ count: 0 }));
  const transaction = Stm((journal) => {
    for (const variable of variables) read_tvar(variable).value()(journal);
    return or_else(
      Stm((branch) => {
        assert_equals(branch.reads.size, 0);
        const value = read_tvar(variables[0]).value()(branch);
        value.count = 9;
        assert_equals(branch.reads.size, 1);
        return retry<number>().value()(branch);
      }),
      read_tvar(variables[0]).map((value) => value.count),
    ).value()(journal);
  });
  assert_equals(atomically(transaction), 0);
});

Deno.test("STM branch merges mutations to staged writes without losing rollback", () => {
  const variable = new_tvar({ count: 1 });
  const transaction = Do(function* () {
    yield* write_tvar(variable, { count: 2 });
    yield* or_else(
      read_tvar(variable).map((value) => {
        value.count = 3;
      }),
      retry(),
    );
    return (yield* read_tvar(variable)).count;
  });
  assert_equals(atomically(transaction), 3);
  assert_equals(atomically(read_tvar(variable)).count, 3);
});

Deno.test("immutable STM isolates incoming data and shares frozen reads", () => {
  const source = { nested: { count: 1 } };
  const variable = new_immutable_tvar(source);
  source.nested.count = 7;
  const first = atomically(read_tvar(variable));
  const second = atomically(read_tvar(variable));
  assert_true(first === second, "immutable references reuse owned snapshots");
  assert_equals(first.nested.count, 1);
  let failure: unknown;
  try {
    first.nested.count = 9;
  } catch (error) {
    failure = error;
  }
  assert_true(
    failure instanceof TypeError,
    "immutable reads reject nested mutation",
  );
  for (
    const value of [new Map(), new Date(), new Uint8Array(1), {
      get value() {
        return 1;
      },
    }]
  ) {
    let error: unknown;
    try {
      new_immutable_tvar(value);
    } catch (caught) {
      error = caught;
    }
    assert_true(
      error instanceof Error,
      "mutable builtins and accessors rejected",
    );
  }
});

Deno.test("Reader and State map/bind plans run 100k steps without recursion", () => {
  const anonymous_reader = Reader.with_environment<number>();
  const anonymous_state = State.with_state<number>();
  const reader_key = Symbol("deep-reader");
  const state_key = Symbol("deep-state");
  const keyed_reader = reader<typeof reader_key, number>(reader_key);
  const keyed_state = state<typeof state_key, number>(state_key);
  let a = anonymous_reader.pure(0);
  let b = anonymous_state.pure(0);
  let c = keyed_reader.pure(0);
  let d = keyed_state.pure(0);
  for (let index = 0; index < 100_000; index += 1) {
    if (index % 2 === 0) {
      a = a.map((value) => value + 1);
      b = b.map((value) => value + 1);
      c = c.map((value) => value + 1);
      d = d.map((value) => value + 1);
    } else {
      a = a.bind((value) =>
        anonymous_reader((environment) => value + environment)
      );
      b = b.bind((value) =>
        anonymous_state((current) => [value + 1, current + 1])
      );
      c = c.bind((value) => keyed_reader((environment) => value + environment));
      d = d.bind((value) => keyed_state((current) => [value + 1, current + 1]));
    }
  }
  assert_equals(a.value()(1), 100_000);
  assert_equals(c.value()(1), 100_000);
  assert_equals(b.value()(0), [100_000, 50_000]);
  assert_equals(d.value()(0), [100_000, 50_000]);
  assert_equals(a.value()(1), 100_000);
});

Deno.test("Writer terminal array logs preserve spread semantics and repeated runs", () => {
  const sparse = new Array<number>(2);
  sparse[1] = 3;
  const program = Program(function* () {
    for (let index = 0; index < 10_000; index += 1) {
      yield* tell(ArrayT([index]));
    }
    yield* tell(ArrayT(sparse));
    return 42;
  });
  for (let count = 0; count < 2; count += 1) {
    const [value, output] = run_writer_terminal(program, ArrayT([-1]));
    const log = output.value();
    assert_equals(value, 42);
    assert_equals(log.length, 10_003);
    assert_equals(log[0], -1);
    assert_equals(log[10_000], 9_999);
    assert_equals(10_001 in log, true);
    assert_equals(log[10_002], 3);
  }
  assert_equals(sparse.length, 2);
});

Deno.test("nested Task maps use one abort listener per active asynchronous source", async () => {
  const controller = new AbortController();
  const original = controller.signal.addEventListener.bind(controller.signal);
  let listeners = 0;
  controller.signal.addEventListener = (
    ...args: Parameters<AbortSignal["addEventListener"]>
  ) => {
    listeners += 1;
    original(...args);
  };
  let task = from_fn(() => Promise.resolve(0));
  for (let index = 0; index < 100; index += 1) {
    task = task.map((value) => value + 1);
  }
  assert_equals(await run_task(task, { signal: controller.signal }), 100);
  assert_equals(listeners, 1);
});

Deno.test("Writer terminal honors custom concat getters and dictionary changes", () => {
  const events: string[] = [];
  const empty = ArrayT<number>([]);
  Object.defineProperty(empty, "concat", {
    get() {
      events.push("get");
      return function (right: ReturnType<typeof ArrayT<number>>) {
        events.push("call");
        return ArrayT([99, ...right.value()]);
      };
    },
  });
  const program = Program(function* () {
    yield* tell(ArrayT([1]));
    return 42;
  });
  assert_equals(run_writer_terminal(program, empty)[1].value(), [99, 1]);
  assert_equals(events, ["get", "call"]);
  const original = Object.getOwnPropertyDescriptor(ArrayT, "concat")!;
  try {
    const changing = Program(function* () {
      yield* tell(ArrayT([1]));
      Object.defineProperty(ArrayT, "concat", {
        configurable: true,
        writable: true,
        value(right: ReturnType<typeof ArrayT<number>>) {
          events.push("changed");
          return ArrayT([77, ...right.value()]);
        },
      });
      yield* tell(ArrayT([2]));
      return 0;
    });
    assert_equals(
      run_writer_terminal(changing, ArrayT<number>([]))[1].value(),
      [77, 2],
    );
    assert_equals(events, ["get", "call", "changed"]);
  } finally {
    Object.defineProperty(ArrayT, "concat", original);
  }
});

Deno.test("Task traversal failure stops admission and aborts active siblings", async () => {
  let started = 0;
  let cancelled = 0;
  const failure = new Error("first failure");
  const task = traverse_task(
    Array.from({ length: 100 }, (_, index) => index),
    8,
    (input) =>
      from_fn((signal) => {
        started += 1;
        if (input === 0) return Promise.reject(failure);
        return new Promise<number>(() => {
          signal?.addEventListener("abort", () => {
            cancelled += 1;
          }, { once: true });
        });
      }),
  );
  const exit = await run_task_exit(task);
  assert_equals(exit.status, "failed");
  if (exit.status !== "failed") throw new Error("Expected failure");
  assert_true(
    exit.error === failure,
    "traversal preserves its primary failure",
  );
  assert_equals(started, 8);
  assert_equals(cancelled, 7);
});
