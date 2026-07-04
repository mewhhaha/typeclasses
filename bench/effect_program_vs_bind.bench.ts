import { Context, Effect as Fx, Ref } from "effect";
import * as FpRTE from "fp-ts/ReaderTaskEither";
import * as FpSRTE from "fp-ts/StateReaderTaskEither";
import { pipe as fp_pipe } from "fp-ts/function";

import {
  from_array as array_from_array,
  to_array as array_to_array,
} from "../src/array.ts";
import { Effect, Program } from "../src/effects.ts";
import { ask, run_reader } from "../src/reader.ts";
import { get, modify, run_state } from "../src/state.ts";
import { from_fn, run_task } from "../src/task.ts";
import { run_writer, tell } from "../src/writer.ts";

const iterations = 1_000;
let _sink = 0;

type EffectConfig = {
  readonly label: string;
  readonly increment: number;
};
type LabelConfig = {
  readonly label: string;
};
type ProgramResult = {
  readonly before: number;
  readonly after: number;
};
type FpState = {
  readonly value: number;
  readonly logs: readonly string[];
};

const config: EffectConfig = {
  label: "step",
  increment: 2,
};

class FxConfig extends Context.Tag("FxConfig")<FxConfig, EffectConfig>() {}
class FxLabelConfig
  extends Context.Tag("FxLabelConfig")<FxLabelConfig, LabelConfig>() {}
class FxState extends Context.Tag("FxState")<FxState, Ref.Ref<number>>() {}
class FxLogs extends Context.Tag("FxLogs")<FxLogs, Ref.Ref<string[]>>() {}

Deno.bench("effect Program construct+run", async () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume(await run_effect(make_program()));
  }

  _sink = checksum;
});

Deno.bench("effect bind construct+run", async () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume(await run_effect(make_bind_program()));
  }

  _sink = checksum;
});

Deno.bench("effect library gen construct+run", async () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume(await run_fx(make_fx_program()));
  }

  _sink = checksum;
});

Deno.bench("fp-ts StateReaderTaskEither construct+run", async () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume(await run_fp(make_fp_program()));
  }

  _sink = checksum;
});

Deno.bench("concrete monads manual run", async () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume(await run_concrete_manual());
  }

  _sink = checksum;
});

Deno.bench("raw manual run", async () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume(await run_raw());
  }

  _sink = checksum;
});

Deno.bench("effect Program reuse+run", async () => {
  const program = make_program();
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume(await run_effect(program));
  }

  _sink = checksum;
});

Deno.bench("effect bind reuse+run", async () => {
  const program = make_bind_program();
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume(await run_effect(program));
  }

  _sink = checksum;
});

Deno.bench("effect library gen reuse+run", async () => {
  const program = make_fx_program();
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume(await run_fx(program));
  }

  _sink = checksum;
});

Deno.bench("fp-ts StateReaderTaskEither reuse+run", async () => {
  const program = make_fp_program();
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    checksum += consume(await run_fp(program));
  }

  _sink = checksum;
});

function make_program_label() {
  return Program(function* () {
    const config = yield* ask<LabelConfig>();

    return config.label;
  });
}

function make_program_async_label() {
  const label_effect = make_program_label();

  return Program(function* () {
    const label = yield* label_effect;
    const suffix = yield* from_fn(() => Promise.resolve(":async"));

    return label + suffix;
  });
}

function make_program() {
  const label_effect = make_program_async_label();

  return Program(function* () {
    const config = yield* ask<EffectConfig>();
    const before = yield* get<number>();
    const label = yield* run_reader(label_effect, {
      label: config.label,
    });

    yield* modify((value: number) => value + config.increment);
    yield* tell(array_from_array([label + ":" + before.toString()]));

    const after = yield* get<number>();

    return { before, after };
  });
}

function make_bind_label() {
  return Effect.bind(Effect.lift(ask<LabelConfig>()), (config) => {
    return Effect.pure(config.label);
  });
}

function make_bind_async_label() {
  return Effect.bind(make_bind_label(), (label) => {
    return Effect.bind(Effect.lift(from_fn(() => Promise.resolve(":async"))), (
      suffix,
    ) => {
      return Effect.pure(label + suffix);
    });
  });
}

function make_bind_program() {
  const label_effect = make_bind_async_label();

  return Effect.bind(Effect.lift(ask<EffectConfig>()), (config) => {
    return Effect.bind(Effect.lift(get<number>()), (before) => {
      return Effect.bind(
        run_reader(label_effect, {
          label: config.label,
        }),
        (label) => {
          return Effect.bind(
            Effect.lift(modify((value: number) => value + config.increment)),
            () => {
              return Effect.bind(
                Effect.lift(
                  tell(array_from_array([label + ":" + before.toString()])),
                ),
                () => {
                  return Effect.bind(Effect.lift(get<number>()), (after) => {
                    return Effect.pure({ before, after });
                  });
                },
              );
            },
          );
        },
      );
    });
  });
}

function make_fx_label() {
  return Fx.gen(function* () {
    const config = yield* FxLabelConfig;

    return config.label;
  });
}

function make_fx_async_label() {
  const label_effect = make_fx_label();

  return Fx.gen(function* () {
    const label = yield* label_effect;
    const suffix = yield* Fx.promise(() => Promise.resolve(":async"));

    return label + suffix;
  });
}

function make_fx_program() {
  const label_effect = make_fx_async_label();

  return Fx.gen(function* () {
    const config = yield* FxConfig;
    const state = yield* FxState;
    const logs = yield* FxLogs;
    const before = yield* Ref.get(state);
    const label = yield* Fx.provideService(label_effect, FxLabelConfig, {
      label: config.label,
    });

    yield* Ref.update(state, (value) => value + config.increment);
    yield* Ref.update(logs, (items) => [
      ...items,
      label + ":" + before.toString(),
    ]);

    const after = yield* Ref.get(state);

    return { before, after };
  });
}

function make_fp_label() {
  return fp_pipe(
    FpRTE.ask<LabelConfig>(),
    FpRTE.chain((config) => {
      return FpRTE.fromTask(() => Promise.resolve(config.label + ":async"));
    }),
  );
}

function make_fp_program() {
  const label_effect = fp_pipe(
    make_fp_label(),
    FpRTE.local((config: EffectConfig): LabelConfig => {
      return { label: config.label };
    }),
  );

  return fp_pipe(
    FpSRTE.ask<FpState, EffectConfig, never>(),
    FpSRTE.chain((config) => {
      return fp_pipe(
        FpSRTE.get<FpState, EffectConfig, never>(),
        FpSRTE.chain((state) => {
          return fp_pipe(
            FpSRTE.fromReaderTaskEither<
              EffectConfig,
              never,
              string,
              FpState
            >(label_effect),
            FpSRTE.chain((label) => {
              return fp_pipe(
                FpSRTE.put<FpState, EffectConfig, never>({
                  value: state.value + config.increment,
                  logs: [
                    ...state.logs,
                    label + ":" + state.value.toString(),
                  ],
                }),
                FpSRTE.chain(() => {
                  return FpSRTE.gets<
                    FpState,
                    EffectConfig,
                    never,
                    ProgramResult
                  >((next) => {
                    return { before: state.value, after: next.value };
                  });
                }),
              );
            }),
          );
        }),
      );
    }),
  );
}

async function run_effect(program: ReturnType<typeof make_program>) {
  const [value, logs] = await Effect.handle_with(program, [
    (effect) => run_reader(effect, config),
    (effect) => run_state(effect, 40),
    (effect) => run_writer(effect, array_from_array<string>([])),
    run_task,
  ]);

  return [value, array_to_array(logs)] as const;
}

async function run_fx(program: ReturnType<typeof make_fx_program>) {
  return await Fx.runPromise(
    Fx.gen(function* () {
      const state = yield* Ref.make(40);
      const logs = yield* Ref.make<string[]>([]);
      const provided = Fx.provideService(
        Fx.provideService(
          Fx.provideService(
            Fx.provideService(program, FxConfig, config),
            FxState,
            state,
          ),
          FxLogs,
          logs,
        ),
        FxLabelConfig,
        { label: config.label },
      );
      const result = yield* provided;
      const next = yield* Ref.get(state);
      const written = yield* Ref.get(logs);

      return [[result, next], written] as const;
    }),
  );
}

async function run_fp(program: ReturnType<typeof make_fp_program>) {
  const result = await FpSRTE.run(program, {
    value: 40,
    logs: [],
  }, config);

  if (result._tag === "Left") {
    throw new Error("unexpected fp-ts failure");
  }

  const [value, state] = result.right;

  return [[value, state.value], state.logs] as const;
}

async function run_concrete_manual() {
  const app_config = ask<EffectConfig>().value()(config);
  let state = 40;

  const [before, before_state] = get<number>().value()(state);
  state = before_state;

  const label_config = ask<LabelConfig>().value()({
    label: app_config.label,
  });
  const suffix = await from_fn(() => Promise.resolve(":async")).value()();
  const label = label_config.label + suffix;

  const increment = modify((value: number) => value + app_config.increment);
  const [_modified, modified_state] = increment.value()(state);
  state = modified_state;

  const [_told, logs] = tell(
    array_from_array([label + ":" + before.toString()]),
  ).value();
  const [after, after_state] = get<number>().value()(state);

  return [[{ before, after }, after_state], array_to_array(logs)] as const;
}

async function run_raw() {
  const before = 40;
  const label = await Promise.resolve(config.label + ":async");
  const after = before + config.increment;

  return [[{ before, after }, after], [
    label + ":" + before.toString(),
  ]] as const;
}

function consume(
  result: readonly [readonly [ProgramResult, number], readonly string[]],
): number {
  const [[value, state], logs] = result;
  const [log = ""] = logs;

  return value.before + value.after + state + logs.length + log.length;
}
