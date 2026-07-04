import {
  from_array as array_from_array,
  to_array as array_to_array,
} from "../src/array.ts";
import { Effect, Program } from "../src/effects.ts";
import { ask, asks, run_reader } from "../src/reader.ts";
import { get, modify, run_state } from "../src/state.ts";
import { from_fn, run_task } from "../src/task.ts";
import { Do } from "../src/traits.ts";
import { run_writer, tell, writer } from "../src/writer.ts";

const iterations = 10_000;
let _sink = 0;

type Config = {
  readonly label: string;
  readonly increment: number;
};

const config: Config = {
  label: "step",
  increment: 2,
};

Deno.bench("Reader Do construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_reader(make_reader_do().value()(config));
  }

  _sink = checksum;
});

Deno.bench("Reader Program construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_reader(
      Effect.run(run_reader(make_reader_program(), config)),
    );
  }

  _sink = checksum;
});

Deno.bench("Reader Do reuse+run", () => {
  const program = make_reader_do();
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_reader(program.value()(config));
  }

  _sink = checksum;
});

Deno.bench("Reader Program reuse+run", () => {
  const program = make_reader_program();
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_reader(Effect.run(run_reader(program, config)));
  }

  _sink = checksum;
});

Deno.bench("State Do construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_state(make_state_do().value()(40));
  }

  _sink = checksum;
});

Deno.bench("State Program construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_state(Effect.run(run_state(make_state_program(), 40)));
  }

  _sink = checksum;
});

Deno.bench("State Do reuse+run", () => {
  const program = make_state_do();
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_state(program.value()(40));
  }

  _sink = checksum;
});

Deno.bench("State Program reuse+run", () => {
  const program = make_state_program();
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_state(Effect.run(run_state(program, 40)));
  }

  _sink = checksum;
});

Deno.bench("Writer Do construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_writer(make_writer_do().value());
  }

  _sink = checksum;
});

Deno.bench("Writer Program construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_writer(
      Effect.run(
        run_writer(make_writer_program(), array_from_array<string>([])),
      ),
    );
  }

  _sink = checksum;
});

Deno.bench("Writer Do reuse+run", () => {
  const program = make_writer_do();
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_writer(program.value());
  }

  _sink = checksum;
});

Deno.bench("Writer Program reuse+run", () => {
  const program = make_writer_program();
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_writer(
      Effect.run(run_writer(program, array_from_array<string>([]))),
    );
  }

  _sink = checksum;
});

Deno.bench("Task Do construct+run", async () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_task(await make_task_do().value()());
  }

  _sink = checksum;
});

Deno.bench("Task Program construct+run", async () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_task(await run_task(make_task_program()));
  }

  _sink = checksum;
});

Deno.bench("Task Do reuse+run", async () => {
  const program = make_task_do();
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_task(await program.value()());
  }

  _sink = checksum;
});

Deno.bench("Task Program reuse+run", async () => {
  const program = make_task_program();
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_task(await run_task(program));
  }

  _sink = checksum;
});

function make_reader_do() {
  return Do(function* () {
    const config = yield* ask<Config>();
    const label = yield* asks<Config, string>((config) => config.label);

    return label.length + config.increment;
  });
}

function make_reader_program() {
  return Program(function* () {
    const config = yield* ask<Config>();
    const label = yield* asks<Config, string>((config) => config.label);

    return label.length + config.increment;
  });
}

function make_state_do() {
  return Do(function* () {
    const before = yield* get<number>();

    yield* modify((value: number) => value + 2);

    const after = yield* get<number>();

    return { before, after };
  });
}

function make_state_program() {
  return Program(function* () {
    const before = yield* get<number>();

    yield* modify((value: number) => value + 2);

    const after = yield* get<number>();

    return { before, after };
  });
}

function make_writer_do() {
  return Do(function* () {
    yield* tell(array_from_array(["start"]));
    const value = yield* writer(40, array_from_array(["value"]));
    yield* tell(array_from_array(["end"]));

    return value + 2;
  });
}

function make_writer_program() {
  return Program(function* () {
    yield* tell(array_from_array(["start"]));
    const value = yield* writer(40, array_from_array(["value"]));
    yield* tell(array_from_array(["end"]));

    return value + 2;
  });
}

function make_task_do() {
  return Do(function* () {
    const left = yield* from_fn(() => Promise.resolve(40));
    const right = yield* from_fn(() => Promise.resolve(2));

    return left + right;
  });
}

function make_task_program() {
  return Program(function* () {
    const left = yield* from_fn(() => Promise.resolve(40));
    const right = yield* from_fn(() => Promise.resolve(2));

    return left + right;
  });
}

function consume_reader(value: number): number {
  return value;
}

function consume_state(
  result: readonly [
    { readonly before: number; readonly after: number },
    number,
  ],
): number {
  const [value, state] = result;

  return value.before + value.after + state;
}

function consume_writer(
  result: readonly [number, unknown],
): number {
  const [value, logs] = result;

  return value +
    array_to_array(logs as ReturnType<typeof array_from_array<string>>).length;
}

function consume_task(value: number): number {
  return value;
}
