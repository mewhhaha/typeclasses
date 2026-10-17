import { Effect, Program, run } from "../src/effects.ts";
import { Identity } from "../src/identity.ts";
import { Just } from "../src/maybe.ts";
import { Right } from "../src/either.ts";
import { Do } from "../src/typeclasses.ts";
import { Do_once } from "./experiments/do_once.ts";
import {
  atomically,
  new_immutable_tvar,
  new_tvar,
  or_else,
  read_tvar,
  Stm,
  type StmJournal,
  type TVar,
} from "../src/stm.ts";
import { run_task, succeed, traverse_task } from "../src/task.ts";
import { Reader } from "../src/reader.ts";
import { State } from "../src/state.ts";
import { ArrayT } from "../src/array.ts";
import { run_writer_terminal, tell } from "../src/writer.ts";

let sink: unknown;
function* identity_program() {
  let value = 0;
  for (let index = 0; index < 100; index += 1) {
    value = yield* Identity(value + 1);
  }
  return value;
}
Deno.bench({
  name: "Do/general100",
  group: "Do linear",
  baseline: true,
  fn() {
    sink = Do(identity_program).value();
  },
});
Deno.bench({
  name: "Do/once100",
  group: "Do linear",
  fn() {
    sink = Do_once(identity_program).value();
  },
});

const Tick = Effect.operation<number>()(["bench.tick"]);
function make_program() {
  return Program(function* () {
    let sum = 0;
    for (let index = 0; index < 100; index += 1) {
      sum += yield* Effect.send(Tick);
    }
    return sum;
  });
}
function execute(effect: Effect<typeof Tick, number>): number {
  return run(
    Effect.handle_operation(
      effect,
      (operation): operation is typeof Tick => operation === Tick,
      () => Effect.pure(1),
    ),
  );
}
const repeated = make_program();
execute(repeated);
Deno.bench("Program/construct+first100", () => {
  sink = execute(make_program());
});
Deno.bench("Program/repeated100", () => {
  sink = execute(repeated);
});
const multiresume = make_program();
Deno.bench("Program/multiresume-prefix100", () => {
  if (multiresume[0] !== "impure") throw new Error("Expected suspension");
  sink = execute(multiresume[2](2));
});
let mapped = Effect.send(Tick);
for (let index = 0; index < 1_000; index += 1) {
  mapped = Effect.map(mapped, (value) => value + 1);
}
Deno.bench("Effect/reused-map-queue1000", () => {
  sink = execute(mapped);
});
const task_program = Program(function* () {
  let value = 0;
  for (let index = 0; index < 1_000; index += 1) value += yield* succeed(1);
  return value;
});
Deno.bench("Task/completed-Program1000", async () => {
  sink = await run_task(task_program);
});
Deno.bench("Task/bounded8x1000", async () => {
  sink = await run_task(
    traverse_task(
      Array.from({ length: 1_000 }, (_, index) => index),
      8,
      succeed,
    ),
  );
});

for (const size of [1_000, 10_000, 100_000]) {
  const reader = Reader.with_environment<number>();
  const state = State.with_state<number>();
  let reads = reader.pure(0);
  let states = state.pure(0);
  for (let index = 0; index < size; index += 1) {
    reads = reads.bind((value) => reader.pure(value + 1));
    states = states.bind((value) =>
      state((current) => [value + 1, current + 1])
    );
  }
  Deno.bench(`Reader/reused-bind${size}`, () => {
    sink = reads.value()(0);
  });
  Deno.bench(`State/reused-bind${size}`, () => {
    sink = states.value()(0);
  });
  Deno.bench(`Writer/terminal-array${size}`, () => {
    const program = Program(function* () {
      for (let index = 0; index < size; index += 1) {
        yield* tell(ArrayT([index]));
      }
    });
    sink = run_writer_terminal(program, ArrayT<number>([]));
  });
}

for (const size of [10, 1_000]) {
  const variables = Array.from({ length: size }, () => new_tvar({ value: 1 }));
  const transaction = Stm((journal) => {
    for (const variable of variables) read_tvar(variable).value()(journal);
    return or_else(read_tvar(variables[0]), read_tvar(variables[0])).value()(
      journal,
    );
  });
  Deno.bench(`STM/full-transaction-one-edit${size}`, () => {
    sink = atomically(transaction);
  });
  const journal: StmJournal = { reads: new Map(), writes: new Map() };
  for (const variable of variables) read_tvar(variable).value()(journal);
  const branch = or_else(read_tvar(variables[0]), read_tvar(variables[0]))
    .value();
  Deno.bench(`STM/isolated-one-edit-branch${size}`, () => {
    sink = branch(journal);
  });
}
for (
  const [name, variable] of [
    [
      "clone",
      new_tvar({ values: Array.from({ length: 1_000 }, (_, index) => index) }),
    ],
    [
      "immutable",
      new_immutable_tvar({
        values: Array.from({ length: 1_000 }, (_, index) => index),
      }),
    ],
  ] as const
) {
  const transaction = read_tvar(variable as TVar<{ values: number[] }>);
  Deno.bench({
    name: `STM/${name}-read1000`,
    group: "STM owned reads",
    fn() {
      sink = atomically(transaction);
    },
  });
}
void sink;

for (const size of [1_000, 10_000]) {
  Deno.bench(`Writer/direct-eager-array${size}`, () => {
    let value = tell(ArrayT<number>([]));
    for (let index = 0; index < size; index += 1) {
      value = value.bind(() => tell(ArrayT([index])));
    }
    sink = value.value();
  });
}

function* maybe_program8() {
  let value = 0;
  for (let index = 0; index < 8; index += 1) value = yield* Just(value + 1);
  return value;
}
function* either_program8() {
  let value = 0;
  for (let index = 0; index < 8; index += 1) {
    value = yield* Right<string, number>(value + 1);
  }
  return value;
}
Deno.bench({
  name: "Do/Maybe-general8",
  group: "Do Maybe8",
  baseline: true,
  fn() {
    sink = Do(maybe_program8).value();
  },
});
Deno.bench({
  name: "Do/Maybe-once8",
  group: "Do Maybe8",
  fn() {
    sink = Do_once(maybe_program8).value();
  },
});
Deno.bench({
  name: "Do/Either-general8",
  group: "Do Either8",
  baseline: true,
  fn() {
    sink = Do(either_program8).value();
  },
});
Deno.bench({
  name: "Do/Either-once8",
  group: "Do Either8",
  fn() {
    sink = Do_once(either_program8).value();
  },
});
