import {
  from_array as array_from_array,
  to_array as array_to_array,
} from "../src/array.ts";
import { Effect, Program, run } from "../src/effects.ts";
import { Just, Maybe } from "../src/maybe.ts";
import { ask, asks, run_reader } from "../src/reader.ts";
import { get, modify, run_state } from "../src/state.ts";
import { from_fn, run_task } from "../src/task.ts";
import { Do } from "../src/typeclasses.ts";
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

Deno.bench("Maybe explicit-dictionary Do construct+run", () => {
  let checksum = 0;
  for (let index = 0; index < iterations; index += 1) {
    checksum += maybe_explicit_do().value()[1] as number;
  }
  _sink = checksum;
});

Deno.bench("Maybe explicit-dictionary transformed Do construct+run", () => {
  let checksum = 0;
  for (let index = 0; index < iterations; index += 1) {
    checksum += maybe_explicit_do_transformed().value()[1] as number;
  }
  _sink = checksum;
});

Deno.bench("Reader native happy path construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_reader(make_reader_native()(config));
  }

  _sink = checksum;
});

Deno.bench("Reader Do construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_reader(make_reader_do().value()(config));
  }

  _sink = checksum;
});

Deno.bench("Reader transformed Do construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_reader(make_reader_do_transformed().value()(config));
  }

  _sink = checksum;
});

Deno.bench("Reader Program construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_reader(
      run(run_reader(make_reader_program(), config)),
    );
  }

  _sink = checksum;
});

Deno.bench("Reader transformed Program construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_reader(
      run(run_reader(make_reader_program_transformed(), config)),
    );
  }

  _sink = checksum;
});

Deno.bench("Reader native happy path reuse+run", () => {
  const program = make_reader_native();
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_reader(program(config));
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

Deno.bench("Reader transformed Do reuse+run", () => {
  const program = make_reader_do_transformed();
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
    checksum += consume_reader(
      run(run_reader(program, config)),
    );
  }

  _sink = checksum;
});

Deno.bench("Reader transformed Program reuse+run", () => {
  const program = make_reader_program_transformed();
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_reader(
      run(run_reader(program, config)),
    );
  }

  _sink = checksum;
});

Deno.bench("State native happy path construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_state(make_state_native()(40));
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

Deno.bench("State transformed Do construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_state(make_state_do_transformed().value()(40));
  }

  _sink = checksum;
});

Deno.bench("State Program construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_state(
      run(run_state(make_state_program(), 40)),
    );
  }

  _sink = checksum;
});

Deno.bench("State transformed Program construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_state(
      run(run_state(make_state_program_transformed(), 40)),
    );
  }

  _sink = checksum;
});

Deno.bench("State native happy path reuse+run", () => {
  const program = make_state_native();
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_state(program(40));
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

Deno.bench("State transformed Do reuse+run", () => {
  const program = make_state_do_transformed();
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
    checksum += consume_state(
      run(run_state(program, 40)),
    );
  }

  _sink = checksum;
});

Deno.bench("State transformed Program reuse+run", () => {
  const program = make_state_program_transformed();
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_state(
      run(run_state(program, 40)),
    );
  }

  _sink = checksum;
});

Deno.bench("Writer native happy path construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_native_writer(make_writer_native()());
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

Deno.bench("Writer transformed Do construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_writer(make_writer_do_transformed().value());
  }

  _sink = checksum;
});

Deno.bench("Writer Program construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_writer(
      run(run_writer(make_writer_program(), array_from_array<string>([]))),
    );
  }

  _sink = checksum;
});

Deno.bench("Writer transformed Program construct+run", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_writer(
      run(
        run_writer(
          make_writer_program_transformed(),
          array_from_array<string>([]),
        ),
      ),
    );
  }

  _sink = checksum;
});

Deno.bench("Writer native happy path reuse+run", () => {
  const program = make_writer_native();
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_native_writer(program());
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

Deno.bench("Writer transformed Do reuse+run", () => {
  const program = make_writer_do_transformed();
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
      run(run_writer(program, array_from_array<string>([]))),
    );
  }

  _sink = checksum;
});

Deno.bench("Writer transformed Program reuse+run", () => {
  const program = make_writer_program_transformed();
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_writer(
      run(run_writer(program, array_from_array<string>([]))),
    );
  }

  _sink = checksum;
});

Deno.bench("Task native happy path construct+run", async () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_task(await make_task_native()());
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

Deno.bench("Task transformed Do construct+run", async () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_task(await make_task_do_transformed().value()());
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

Deno.bench("Task transformed Program construct+run", async () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_task(await run_task(make_task_program_transformed()));
  }

  _sink = checksum;
});

Deno.bench("Task native happy path reuse+run", async () => {
  const program = make_task_native();
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_task(await program());
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

Deno.bench("Task transformed Do reuse+run", async () => {
  const program = make_task_do_transformed();
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

Deno.bench("Task transformed Program reuse+run", async () => {
  const program = make_task_program_transformed();
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume_task(await run_task(program));
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

function maybe_explicit_do() {
  return Do(Maybe, function* () {
    const value = yield* Just(40);
    return value + 2;
  });
}

function maybe_explicit_do_transformed() {
  return Just(40).map((value) => value + 2);
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

function make_writer_native() {
  return (): readonly [number, readonly string[]] => {
    const logs = ["start"];
    const value = 40;

    logs.push("value");
    logs.push("end");

    return [value + 2, logs];
  };
}

function make_writer_do() {
  return Do(function* () {
    yield* tell(array_from_array(["start"]));
    const value = yield* writer(40, array_from_array(["value"]));
    yield* tell(array_from_array(["end"]));

    return value + 2;
  });
}

function make_writer_do_transformed() {
  return tell(array_from_array(["start"])).bind(() => {
    return writer(40, array_from_array(["value"])).bind((value) => {
      return tell(array_from_array(["end"])).map(() => {
        return value + 2;
      });
    });
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

function make_writer_program_transformed() {
  return Effect.bind_from(tell(array_from_array(["start"])), () => {
    return Effect.bind_from(
      writer(40, array_from_array(["value"])),
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

function make_task_native() {
  return async () => {
    const left = await Promise.resolve(40);
    const right = await Promise.resolve(2);

    return left + right;
  };
}

function make_task_do() {
  return Do(function* () {
    const left = yield* from_fn(() => Promise.resolve(40));
    const right = yield* from_fn(() => Promise.resolve(2));

    return left + right;
  });
}

function make_task_do_transformed() {
  return from_fn(() => Promise.resolve(40)).bind((left) => {
    return from_fn(() => Promise.resolve(2)).map((right) => {
      return left + right;
    });
  });
}

function make_task_program() {
  return Program(function* () {
    const left = yield* from_fn(() => Promise.resolve(40));
    const right = yield* from_fn(() => Promise.resolve(2));

    return left + right;
  });
}

function make_task_program_transformed() {
  return Effect.bind_from(
    from_fn(() => Promise.resolve(40)),
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
