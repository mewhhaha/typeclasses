import {
  from_array as array_from_array,
  to_array as array_to_array,
} from "../src/array.ts";
import { Effect, Program, run } from "../src/effects.ts";
import { Just, Maybe } from "../src/maybe.ts";
import { ask, asks, run_reader, run_reader_terminal } from "../src/reader.ts";
import { get, modify, run_state, run_state_terminal } from "../src/state.ts";
import { from_fn, run_task } from "../src/task.ts";
import { Do } from "../src/typeclasses.ts";
import {
  run_writer,
  run_writer_terminal,
  tell,
  writer,
} from "../src/writer.ts";

const iterations = 10_000;
const input_count = 1024;
let _sink = 0;

type Config = {
  readonly label: string;
  readonly increment: number;
};

// Vary every hot-loop input so V8 cannot fold the native baselines to a
// constant checksum. Reuse pools are built outside timed benchmark callbacks.
const configs = Array.from({ length: input_count }, (_, index): Config => ({
  label: `step-${index}`,
  increment: 2 + index % 5,
}));
const numbers = Array.from(
  { length: input_count },
  (_, index) => 40 + index % 17,
);
const native_writer_programs = numbers.map(make_writer_native);
const do_writer_programs = numbers.map(make_writer_do);
const transformed_do_writer_programs = numbers.map(
  make_writer_do_transformed,
);
const program_writer_programs = numbers.map(make_writer_program);
const transformed_program_writer_programs = numbers.map(
  make_writer_program_transformed,
);
const native_task_programs = numbers.map(make_task_native);
const do_task_programs = numbers.map(make_task_do);
const transformed_do_task_programs = numbers.map(make_task_do_transformed);
const program_task_programs = numbers.map(make_task_program);
const transformed_program_task_programs = numbers.map(
  make_task_program_transformed,
);

function input_at<T>(inputs: readonly T[], index: number): T {
  return inputs[index % inputs.length];
}

Deno.bench("Maybe explicit-dictionary Do construct+run", () => {
  let checksum = 0;
  for (let index = 0; index < iterations; index += 1) {
    checksum += maybe_explicit_do(input_at(numbers, index))
      .value()[1] as number;
  }
  _sink = checksum;
});

Deno.bench("Maybe explicit-dictionary transformed Do construct+run", () => {
  let checksum = 0;
  for (let index = 0; index < iterations; index += 1) {
    checksum += maybe_explicit_do_transformed(input_at(numbers, index))
      .value()[1] as number;
  }
  _sink = checksum;
});

Deno.bench("Reader native happy path construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_reader(make_reader_native()(input_at(configs, index)));
  }

  _sink = checksum;
});

Deno.bench("Reader Do construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_reader(
      make_reader_do().value()(input_at(configs, index)),
    );
  }

  _sink = checksum;
});

Deno.bench("Reader transformed Do construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_reader(
      make_reader_do_transformed().value()(input_at(configs, index)),
    );
  }

  _sink = checksum;
});

Deno.bench("Reader Program construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_reader(
      run(run_reader(make_reader_program(), input_at(configs, index))),
    );
  }

  _sink = checksum;
});

Deno.bench("Reader transformed Program composable construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_reader(
      run(
        run_reader(
          make_reader_program_transformed(),
          input_at(configs, index),
        ),
      ),
    );
  }

  _sink = checksum;
});

Deno.bench("Reader transformed Program terminal construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_reader(
      run_reader_terminal(
        make_reader_program_transformed(),
        input_at(configs, index),
      ),
    );
  }

  _sink = checksum;
});

Deno.bench("Reader native happy path reuse+run", () => {
  const program = make_reader_native();
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_reader(program(input_at(configs, index)));
  }

  _sink = checksum;
});

Deno.bench("Reader Do reuse+run", () => {
  const program = make_reader_do();
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_reader(program.value()(input_at(configs, index)));
  }

  _sink = checksum;
});

Deno.bench("Reader transformed Do reuse+run", () => {
  const program = make_reader_do_transformed();
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_reader(program.value()(input_at(configs, index)));
  }

  _sink = checksum;
});

Deno.bench("Reader Program reuse+run", () => {
  const program = make_reader_program();
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_reader(
      run(run_reader(program, input_at(configs, index))),
    );
  }

  _sink = checksum;
});

Deno.bench("Reader transformed Program composable reuse+run", () => {
  const program = make_reader_program_transformed();
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_reader(
      run(run_reader(program, input_at(configs, index))),
    );
  }

  _sink = checksum;
});

Deno.bench("Reader transformed Program terminal reuse+run", () => {
  const program = make_reader_program_transformed();
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_reader(
      run_reader_terminal(program, input_at(configs, index)),
    );
  }

  _sink = checksum;
});

Deno.bench("State native happy path construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_state(make_state_native()(input_at(numbers, index)));
  }

  _sink = checksum;
});

Deno.bench("State Do construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_state(
      make_state_do().value()(input_at(numbers, index)),
    );
  }

  _sink = checksum;
});

Deno.bench("State transformed Do construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_state(
      make_state_do_transformed().value()(input_at(numbers, index)),
    );
  }

  _sink = checksum;
});

Deno.bench("State Program construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_state(
      run(run_state(make_state_program(), input_at(numbers, index))),
    );
  }

  _sink = checksum;
});

Deno.bench("State transformed Program composable construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_state(
      run(
        run_state(
          make_state_program_transformed(),
          input_at(numbers, index),
        ),
      ),
    );
  }

  _sink = checksum;
});

Deno.bench("State transformed Program terminal construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_state(
      run_state_terminal(
        make_state_program_transformed(),
        input_at(numbers, index),
      ),
    );
  }

  _sink = checksum;
});

Deno.bench("State native happy path reuse+run", () => {
  const program = make_state_native();
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_state(program(input_at(numbers, index)));
  }

  _sink = checksum;
});

Deno.bench("State Do reuse+run", () => {
  const program = make_state_do();
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_state(program.value()(input_at(numbers, index)));
  }

  _sink = checksum;
});

Deno.bench("State transformed Do reuse+run", () => {
  const program = make_state_do_transformed();
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_state(program.value()(input_at(numbers, index)));
  }

  _sink = checksum;
});

Deno.bench("State Program reuse+run", () => {
  const program = make_state_program();
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_state(
      run(run_state(program, input_at(numbers, index))),
    );
  }

  _sink = checksum;
});

Deno.bench("State transformed Program composable reuse+run", () => {
  const program = make_state_program_transformed();
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_state(
      run(run_state(program, input_at(numbers, index))),
    );
  }

  _sink = checksum;
});

Deno.bench("State transformed Program terminal reuse+run", () => {
  const program = make_state_program_transformed();
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_state(
      run_state_terminal(program, input_at(numbers, index)),
    );
  }

  _sink = checksum;
});

Deno.bench("Writer native happy path construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_native_writer(
      make_writer_native(input_at(numbers, index))(),
    );
  }

  _sink = checksum;
});

Deno.bench("Writer Do construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_writer(
      make_writer_do(input_at(numbers, index)).value(),
    );
  }

  _sink = checksum;
});

Deno.bench("Writer transformed Do construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_writer(
      make_writer_do_transformed(input_at(numbers, index)).value(),
    );
  }

  _sink = checksum;
});

Deno.bench("Writer Program construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_writer(
      run(
        run_writer(
          make_writer_program(input_at(numbers, index)),
          array_from_array<string>([]),
        ),
      ),
    );
  }

  _sink = checksum;
});

Deno.bench("Writer transformed Program composable construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_writer(
      run(
        run_writer(
          make_writer_program_transformed(input_at(numbers, index)),
          array_from_array<string>([]),
        ),
      ),
    );
  }

  _sink = checksum;
});

Deno.bench("Writer transformed Program terminal construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_writer(
      run_writer_terminal(
        make_writer_program_transformed(input_at(numbers, index)),
        array_from_array<string>([]),
      ),
    );
  }

  _sink = checksum;
});

Deno.bench("Writer native happy path reuse+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_native_writer(
      input_at(native_writer_programs, index)(),
    );
  }

  _sink = checksum;
});

Deno.bench("Writer Do reuse+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_writer(input_at(do_writer_programs, index).value());
  }

  _sink = checksum;
});

Deno.bench("Writer transformed Do reuse+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_writer(
      input_at(transformed_do_writer_programs, index).value(),
    );
  }

  _sink = checksum;
});

Deno.bench("Writer Program reuse+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_writer(
      run(
        run_writer(
          input_at(program_writer_programs, index),
          array_from_array<string>([]),
        ),
      ),
    );
  }

  _sink = checksum;
});

Deno.bench("Writer transformed Program composable reuse+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_writer(
      run(
        run_writer(
          input_at(transformed_program_writer_programs, index),
          array_from_array<string>([]),
        ),
      ),
    );
  }

  _sink = checksum;
});

Deno.bench("Writer transformed Program terminal reuse+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_writer(
      run_writer_terminal(
        input_at(transformed_program_writer_programs, index),
        array_from_array<string>([]),
      ),
    );
  }

  _sink = checksum;
});

Deno.bench("Task native happy path construct+run", async () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_task(
      await make_task_native(input_at(numbers, index))(),
    );
  }

  _sink = checksum;
});

Deno.bench("Task Do construct+run", async () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_task(
      await make_task_do(input_at(numbers, index)).value()(),
    );
  }

  _sink = checksum;
});

Deno.bench("Task transformed Do construct+run", async () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_task(
      await make_task_do_transformed(input_at(numbers, index)).value()(),
    );
  }

  _sink = checksum;
});

Deno.bench("Task Program construct+run", async () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_task(
      await run_task(make_task_program(input_at(numbers, index))),
    );
  }

  _sink = checksum;
});

Deno.bench("Task transformed Program construct+run", async () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_task(
      await run_task(make_task_program_transformed(input_at(numbers, index))),
    );
  }

  _sink = checksum;
});

Deno.bench("Task native happy path reuse+run", async () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_task(await input_at(native_task_programs, index)());
  }

  _sink = checksum;
});

Deno.bench("Task Do reuse+run", async () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_task(await input_at(do_task_programs, index).value()());
  }

  _sink = checksum;
});

Deno.bench("Task transformed Do reuse+run", async () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_task(
      await input_at(transformed_do_task_programs, index).value()(),
    );
  }

  _sink = checksum;
});

Deno.bench("Task Program reuse+run", async () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_task(
      await run_task(input_at(program_task_programs, index)),
    );
  }

  _sink = checksum;
});

Deno.bench("Task transformed Program reuse+run", async () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_task(
      await run_task(input_at(transformed_program_task_programs, index)),
    );
  }

  _sink = checksum;
});

function make_reader_native() {
  return (config: Config) => {
    const label = config.label;

    return label.length + config.increment;
  };
}

function make_reader_do() {
  return Do(function* () {
    const config = yield* ask<Config>();
    const label = yield* asks<Config, string>((config) => config.label);

    return label.length + config.increment;
  });
}

function maybe_explicit_do(value: number) {
  return Do(Maybe, function* () {
    const input = yield* Just(value);
    return input + 2;
  });
}

function maybe_explicit_do_transformed(value: number) {
  return Just(value).map((input) => input + 2);
}

function make_reader_do_transformed() {
  return ask<Config>().bind((config) => {
    return asks<Config, string>((config) => config.label).map((label) => {
      return label.length + config.increment;
    });
  });
}

function make_reader_program() {
  return Program(function* () {
    const config = yield* ask<Config>();
    const label = yield* asks<Config, string>((config) => config.label);

    return label.length + config.increment;
  });
}

function make_reader_program_transformed() {
  return Effect.bind_from(ask<Config>(), (config) => {
    return Effect.map_from(
      asks<Config, string>((config) => config.label),
      (label) => {
        return label.length + config.increment;
      },
    );
  });
}

function make_state_native() {
  return (
    state: number,
  ): readonly [
    { readonly before: number; readonly after: number },
    number,
  ] => {
    const before = state;
    const after_state = state + 2;
    const after = after_state;

    return [{ before, after }, after_state];
  };
}

function make_state_do() {
  return Do(function* () {
    const before = yield* get<number>();

    yield* modify((value: number) => value + 2);

    const after = yield* get<number>();

    return { before, after };
  });
}

function make_state_do_transformed() {
  return get<number>().bind((before) => {
    return modify((value: number) => value + 2).bind(() => {
      return get<number>().map((after) => {
        return { before, after };
      });
    });
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

function make_state_program_transformed() {
  return Effect.bind_from(get<number>(), (before) => {
    return Effect.bind_from(
      modify((value: number) => value + 2),
      () => {
        return Effect.map_from(get<number>(), (after) => {
          return { before, after };
        });
      },
    );
  });
}

function make_writer_native(value: number) {
  return (): readonly [number, readonly string[]] => {
    const logs = ["start"];
    logs.push("value");
    logs.push("end");

    return [value + 2, logs];
  };
}

function make_writer_do(input: number) {
  return Do(function* () {
    yield* tell(array_from_array(["start"]));
    const value = yield* writer(input, array_from_array(["value"]));
    yield* tell(array_from_array(["end"]));

    return value + 2;
  });
}

function make_writer_do_transformed(value: number) {
  return tell(array_from_array(["start"])).bind(() => {
    return writer(value, array_from_array(["value"])).bind((value) => {
      return tell(array_from_array(["end"])).map(() => {
        return value + 2;
      });
    });
  });
}

function make_writer_program(input: number) {
  return Program(function* () {
    yield* tell(array_from_array(["start"]));
    const value = yield* writer(input, array_from_array(["value"]));
    yield* tell(array_from_array(["end"]));

    return value + 2;
  });
}

function make_writer_program_transformed(value: number) {
  return Effect.bind_from(tell(array_from_array(["start"])), () => {
    return Effect.bind_from(
      writer(value, array_from_array(["value"])),
      (value) => {
        return Effect.map_from(
          tell(array_from_array(["end"])),
          () => {
            return value + 2;
          },
        );
      },
    );
  });
}

function make_task_native(value: number) {
  return async () => {
    const left = await Promise.resolve(value);
    const right = await Promise.resolve(2);

    return left + right;
  };
}

function make_task_do(value: number) {
  return Do(function* () {
    const left = yield* from_fn(() => Promise.resolve(value));
    const right = yield* from_fn(() => Promise.resolve(2));

    return left + right;
  });
}

function make_task_do_transformed(value: number) {
  return from_fn(() => Promise.resolve(value)).bind((left) => {
    return from_fn(() => Promise.resolve(2)).map((right) => {
      return left + right;
    });
  });
}

function make_task_program(value: number) {
  return Program(function* () {
    const left = yield* from_fn(() => Promise.resolve(value));
    const right = yield* from_fn(() => Promise.resolve(2));

    return left + right;
  });
}

function make_task_program_transformed(value: number) {
  return Effect.bind_from(
    from_fn(() => Promise.resolve(value)),
    (left) => {
      return Effect.map_from(
        from_fn(() => Promise.resolve(2)),
        (right) => {
          return left + right;
        },
      );
    },
  );
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

function consume_native_writer(
  result: readonly [number, readonly string[]],
): number {
  const [value, logs] = result;

  return value + logs.length;
}

function consume_task(value: number): number {
  return value;
}
