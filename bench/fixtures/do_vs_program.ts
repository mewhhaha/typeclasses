import { ArrayT, from_array as array_from_array } from "../../src/array.ts";
import { Either, Left } from "../../src/either.ts";
import { Program, run } from "../../src/effects.ts";
import { Just, Maybe, Nothing } from "../../src/maybe.ts";
import { ask, asks, run_reader } from "../../src/reader.ts";
import { get, modify, run_state } from "../../src/state.ts";
import { from_fn, run_task } from "../../src/task.ts";
import { Do } from "../../src/typeclasses.ts";
import { run_writer, tell, writer } from "../../src/writer.ts";

export type Config = { readonly label: string; readonly increment: number };

export function make_reader_do() {
  return Do(function* () {
    const config = yield* ask<Config>();
    const label = yield* asks<Config, string>((config) => config.label);

    return label.length + config.increment;
  });
}

export function maybe_explicit_do(value: number) {
  return Do(Maybe, function* () {
    const input = yield* Just(value);
    return input + 2;
  });
}

export function make_reader_program() {
  return Program(function* () {
    const config = yield* ask<Config>();
    const label = yield* asks<Config, string>((config) => config.label);

    return label.length + config.increment;
  });
}

export function make_state_do() {
  return Do(function* () {
    const before = yield* get<number>();

    yield* modify((value: number) => value + 2);

    const after = yield* get<number>();

    return { before, after };
  });
}

export function make_state_program() {
  return Program(function* () {
    const before = yield* get<number>();

    yield* modify((value: number) => value + 2);

    const after = yield* get<number>();

    return { before, after };
  });
}

export function make_writer_do(input: number) {
  return Do(function* () {
    yield* tell(array_from_array(["start"]));
    const value = yield* writer(input, array_from_array(["value"]));
    yield* tell(array_from_array(["end"]));

    return value + 2;
  });
}

export function make_writer_program(input: number) {
  return Program(function* () {
    yield* tell(array_from_array(["start"]));
    const value = yield* writer(input, array_from_array(["value"]));
    yield* tell(array_from_array(["end"]));

    return value + 2;
  });
}

export function make_task_do(value: number) {
  return Do(function* () {
    const left = yield* from_fn(() => Promise.resolve(value));
    const right = yield* from_fn(() => Promise.resolve(2));

    return left + right;
  });
}

export function make_task_program(value: number) {
  return Program(function* () {
    const left = yield* from_fn(() => Promise.resolve(value));
    const right = yield* from_fn(() => Promise.resolve(2));

    return left + right;
  });
}

export function run_reader_program_fused(input: () => Config): number {
  return run(run_reader(
    Program(function* () {
      const config = yield* ask<Config>();
      const label = yield* asks<Config, string>((config) => config.label);
      return label.length + config.increment;
    }),
    input(),
  ));
}

export function run_state_program_fused(input: () => number) {
  return run(run_state(
    Program(function* () {
      const before = yield* get<number>();
      yield* modify((value: number) => value + 2);
      const after = yield* get<number>();
      return { before, after };
    }),
    input(),
  ));
}

export function run_writer_program_fused(
  input: () => number,
  writer_input: () => ReturnType<typeof array_from_array<string>>,
) {
  return run(run_writer(
    Program(function* () {
      yield* tell(array_from_array(["start"]));
      const value = yield* writer(input(), array_from_array(["value"]));
      yield* tell(array_from_array(["end"]));
      return value + 2;
    }),
    writer_input(),
  ));
}

export async function observe(input: number, config: Config) {
  const empty = () => array_from_array<string>([]);
  const writer_do = make_writer_do(input).value();
  const writer_program = run(run_writer(make_writer_program(input), empty()));
  const writer_fused = run_writer_program_fused(() => input, empty);
  const events: string[] = [];
  const branches = Do(ArrayT, function* () {
    let offset = 0;
    offset += 1;
    const left = yield* ArrayT([input, input + 1]);
    const right = yield* ArrayT([left, left + 10]);
    let total = left + right + offset;
    total += 1;
    events.push("branch:" + total);
    return total;
  });
  const absent = Do(Maybe, function* () {
    const item = yield* Nothing<number>();
    events.push("unreachable maybe");
    return item;
  });
  const failed = Do(Either.with_left<string>(), function* () {
    const item = yield* Left<string, number>("domain failure");
    events.push("unreachable either");
    return item;
  });
  const task = Do(function* () {
    const item = yield* from_fn(() => {
      events.push("task.start");
      return Promise.resolve(input);
    });
    const next = yield* from_fn(() => {
      events.push("task.fail:" + item);
      return Promise.reject<number>(new Error("task failure"));
    });
    events.push("unreachable task");
    return next;
  });
  const failure = await observe_failure(() => task.run());
  const repeated_failure = await observe_failure(() => task.run());
  const effect = Program(function* () {
    const item = yield* from_fn(() => {
      events.push("program.start");
      return Promise.resolve(input);
    });
    events.push("program.finish");
    return item + 1;
  });
  const program_runs = [await run_task(effect), await run_task(effect)];
  return {
    maybe: maybe_explicit_do(input).value(),
    reader_do: make_reader_do().value()(config),
    reader_program: run(run_reader(make_reader_program(), config)),
    reader_fused: run_reader_program_fused(() => config),
    state_do: make_state_do().value()(input),
    state_program: run(run_state(make_state_program(), input)),
    state_fused: run_state_program_fused(() => input),
    writer_do: [writer_do[0], writer_do[1].value()],
    writer_program: [writer_program[0], writer_program[1].value()],
    writer_fused: [writer_fused[0], writer_fused[1].value()],
    task_do: await make_task_do(input).run(),
    task_program: await run_task(make_task_program(input)),
    absent: absent.value(),
    failed: failed.value(),
    failure,
    repeated_failure,
    program_runs,
    branches: branches.value(),
    events,
  };
}

async function observe_failure(run: () => Promise<unknown>) {
  try {
    return { value: await run() };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return { error: { name: error.name, message: error.message } };
  }
}
