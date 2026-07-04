import { type Dictionary, is_trait, kind, type Value } from "./trait.ts";

declare const operation_output: unique symbol;

export type Operation<item> = {
  readonly [operation_output]?: item;
};

type OperationOutput<operation> = operation extends Operation<infer item> ? item
  : never;

export type TaggedOperation = {
  readonly tag: string;
};

export type Lift<dictionary extends Dictionary, item> =
  & Operation<item>
  & {
    readonly tag: "lift";
    readonly value: Value<dictionary, item>;
  };

export type Uses<dictionary extends Dictionary, item = unknown> = Lift<
  dictionary,
  item
>;

type Pure<item> = {
  readonly tag: "pure";
  readonly value: item;
};

type Impure<requirements, item> = {
  readonly tag: "impure";
  readonly operation: requirements;
  resume(value: unknown): Effect<requirements, item>;
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

type EffectRequirements<value> = value extends Effect<
  infer requirements,
  infer _item
> ? requirements
  : value extends Value<infer dictionary, infer item> ? Lift<dictionary, item>
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

export type DictionaryType<dictionary> = dictionary extends
  Dictionary<infer type_id> ? type_id
  : never;

export type WithoutLift<
  requirements,
  dictionary extends Dictionary,
> = requirements extends Lift<infer lifted, infer _item>
  ? DictionaryType<lifted> extends DictionaryType<dictionary> ? never
  : requirements
  : requirements;

export type LiftHandler<
  dictionary extends Dictionary<PropertyKey>,
  state,
  item,
  out,
> = {
  done(value: item, state: state): out;
  handle(
    value: Value<dictionary, unknown>,
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

export const Program = Object.assign(program, {
  scope,
}) as ProgramConstructor;

export const Effect = {
  pure,
  lift,
  send,
  suspend,
  map,
  bind,
  handle_with,
  run,
};

export function pure<item>(value: item): Effect<never, item> {
  return Object.assign(Object.create(EffectPrototype), {
    tag: "pure",
    value,
  }) as Effect<never, item>;
}

export function lift<dictionary extends Dictionary, item>(
  value: Value<dictionary, item>,
): Effect<Lift<dictionary, item>, item> {
  return suspend({ tag: "lift", value } as Lift<dictionary, item>, (value) => {
    return pure(value as item);
  });
}

export function send<operation extends TaggedOperation & Operation<unknown>>(
  operation: operation,
): Effect<operation, OperationOutput<operation>> {
  return suspend(operation, (value) => {
    return pure(value as OperationOutput<operation>);
  });
}

export function suspend<requirements, item>(
  operation: requirements,
  resume: (value: unknown) => Effect<requirements, item>,
): Effect<requirements, item> {
  return Object.assign(Object.create(EffectPrototype), {
    tag: "impure",
    operation,
    resume,
  }) as Effect<requirements, item>;
}

export function map<requirements, from, to>(
  effect: Effect<requirements, from>,
  fn: (value: from) => to,
): Effect<requirements, to> {
  return bind(effect, (value) => pure(fn(value)));
}

export function bind<left, from, right, to>(
  effect: Effect<left, from>,
  fn: (value: from) => Effect<right, to>,
): Effect<left | right, to> {
  if (effect.tag === "pure") {
    return fn(effect.value) as Effect<left | right, to>;
  }

  return suspend(effect.operation, (value) => {
    return bind(effect.resume(value), fn);
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

export function run<item>(effect: Effect<never, item>): item {
  if (effect.tag === "pure") {
    return effect.value;
  }

  const operation = effect.operation as unknown as TaggedOperation;
  throw new TypeError("Unhandled effect operation: " + operation.tag);
}

export function handle_lift<
  requirements,
  dictionary extends Dictionary<PropertyKey>,
  state,
  item,
  out,
>(
  effect: Effect<requirements, item>,
  type_id: DictionaryType<dictionary>,
  state: state,
  handler: LiftHandler<dictionary, state, item, out>,
): Effect<WithoutLift<requirements, dictionary>, out> {
  if (effect.tag === "pure") {
    return pure(handler.done(effect.value, state));
  }

  if (is_lift_of(effect.operation, type_id)) {
    const operation = effect.operation as unknown as Lift<dictionary, unknown>;
    const [value, next] = handler.handle(operation.value, state);

    return handle_lift(effect.resume(value), type_id, next, handler);
  }

  return suspend(
    effect.operation as WithoutLift<requirements, dictionary>,
    (value) => handle_lift(effect.resume(value), type_id, state, handler),
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

export function is_lift_of<type_id extends PropertyKey>(
  operation: unknown,
  type_id: type_id,
): operation is Lift<Dictionary<type_id>, unknown> {
  if (!has_tag(operation, "lift")) {
    return false;
  }

  const value = (operation as { readonly value?: unknown }).value;

  if (typeof value !== "object") {
    return false;
  }

  if (value === null) {
    return false;
  }

  return (value as Dictionary)[kind] === type_id;
}

export function has_tag<tag extends string>(
  operation: unknown,
  tag: tag,
): operation is TaggedOperation & { readonly tag: tag } {
  if (typeof operation !== "object") {
    return false;
  }

  if (operation === null) {
    return false;
  }

  return (operation as TaggedOperation).tag === tag;
}

function as_effect<requirements, item>(
  value: unknown,
): Effect<requirements, item> {
  if (is_effect(value)) {
    return value as Effect<requirements, item>;
  }

  if (is_trait(value)) {
    return suspend(
      { tag: "lift", value } as Lift<Dictionary, item>,
      (value) => pure(value as item),
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

  return Object.prototype.isPrototypeOf.call(EffectPrototype, value);
}

function append_program_path(
  previous: ProgramPath | undefined,
  value: unknown,
): ProgramPath {
  return {
    previous,
    value,
    length: previous === undefined ? 1 : previous.length + 1,
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
