import {
  type Data,
  type Dictionary,
  type DictionaryDataType,
  is_data,
  kind,
} from "./typeclass.ts";

/** @ignore */
export declare const operation_output: unique symbol;

/** Associates an operation with the item it produces when interpreted. */
export type Operation<item> = {
  readonly [operation_output]?: item;
};

type OperationOutput<operation> = operation extends Operation<infer item> ? item
  : never;

/** A tuple-tagged operation that can carry one payload. */
export type TaggedOperation<tag extends string = string> =
  | readonly [tag]
  | readonly [tag, unknown];

/** An operation that lifts a dictionary value into an effect program. */
export type Lift<dictionary extends Dictionary, item> =
  & Operation<item>
  & readonly ["lift", Data<dictionary, item>];

/** Declares that an effect program uses values from `dictionary`. */
export type Uses<dictionary extends Dictionary, item = unknown> = Lift<
  dictionary,
  item
>;

/** Describes whether an effect completed successfully or failed. */
export type EffectExit =
  | { readonly status: "succeeded" }
  | { readonly status: "failed"; readonly error: unknown };

/** Cleanup run after an effect exits. */
export type EffectFinalizer = (
  exit: EffectExit,
) => void | PromiseLike<void>;

/** An operation that guarantees cleanup around a nested effect. */
export type Ensuring =
  & Operation<unknown>
  & readonly [
    "effect.ensuring",
    {
      readonly effect: Effect<unknown, unknown>;
      readonly finalize: EffectFinalizer;
    },
  ];

/** @ignore */
export type Pure<item> = {
  readonly 0: "pure";
  readonly 1: item;
};

/** @ignore */
export type Impure<requirements, item> = {
  readonly 0: "impure";
  readonly 1: requirements;
  readonly 2: (value: unknown) => Effect<requirements, item>;
};

/** @ignore */
export type EffectBase<requirements, item> = {
  [Symbol.iterator](): Generator<Effect<requirements, item>, item, unknown>;
};

/** A pure value or suspended operation with its remaining continuation. */
export type Effect<requirements, item> =
  & EffectBase<requirements, item>
  & (
    | Pure<item>
    | Impure<requirements, item>
  );

/** Transforms an effect program while handling one or more requirements. */
export type EffectHandler<
  requirements,
  item,
  next_requirements,
  next_item,
> = (
  effect: Effect<requirements, item>,
) => Effect<next_requirements, next_item>;

/** Runs a fully handled effect program into a result. */
export type EffectRunner<requirements, item, result> = (
  effect: Effect<requirements, item>,
) => result;

/** A fluent interface for handling and running an effect program. */
export type EffectInterpreter<requirements, item> = {
  /** Applies a handler and returns an interpreter for the remaining effect. */
  handle<next_requirements, next_item>(
    handler: EffectHandler<requirements, item, next_requirements, next_item>,
  ): EffectInterpreter<next_requirements, next_item>;

  /** Finishes the effect with a terminal runner. */
  run<result>(runner: EffectRunner<requirements, item, result>): result;

  /** Returns the effect represented by this interpreter. */
  value(): Effect<requirements, item>;
};

/** @ignore */
export type EffectRequirements<value> = value extends Effect<
  infer requirements,
  infer _item
> ? requirements
  : value extends Data<infer dictionary extends Dictionary, infer item>
    ? Lift<dictionary, item>
  : never;

/** @ignore */
export type ScopedYield<requirements, yielded> =
  Exclude<EffectRequirements<yielded>, requirements> extends never ? yielded
    : never;

/** Constructs generator programs restricted to the declared requirements. */
export type ProgramScope<requirements> = {
  /** Builds an effect from a generator that yields effects or dictionary values. */
  <yielded, item>(
    run: () => Generator<ScopedYield<requirements, yielded>, item, unknown>,
  ): Effect<EffectRequirements<yielded>, item>;
};

/** Builds generator-based effect programs. */
export type ProgramConstructor =
  & ProgramScope<unknown>
  & {
    /** Restricts a generator program to the declared requirements. */
    scope<requirements>(): ProgramScope<requirements>;
  };

/** Removes lifts for one dictionary from an effect requirement union. */
export type WithoutLift<
  requirements,
  dictionary extends Dictionary,
> = requirements extends Lift<infer lifted, infer _item>
  ? DictionaryDataType<lifted> extends DictionaryDataType<dictionary> ? never
  : requirements
  : requirements;

/** Interprets lifted dictionary values while carrying explicit state. */
export type LiftHandler<
  dictionary extends Dictionary,
  state,
  item,
  result,
> = {
  /** Produces the final result from the effect item and handler state. */
  done(value: item, state: state): result;
  /** Handles one lifted value and returns its result with the next state. */
  handle(
    value: Data<dictionary, unknown>,
    state: state,
  ): readonly [unknown, state];
};

type ProgramPath = {
  readonly previous: ProgramPath | undefined;
  readonly value: unknown;
};

type EffectFrame = {
  readonly previous: EffectFrame | undefined;
  readonly resume: (value: unknown) => Effect<unknown, unknown>;
};

const effect_resume = Symbol("Effect.resume");
const effect_frames = Symbol("Effect.frames");

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

  run<result>(
    this: EffectInterpreterTarget<unknown, unknown>,
    runner: EffectRunner<unknown, unknown, result>,
  ): result {
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

type PureEffectTarget = {
  0: "pure";
  1: unknown;
};

type ImpureEffectTarget = {
  0: "impure";
  1: unknown;
  2: (value: unknown) => Effect<unknown, unknown>;
  [effect_resume]: (value: unknown) => Effect<unknown, unknown>;
  [effect_frames]: EffectFrame | undefined;
};

type MutableEffectInterpreterTarget = {
  effect: Effect<unknown, unknown>;
};

/** Builds effects with generator syntax. */
export const Program = Object.assign(program, {
  scope,
}) as ProgramConstructor;

/** Constructors and combinators for effect programs. */
export const Effect = {
  pure,
  from,
  lift,
  send,
  suspend,
  map,
  map_from,
  bind,
  bind_from,
  ensuring,
  handle_with,
  interpret,
};

function PureEffect(this: PureEffectTarget, value: unknown) {
  this[0] = "pure";
  this[1] = value;
}

PureEffect.prototype = EffectPrototype;

const NewPureEffect = PureEffect as unknown as {
  new <item>(value: item): Effect<never, item>;
};

function ImpureEffect(
  this: ImpureEffectTarget,
  operation: unknown,
  resume: (value: unknown) => Effect<unknown, unknown>,
  frames: EffectFrame | undefined = undefined,
) {
  this[0] = "impure";
  this[1] = operation;
  this[2] = (value) => resume_effect(resume, frames, value);
  this[effect_resume] = resume;
  this[effect_frames] = frames;
}

ImpureEffect.prototype = EffectPrototype;

const NewImpureEffect = ImpureEffect as unknown as {
  new <requirements, item>(
    operation: requirements,
    resume: (value: unknown) => Effect<requirements, item>,
    frames?: EffectFrame,
  ): Effect<requirements, item>;
};

function EffectInterpreterValue(
  this: MutableEffectInterpreterTarget,
  effect: Effect<unknown, unknown>,
) {
  this.effect = effect;
}

EffectInterpreterValue.prototype = EffectInterpreterPrototype;

const NewEffectInterpreter = EffectInterpreterValue as unknown as {
  new <requirements, item>(
    effect: Effect<requirements, item>,
  ): EffectInterpreter<requirements, item>;
};

/** Creates an effect that has already produced `value`. */
export function pure<item>(value: item): Effect<never, item> {
  return new NewPureEffect(value);
}

/** Returns an existing effect unchanged. */
export function from<requirements, item>(
  value: Effect<requirements, item>,
): Effect<requirements, item>;
/** Lifts a dictionary value into an effect. */
export function from<dictionary extends Dictionary, item>(
  value: Data<dictionary, item>,
): Effect<Lift<dictionary, item>, item>;
export function from(value: unknown): Effect<unknown, unknown> {
  return as_effect(value);
}

/** Suspends a dictionary value as a lift operation. */
export function lift<dictionary extends Dictionary, item>(
  value: Data<dictionary, item>,
): Effect<Lift<dictionary, item>, item> {
  return new NewImpureEffect(
    ["lift", value] as Lift<dictionary, item>,
    resume_pure,
  ) as Effect<Lift<dictionary, item>, item>;
}

/** Suspends a typed operation and returns its eventual output. */
export function send<operation extends TaggedOperation & Operation<unknown>>(
  operation: operation,
): Effect<operation, OperationOutput<operation>> {
  return new NewImpureEffect(operation, resume_pure) as Effect<
    operation,
    OperationOutput<operation>
  >;
}

/** Suspends an operation with an explicit continuation. */
export function suspend<requirements, item>(
  operation: requirements,
  resume: (value: unknown) => Effect<requirements, item>,
): Effect<requirements, item> {
  return new NewImpureEffect(operation, resume);
}

/** Transforms the successful item produced by an effect. */
export function map<requirements, from, to>(
  effect: Effect<requirements, from>,
  fn: (value: from) => to,
): Effect<requirements, to> {
  if (effect[0] === "pure") {
    return pure(fn(effect[1]));
  }

  return append_effect_frame(
    effect,
    (value) => pure(fn(value as from)),
  ) as Effect<requirements, to>;
}

/** Maps an existing effect. */
export function map_from<requirements, from, to>(
  value: Effect<requirements, from>,
  fn: (value: from) => to,
): Effect<requirements, to>;
/** Lifts and maps a dictionary value. */
export function map_from<dictionary extends Dictionary, from, to>(
  value: Data<dictionary, from>,
  fn: (value: from) => to,
): Effect<Lift<dictionary, from>, to>;
export function map_from<from, to>(
  value: unknown,
  fn: (value: from) => to,
): Effect<unknown, to> {
  if (is_data(value)) {
    return new NewImpureEffect(
      ["lift", value] as unknown as Lift<Dictionary, from>,
      (item) => pure(fn(item as from)),
    ) as Effect<unknown, to>;
  }

  return map(as_effect(value), fn as (value: unknown) => to);
}

/** Sequences an effect-dependent computation. */
export function bind<left, from, right, to>(
  effect: Effect<left, from>,
  fn: (value: from) => Effect<right, to>,
): Effect<left | right, to> {
  if (effect[0] === "pure") {
    return fn(effect[1]) as Effect<left | right, to>;
  }

  return append_effect_frame(
    effect,
    (value) => fn(value as from) as Effect<unknown, unknown>,
  ) as Effect<left | right, to>;
}

/** Binds an existing effect into a dependent computation. */
export function bind_from<left, from, right, to>(
  value: Effect<left, from>,
  fn: (value: from) => Effect<right, to>,
): Effect<left | right, to>;
/** Lifts and binds a dictionary value into a dependent computation. */
export function bind_from<dictionary extends Dictionary, from, right, to>(
  value: Data<dictionary, from>,
  fn: (value: from) => Effect<right, to>,
): Effect<Lift<dictionary, from> | right, to>;
export function bind_from<from, right, to>(
  value: unknown,
  fn: (value: from) => Effect<right, to>,
): Effect<unknown | right, to> {
  if (is_data(value)) {
    return new NewImpureEffect(
      ["lift", value] as unknown,
      fn as unknown as (value: unknown) => Effect<unknown | right, to>,
    ) as Effect<unknown | right, to>;
  }

  return bind(
    as_effect(value),
    fn as (value: unknown) => Effect<right, to>,
  ) as Effect<unknown | right, to>;
}

/**
 * Runs `finalize` after this effect succeeds or fails in a terminal runner that
 * supports `Ensuring`. Apply it after the program's other capability handlers.
 */
export function ensuring<requirements, item>(
  effect: Effect<requirements, item>,
  finalize: EffectFinalizer,
): Effect<requirements | Ensuring, item> {
  const operation: Ensuring = [
    "effect.ensuring",
    {
      effect: effect as Effect<unknown, unknown>,
      finalize,
    },
  ];

  return new NewImpureEffect(operation, resume_pure) as Effect<
    requirements | Ensuring,
    item
  >;
}

/** Applies an ordered handler pipeline to an effect. */
export function handle_with<requirements, item>(
  effect: Effect<requirements, item>,
  handlers: readonly [],
): Effect<requirements, item>;
/** Applies an ordered handler pipeline to an effect. */
export function handle_with<requirements, item, result>(
  effect: Effect<requirements, item>,
  handlers: readonly [
    EffectRunner<requirements, item, result>,
  ],
): result;
/** Applies an ordered handler pipeline to an effect. */
export function handle_with<
  requirements,
  item,
  first_requirements,
  first_item,
  result,
>(
  effect: Effect<requirements, item>,
  handlers: readonly [
    EffectHandler<requirements, item, first_requirements, first_item>,
    EffectRunner<first_requirements, first_item, result>,
  ],
): result;
/** Applies an ordered handler pipeline to an effect. */
export function handle_with<
  requirements,
  item,
  first_requirements,
  first_item,
  second_requirements,
  second_item,
  result,
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
    EffectRunner<second_requirements, second_item, result>,
  ],
): result;
/** Applies an ordered handler pipeline to an effect. */
export function handle_with<
  requirements,
  item,
  first_requirements,
  first_item,
  second_requirements,
  second_item,
  third_requirements,
  third_item,
  result,
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
    EffectRunner<third_requirements, third_item, result>,
  ],
): result;
/** Applies an ordered handler pipeline to an effect. */
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
  result,
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
    EffectRunner<fourth_requirements, fourth_item, result>,
  ],
): result;
/** Applies an ordered handler pipeline to an effect. */
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
  result,
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
    EffectRunner<fifth_requirements, fifth_item, result>,
  ],
): result;
export function handle_with(
  effect: Effect<unknown, unknown>,
  handlers: readonly ((effect: never) => unknown)[],
): unknown {
  switch (handlers.length) {
    case 0:
      return effect;
    case 1:
      return handlers[0](effect as never);
    case 2:
      return handlers[1](handlers[0](effect as never) as never);
    case 3:
      return handlers[2](
        handlers[1](handlers[0](effect as never) as never) as never,
      );
    case 4:
      return handlers[3](
        handlers[2](
          handlers[1](handlers[0](effect as never) as never) as never,
        ) as never,
      );
    case 5:
      return handlers[4](
        handlers[3](
          handlers[2](
            handlers[1](handlers[0](effect as never) as never) as never,
          ) as never,
        ) as never,
      );
    case 6:
      return handlers[5](
        handlers[4](
          handlers[3](
            handlers[2](
              handlers[1](handlers[0](effect as never) as never) as never,
            ) as never,
          ) as never,
        ) as never,
      );
  }

  let handled: unknown = effect;

  for (const handler of handlers) {
    handled = handler(handled as never);
  }

  return handled;
}

/** Wraps an effect in a fluent interpreter. */
export function interpret<requirements, item>(
  effect: Effect<requirements, item>,
): EffectInterpreter<requirements, item> {
  return new NewEffectInterpreter(effect);
}

/** Extracts the item from an effect with no remaining requirements. */
export function run<item>(effect: Effect<never, item>): item {
  if (effect[0] === "pure") {
    return effect[1];
  }

  const operation = effect[1] as unknown as TaggedOperation;
  throw new TypeError("Unhandled effect operation: " + operation[0]);
}

/** Runs an effect whose only operation is a lift for `dictionary`. */
export function handle_lift_terminal<
  dictionary extends Dictionary,
  state,
  item,
  result,
>(
  effect: Effect<Lift<dictionary, unknown>, item>,
  runtime_kind: dictionary[typeof kind],
  state: state,
  handler: LiftHandler<dictionary, state, item, result>,
): result {
  let current = effect as Effect<Lift<dictionary, unknown>, unknown>;
  let current_state = state;

  while (true) {
    if (!is_effect(current)) {
      throw new TypeError("Invalid effect value");
    }

    switch (current[0]) {
      case "pure":
        return handler.done(current[1] as item, current_state);
      case "impure": {
        if (is_lift_of(current[1], runtime_kind)) {
          const operation = current[1] as Lift<dictionary, unknown>;
          const [value, next] = handler.handle(operation[1], current_state);
          current = current[2](value) as Effect<
            Lift<dictionary, unknown>,
            unknown
          >;
          current_state = next;
          continue;
        }

        const operation = current[1] as TaggedOperation;
        throw new TypeError("Unhandled effect operation: " + operation[0]);
      }
      default:
        throw new TypeError("Invalid effect value");
    }
  }
}

/** Handles one dictionary's lifts while preserving other requirements. */
export function handle_lift<
  requirements,
  dictionary extends Dictionary,
  state,
  item,
  result,
>(
  effect: Effect<requirements, item>,
  runtime_kind: dictionary[typeof kind],
  state: state,
  handler: LiftHandler<dictionary, state, item, result>,
): Effect<WithoutLift<requirements, dictionary>, result> {
  let current = effect as Effect<requirements, unknown>;
  let current_state = state;

  while (true) {
    switch (current[0]) {
      case "pure":
        return pure(handler.done(current[1] as item, current_state));
      case "impure": {
        if (is_lift_of(current[1], runtime_kind)) {
          const operation = current[1] as unknown as Lift<dictionary, unknown>;
          const [value, next] = handler.handle(operation[1], current_state);
          current = current[2](value) as Effect<requirements, unknown>;
          current_state = next;
          continue;
        }

        const suspended = current;
        const suspended_state = current_state;
        return new NewImpureEffect(
          suspended[1] as WithoutLift<requirements, dictionary>,
          (value) =>
            handle_lift(
              suspended[2](value),
              runtime_kind,
              suspended_state,
              handler,
            ),
        ) as Effect<WithoutLift<requirements, dictionary>, result>;
      }
    }
  }
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

    return bind_from(
      current as Effect<EffectRequirements<yielded>, unknown>,
      (value) => {
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
      },
    );
  }
}

function scope<requirements>(): ProgramScope<requirements> {
  return function scoped_program<yielded, item>(
    run: () => Generator<ScopedYield<requirements, yielded>, item, unknown>,
  ): Effect<EffectRequirements<yielded>, item> {
    return program(run as () => Generator<yielded, item, unknown>);
  };
}

/** Tests whether an unknown operation lifts the given dictionary kind. */
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

/** Tests whether an unknown operation has the given tuple tag. */
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

function append_effect_frame<requirements, item>(
  effect: Impure<requirements, item>,
  resume: (value: unknown) => Effect<unknown, unknown>,
): Effect<requirements, unknown> {
  const target = effect as ImpureEffectTarget;
  const frames: EffectFrame = {
    previous: target[effect_frames],
    resume,
  };

  return new NewImpureEffect(
    effect[1],
    target[effect_resume] as (
      value: unknown,
    ) => Effect<requirements, unknown>,
    frames,
  );
}

function resume_effect(
  resume: (value: unknown) => Effect<unknown, unknown>,
  frames: EffectFrame | undefined,
  value: unknown,
): Effect<unknown, unknown> {
  let current = resume(value);

  if (frames === undefined) {
    return current;
  }

  const ordered = effect_frames_in_order(frames);

  for (let index = 0; index < ordered.length; index += 1) {
    if (current[0] === "impure") {
      return append_effect_frames(current, ordered, index);
    }

    current = ordered[index](current[1]);
  }

  return current;
}

function append_effect_frames(
  effect: Impure<unknown, unknown>,
  ordered: readonly ((value: unknown) => Effect<unknown, unknown>)[],
  start: number,
): Effect<unknown, unknown> {
  const target = effect as ImpureEffectTarget;
  let frames = target[effect_frames];

  for (let index = start; index < ordered.length; index += 1) {
    frames = {
      previous: frames,
      resume: ordered[index],
    };
  }

  return new NewImpureEffect(
    effect[1],
    target[effect_resume],
    frames,
  );
}

function effect_frames_in_order(
  frames: EffectFrame,
): ((value: unknown) => Effect<unknown, unknown>)[] {
  let length = 0;

  for (
    let frame: EffectFrame | undefined = frames;
    frame !== undefined;
    frame = frame.previous
  ) {
    length += 1;
  }

  const ordered = new Array<
    (value: unknown) => Effect<unknown, unknown>
  >(length);
  let index = length - 1;

  for (
    let frame: EffectFrame | undefined = frames;
    frame !== undefined;
    frame = frame.previous
  ) {
    ordered[index] = frame.resume;
    index -= 1;
  }

  return ordered;
}

function as_effect<requirements, item>(
  value: unknown,
): Effect<requirements, item> {
  if (is_effect(value)) {
    return value as Effect<requirements, item>;
  }

  if (is_data(value)) {
    return new NewImpureEffect(
      ["lift", value] as unknown as Lift<Dictionary, item>,
      resume_pure,
    ) as Effect<requirements, item>;
  }

  return value as Effect<requirements, item>;
}

/** Tests whether an unknown value is an Effect created by this module. */
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
  return {
    previous,
    value,
  };
}

function values_from_path(path: ProgramPath | undefined): unknown[] {
  if (path === undefined) {
    return [];
  }

  const values = new Array<unknown>(program_path_length(path));
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

function program_path_length(path: ProgramPath): number {
  let length = 0;

  for (
    let node: ProgramPath | undefined = path;
    node !== undefined;
    node = node.previous
  ) {
    length += 1;
  }

  return length;
}

function* effect_iterator<requirements, item>(
  this: Effect<requirements, item>,
): Generator<Effect<requirements, item>, item, unknown> {
  const item = yield this;
  return item as item;
}
