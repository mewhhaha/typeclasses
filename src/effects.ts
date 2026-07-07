import {
  type Data,
  type Dictionary,
  type DictionaryDataType,
  is_data,
  kind,
} from "./typeclass.ts";

declare const operation_output: unique symbol;

export type Operation<item> = {
  readonly [operation_output]?: item;
};

type OperationOutput<operation> = operation extends Operation<infer item> ? item
  : never;

export type TaggedOperation<tag extends string = string> =
  | readonly [tag]
  | readonly [tag, unknown];

export type Lift<dictionary extends Dictionary, item> =
  & Operation<item>
  & readonly ["lift", Data<dictionary, item>];

export type Uses<dictionary extends Dictionary, item = unknown> = Lift<
  dictionary,
  item
>;

type Pure<item> = {
  readonly 0: "pure";
  readonly 1: item;
};

type Impure<requirements, item> = {
  readonly 0: "impure";
  readonly 1: requirements;
  readonly 2: (value: unknown) => Effect<requirements, item>;
};

type EffectBase<requirements, item> = {
  [Symbol.iterator](): Generator<Effect<requirements, item>, item, unknown>;
};

export type Effect<requirements, item> =
  & EffectBase<requirements, item>
  & (
    | Pure<item>
    | Impure<requirements, item>
  );

export type EffectHandler<
  requirements,
  item,
  next_requirements,
  next_item,
> = (
  effect: Effect<requirements, item>,
) => Effect<next_requirements, next_item>;

export type EffectRunner<requirements, item, out> = (
  effect: Effect<requirements, item>,
) => out;

export type EffectInterpreter<requirements, item> = {
  handle<next_requirements, next_item>(
    handler: EffectHandler<requirements, item, next_requirements, next_item>,
  ): EffectInterpreter<next_requirements, next_item>;

  run<out>(runner: EffectRunner<requirements, item, out>): out;

  value(): Effect<requirements, item>;
};

type EffectRequirements<value> = value extends Effect<
  infer requirements,
  infer _item
> ? requirements
  : value extends Data<infer dictionary extends Dictionary, infer item>
    ? Lift<dictionary, item>
  : never;

type ScopedYield<requirements, yielded> =
  Exclude<EffectRequirements<yielded>, requirements> extends never ? yielded
    : never;

export type ProgramScope<requirements> = {
  <yielded, item>(
    run: () => Generator<ScopedYield<requirements, yielded>, item, unknown>,
  ): Effect<EffectRequirements<yielded>, item>;
};

export type ProgramConstructor =
  & ProgramScope<unknown>
  & {
    scope<requirements>(): ProgramScope<requirements>;
  };

export type WithoutLift<
  requirements,
  dictionary extends Dictionary,
> = requirements extends Lift<infer lifted, infer _item>
  ? DictionaryDataType<lifted> extends DictionaryDataType<dictionary> ? never
  : requirements
  : requirements;

export type LiftHandler<
  dictionary extends Dictionary,
  state,
  item,
  out,
> = {
  done(value: item, state: state): out;
  handle(
    value: Data<dictionary, unknown>,
    state: state,
  ): readonly [unknown, state];
};

type ProgramPath = {
  readonly previous: ProgramPath | undefined;
  readonly value: unknown;
  readonly length: number;
};

const EffectPrototype: EffectBase<unknown, unknown> = {
  [Symbol.iterator]: effect_iterator,
};

const EffectInterpreterPrototype = {
  handle(
    this: EffectInterpreterTarget<unknown, unknown>,
    handler: EffectHandler<unknown, unknown, unknown, unknown>,
  ): EffectInterpreter<unknown, unknown> {
    return interpret(handler(this.effect));
  },

  run<out>(
    this: EffectInterpreterTarget<unknown, unknown>,
    runner: EffectRunner<unknown, unknown, out>,
  ): out {
    return runner(this.effect);
  },

  value(
    this: EffectInterpreterTarget<unknown, unknown>,
  ): Effect<unknown, unknown> {
    return this.effect;
  },
};

type EffectInterpreterTarget<requirements, item> = {
  readonly effect: Effect<requirements, item>;
};

export const Program = Object.assign(program, {
  scope,
}) as ProgramConstructor;

export const Effect = {
  pure,
  from,
  lift,
  send,
  suspend,
  map,
  bind,
  handle_with,
  interpret,
};

export function pure<item>(value: item): Effect<never, item> {
  return Object.assign(Object.create(EffectPrototype), {
    0: "pure",
    1: value,
  }) as Effect<never, item>;
}

export function from<requirements, item>(
  value: Effect<requirements, item>,
): Effect<requirements, item>;
export function from<dictionary extends Dictionary, item>(
  value: Data<dictionary, item>,
): Effect<Lift<dictionary, item>, item>;
export function from(value: unknown): Effect<unknown, unknown> {
  return as_effect(value);
}

export function lift<dictionary extends Dictionary, item>(
  value: Data<dictionary, item>,
): Effect<Lift<dictionary, item>, item> {
  return suspend(
    ["lift", value] as Lift<dictionary, item>,
    resume_pure,
  ) as Effect<Lift<dictionary, item>, item>;
}

export function send<operation extends TaggedOperation & Operation<unknown>>(
  operation: operation,
): Effect<operation, OperationOutput<operation>> {
  return suspend(operation, resume_pure) as Effect<
    operation,
    OperationOutput<operation>
  >;
}

export function suspend<requirements, item>(
  operation: requirements,
  resume: (value: unknown) => Effect<requirements, item>,
): Effect<requirements, item> {
  return Object.assign(Object.create(EffectPrototype), {
    0: "impure",
    1: operation,
    2: resume,
  }) as Effect<requirements, item>;
}

export function map<requirements, from, to>(
  effect: Effect<requirements, from>,
  fn: (value: from) => to,
): Effect<requirements, to> {
  if (effect[0] === "pure") {
    return pure(fn(effect[1]));
  }

  return suspend(effect[1], (value) => {
    return map(effect[2](value), fn);
  });
}

export function bind<left, from, right, to>(
  effect: Effect<left, from>,
  fn: (value: from) => Effect<right, to>,
): Effect<left | right, to> {
  if (effect[0] === "pure") {
    return fn(effect[1]) as Effect<left | right, to>;
  }

  return suspend(effect[1], (value) => {
    return bind(effect[2](value), fn);
  });
}

export function handle_with<requirements, item>(
  effect: Effect<requirements, item>,
  handlers: readonly [],
): Effect<requirements, item>;
export function handle_with<requirements, item, out>(
  effect: Effect<requirements, item>,
  handlers: readonly [
    EffectRunner<requirements, item, out>,
  ],
): out;
export function handle_with<
  requirements,
  item,
  first_requirements,
  first_item,
  out,
>(
  effect: Effect<requirements, item>,
  handlers: readonly [
    EffectHandler<requirements, item, first_requirements, first_item>,
    EffectRunner<first_requirements, first_item, out>,
  ],
): out;
export function handle_with<
  requirements,
  item,
  first_requirements,
  first_item,
  second_requirements,
  second_item,
  out,
>(
  effect: Effect<requirements, item>,
  handlers: readonly [
    EffectHandler<requirements, item, first_requirements, first_item>,
    EffectHandler<
      first_requirements,
      first_item,
      second_requirements,
      second_item
    >,
    EffectRunner<second_requirements, second_item, out>,
  ],
): out;
export function handle_with<
  requirements,
  item,
  first_requirements,
  first_item,
  second_requirements,
  second_item,
  third_requirements,
  third_item,
  out,
>(
  effect: Effect<requirements, item>,
  handlers: readonly [
    EffectHandler<requirements, item, first_requirements, first_item>,
    EffectHandler<
      first_requirements,
      first_item,
      second_requirements,
      second_item
    >,
    EffectHandler<
      second_requirements,
      second_item,
      third_requirements,
      third_item
    >,
    EffectRunner<third_requirements, third_item, out>,
  ],
): out;
export function handle_with<
  requirements,
  item,
  first_requirements,
  first_item,
  second_requirements,
  second_item,
  third_requirements,
  third_item,
  fourth_requirements,
  fourth_item,
  out,
>(
  effect: Effect<requirements, item>,
  handlers: readonly [
    EffectHandler<requirements, item, first_requirements, first_item>,
    EffectHandler<
      first_requirements,
      first_item,
      second_requirements,
      second_item
    >,
    EffectHandler<
      second_requirements,
      second_item,
      third_requirements,
      third_item
    >,
    EffectHandler<
      third_requirements,
      third_item,
      fourth_requirements,
      fourth_item
    >,
    EffectRunner<fourth_requirements, fourth_item, out>,
  ],
): out;
export function handle_with<
  requirements,
  item,
  first_requirements,
  first_item,
  second_requirements,
  second_item,
  third_requirements,
  third_item,
  fourth_requirements,
  fourth_item,
  fifth_requirements,
  fifth_item,
  out,
>(
  effect: Effect<requirements, item>,
  handlers: readonly [
    EffectHandler<requirements, item, first_requirements, first_item>,
    EffectHandler<
      first_requirements,
      first_item,
      second_requirements,
      second_item
    >,
    EffectHandler<
      second_requirements,
      second_item,
      third_requirements,
      third_item
    >,
    EffectHandler<
      third_requirements,
      third_item,
      fourth_requirements,
      fourth_item
    >,
    EffectHandler<
      fourth_requirements,
      fourth_item,
      fifth_requirements,
      fifth_item
    >,
    EffectRunner<fifth_requirements, fifth_item, out>,
  ],
): out;
export function handle_with(
  effect: Effect<unknown, unknown>,
  handlers: readonly ((effect: never) => unknown)[],
): unknown {
  let handled: unknown = effect;

  for (const handler of handlers) {
    handled = handler(handled as never);
  }

  return handled;
}

export function interpret<requirements, item>(
  effect: Effect<requirements, item>,
): EffectInterpreter<requirements, item> {
  return Object.assign(Object.create(EffectInterpreterPrototype), {
    effect,
  }) as EffectInterpreter<requirements, item>;
}

export function run<item>(effect: Effect<never, item>): item {
  if (effect[0] === "pure") {
    return effect[1];
  }

  const operation = effect[1] as unknown as TaggedOperation;
  throw new TypeError("Unhandled effect operation: " + operation[0]);
}

export function handle_lift<
  requirements,
  dictionary extends Dictionary,
  state,
  item,
  out,
>(
  effect: Effect<requirements, item>,
  runtime_kind: dictionary[typeof kind],
  state: state,
  handler: LiftHandler<dictionary, state, item, out>,
): Effect<WithoutLift<requirements, dictionary>, out> {
  if (effect[0] === "pure") {
    return pure(handler.done(effect[1], state));
  }

  if (is_lift_of(effect[1], runtime_kind)) {
    const operation = effect[1] as unknown as Lift<dictionary, unknown>;
    const [value, next] = handler.handle(operation[1], state);

    return handle_lift(effect[2](value), runtime_kind, next, handler);
  }

  return suspend(
    effect[1] as WithoutLift<requirements, dictionary>,
    (value) => handle_lift(effect[2](value), runtime_kind, state, handler),
  );
}

function program<yielded, item>(
  run: () => Generator<yielded, item, unknown>,
): Effect<EffectRequirements<yielded>, item> {
  const first = run_with(undefined);

  if (first.next.done) {
    return pure(first.next.value) as Effect<EffectRequirements<yielded>, item>;
  }

  return step(undefined, first.next.value, first.iterator);

  function run_with(
    path: ProgramPath | undefined,
  ): {
    readonly iterator: Generator<yielded, item, unknown>;
    readonly next: IteratorResult<yielded, item>;
  } {
    const iterator = run();
    let next = iterator.next();

    for (const value of values_from_path(path)) {
      if (next.done) {
        return { iterator, next };
      }

      next = iterator.next(value);
    }

    return { iterator, next };
  }

  function step(
    path: ProgramPath | undefined,
    current: yielded,
    iterator: Generator<yielded, item, unknown>,
  ): Effect<EffectRequirements<yielded>, item> {
    let calls = 0;

    return bind(as_effect(current), (value) => {
      if (calls === 0) {
        calls += 1;
        const next = iterator.next(value);

        if (next.done) {
          return pure(next.value);
        }

        const next_path = append_program_path(path, value);
        return step(next_path, next.value, iterator);
      }

      calls += 1;
      const next_path = append_program_path(path, value);
      const state = run_with(next_path);

      if (state.next.done) {
        return pure(state.next.value);
      }

      return step(next_path, state.next.value, state.iterator);
    });
  }
}

function scope<requirements>(): ProgramScope<requirements> {
  return function scoped_program<yielded, item>(
    run: () => Generator<ScopedYield<requirements, yielded>, item, unknown>,
  ): Effect<EffectRequirements<yielded>, item> {
    return program(run as () => Generator<yielded, item, unknown>);
  };
}

export function is_lift_of<dictionary extends Dictionary>(
  operation: unknown,
  runtime_kind: dictionary[typeof kind],
): operation is Lift<dictionary, unknown> {
  if (!has_tag(operation, "lift")) {
    return false;
  }

  const value = operation[1];

  if (typeof value !== "object") {
    return false;
  }

  if (value === null) {
    return false;
  }

  return (value as Dictionary)[kind] === runtime_kind;
}

export function has_tag<tag extends string>(
  operation: unknown,
  tag: tag,
): operation is TaggedOperation<tag> {
  if (typeof operation !== "object") {
    return false;
  }

  if (operation === null) {
    return false;
  }

  return (operation as TaggedOperation)[0] === tag;
}

function as_effect<requirements, item>(
  value: unknown,
): Effect<requirements, item> {
  if (is_effect(value)) {
    return value as Effect<requirements, item>;
  }

  if (is_data(value)) {
    return suspend(
      ["lift", value] as unknown as Lift<Dictionary, item>,
      resume_pure,
    ) as Effect<requirements, item>;
  }

  return value as Effect<requirements, item>;
}

export function is_effect(value: unknown): value is Effect<unknown, unknown> {
  if (typeof value !== "object") {
    return false;
  }

  if (value === null) {
    return false;
  }

  return Object.getPrototypeOf(value) === EffectPrototype;
}

function resume_pure(value: unknown): Effect<never, unknown> {
  return pure(value);
}

function append_program_path(
  previous: ProgramPath | undefined,
  value: unknown,
): ProgramPath {
  let length = 1;

  if (previous !== undefined) {
    length = previous.length + 1;
  }

  return {
    previous,
    value,
    length,
  };
}

function values_from_path(path: ProgramPath | undefined): unknown[] {
  if (path === undefined) {
    return [];
  }

  const values = new Array<unknown>(path.length);
  let index = values.length - 1;

  for (
    let node: ProgramPath | undefined = path;
    node !== undefined;
    node = node.previous
  ) {
    values[index] = node.value;
    index -= 1;
  }

  return values;
}

function* effect_iterator<requirements, item>(
  this: Effect<requirements, item>,
): Generator<Effect<requirements, item>, item, unknown> {
  const item = yield this;
  return item as item;
}
