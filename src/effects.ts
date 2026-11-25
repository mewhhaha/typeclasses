import { yield_data } from "./data_value.ts";
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

/** Extracts the item produced when an operation is interpreted. */
export type OperationOutput<operation> = operation extends Operation<infer item>
  ? item
  : never;

/** A tuple-tagged operation that can carry one payload. */
export type TaggedOperation<tag extends string = string> =
  | readonly [tag]
  | readonly [tag, unknown];

/** @ignore */
export declare const unconstrained_payload: unique symbol;

/** @ignore */
export type UnconstrainedPayload = typeof unconstrained_payload;

/** A tagged operation constructor with `.send`, `.is`, and `.tag` helpers. */
export type OperationConstructor<
  tag extends string,
  item,
  payload = UnconstrainedPayload,
> = [payload] extends [UnconstrainedPayload] ? {
    <value>(payload: value): readonly [tag, value] & Operation<item>;
    /** Sends this operation as an Effect producing `item`. */
    send<value>(
      payload: value,
    ): Effect<readonly [tag, value] & Operation<item>, item>;
    /** Tests whether an unknown operation has this tag. */
    is(
      candidate: unknown,
    ): candidate is readonly [tag, unknown] & Operation<item>;
    /** The operation's discriminant tag. */
    readonly tag: tag;
  }
  : [payload] extends [void] ? {
      (): readonly [tag] & Operation<item>;
      /** Sends this zero-payload operation as an Effect producing `item`. */
      send(): Effect<readonly [tag] & Operation<item>, item>;
      /** Tests whether an unknown operation has this tag. */
      is(candidate: unknown): candidate is readonly [tag] & Operation<item>;
      /** The operation's discriminant tag. */
      readonly tag: tag;
    }
  : {
    (payload: payload): readonly [tag, payload] & Operation<item>;
    /** Sends this operation as an Effect producing `item`. */
    send(
      payload: payload,
    ): Effect<readonly [tag, payload] & Operation<item>, item>;
    /** Tests whether an unknown operation has this tag. */
    is(
      candidate: unknown,
    ): candidate is readonly [tag, payload] & Operation<item>;
    /** The operation's discriminant tag. */
    readonly tag: tag;
  };

/** Curried builder returned by `Effect.operation`. */
export type OperationBuilder<
  item,
  payload = UnconstrainedPayload,
> = [payload] extends [UnconstrainedPayload] ? {
    <const tagged extends TaggedOperation>(
      tagged: tagged,
    ): tagged & Operation<item>;
    <const tag extends string>(
      tag: tag,
    ): OperationConstructor<tag, item, UnconstrainedPayload>;
  }
  : {
    <const tag extends string>(
      tag: tag,
    ): OperationConstructor<tag, item, payload>;
  };

/** Gives a tagged tuple an operation output type, or creates a typed constructor. */
export function operation<
  item,
  payload = UnconstrainedPayload,
>(): OperationBuilder<item, payload> {
  return ((value: string | TaggedOperation) => {
    if (typeof value === "string") {
      const construct = function construct_operation(
        argument?: unknown,
      ): TaggedOperation {
        if (arguments.length === 0) return [value];
        return [value, argument];
      };
      return Object.assign(construct, {
        tag: value,
        send(argument?: unknown) {
          return send(
            (arguments.length === 0 ? [value] : [value, argument]) as
              & TaggedOperation
              & Operation<item>,
          );
        },
        is(candidate: unknown): boolean {
          return Array.isArray(candidate) &&
            !is_effect(candidate) &&
            (candidate.length === 1 || candidate.length === 2) &&
            candidate[0] === value;
        },
      });
    }
    return value;
  }) as OperationBuilder<item, payload>;
}

/** An operation that lifts a dictionary value into an effect program. */
export type Lift<dictionary extends Dictionary, item> =
  & Operation<item>
  & readonly ["lift", Data<dictionary, item>];

/** Declares that an effect program uses values from `dictionary`. */
export type Uses<dictionary extends Dictionary, item = unknown> = Lift<
  dictionary,
  item
>;

/** Describes how an effect scope completed. */
export type EffectExit =
  | { readonly status: "succeeded" }
  | { readonly status: "failed"; readonly error: unknown }
  | { readonly status: "cancelled"; readonly reason: unknown };

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
      /** @ignore Creates a fresh scope for each terminal execution. */
      readonly prepare?: () => Ensuring[1];
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
    : {
      readonly "Program.scope is missing these requirements": Exclude<
        EffectRequirements<yielded>,
        requirements
      >;
    };

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

/** Removes selected operations from an effect requirement union. */
export type WithoutOperation<requirements, selected> = requirements extends
  selected ? never
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

type EffectResume = (value: unknown) => Effect<unknown, unknown>;

type EffectFrame = {
  readonly previous: EffectFrame | undefined;
  readonly fn: (value: unknown) => unknown;
  readonly is_map: boolean;
  ordered: EffectFrame[] | undefined;
};

// A suspended continuation shares its unconsumed array instead of copying its
// frames after every operation. Separate chunks preserve nested bind ordering.
type EffectQueue =
  | {
    readonly tag: "chunk";
    readonly frames: readonly EffectFrame[];
    readonly index: number;
  }
  | {
    readonly tag: "concat";
    readonly left: EffectQueue;
    readonly right: EffectQueue;
  };

type EffectState = {
  readonly resume: EffectResume;
  readonly frames: EffectFrame | undefined;
  readonly queue: EffectQueue | undefined;
};

const effect_state = Symbol();

/** Builds effects with generator syntax. */
export const Program = /* @__PURE__ */ Object.assign(program, {
  scope,
}) as ProgramConstructor;

/** @ignore */
export type EffectConstructors = {
  readonly operation: typeof operation;
  readonly pure: typeof pure;
  readonly from: typeof from;
  readonly lift: typeof lift;
  readonly send: typeof send;
  readonly suspend: typeof suspend;
  readonly map: typeof map;
  readonly map_from: typeof map_from;
  readonly bind: typeof bind;
  readonly bind_from: typeof bind_from;
  readonly ensuring: typeof ensuring;
  readonly handle_operation: typeof handle_operation;
  readonly handle_with: typeof handle_with;
  readonly interpret: typeof interpret;
};

/** Constructors and combinators for effect programs.
 *
 * The annotation is load-bearing: left to inference, JSR's npm-compatible
 * declarations emit this as `{}` and every member disappears for npm consumers.
 * See https://github.com/mewhhaha/typeclasses/issues/5.
 */
export const Effect: EffectConstructors = {
  operation,
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
  handle_operation,
  handle_with,
  interpret,
};

const DetachedEffectBase = /* @__PURE__ */ (() => {
  class DetachedEffectArr extends Array<unknown> {}
  Object.setPrototypeOf(DetachedEffectArr.prototype, Object.prototype);
  Object.defineProperty(DetachedEffectArr.prototype, Symbol.iterator, {
    value: effect_iterator,
  });
  return DetachedEffectArr;
})();

function make_impure<requirements, item>(
  operation: requirements,
  resume: (value: unknown) => Effect<requirements, item>,
): Effect<requirements, item> {
  const e = new DetachedEffectBase(3);
  e[0] = "impure";
  e[1] = operation;
  e[2] = resume;
  return e as unknown as Effect<requirements, item>;
}

function make_framed<requirements, item>(
  operation: requirements,
  resume: EffectResume,
  frames: EffectFrame | undefined,
  queue: EffectQueue | undefined,
): Effect<requirements, item> {
  const e = new DetachedEffectBase(3) as unknown as {
    0: "impure";
    1: unknown;
    2: EffectResume;
    [effect_state]: EffectState;
  };
  e[0] = "impure";
  e[1] = operation;
  e[2] = (value: unknown) => resume_effect(resume, frames, queue, value);
  e[effect_state] = { resume, frames, queue };
  return e as unknown as Effect<requirements, item>;
}

type MaybeFramedEffect = {
  readonly 0: "impure";
  readonly 1: unknown;
  readonly 2: EffectResume;
  readonly [effect_state]?: EffectState;
};

/** Creates an effect that has already produced `value`. */
export function pure<item>(value: item): Effect<never, item> {
  const e = new DetachedEffectBase(2);
  e[0] = "pure";
  e[1] = value;
  return e as unknown as Effect<never, item>;
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
  return make_impure(
    ["lift", value] as Lift<dictionary, item>,
    resume_pure,
  ) as Effect<Lift<dictionary, item>, item>;
}

/** Suspends a typed operation and returns its eventual output. */
export function send<operation extends TaggedOperation & Operation<unknown>>(
  operation: operation,
): Effect<operation, OperationOutput<operation>> {
  return make_impure(operation, resume_pure) as Effect<
    operation,
    OperationOutput<operation>
  >;
}

/** Suspends an operation with an explicit continuation. */
export function suspend<
  operation extends Operation<unknown>,
  requirements,
  item,
>(
  operation: operation,
  resume: (value: OperationOutput<operation>) => Effect<requirements, item>,
): Effect<operation | requirements, item>;
/** Suspends an untyped requirement; prefer Operation for a typed continuation. */
export function suspend<requirements, item>(
  operation: requirements,
  resume: (value: unknown) => Effect<requirements, item>,
): Effect<requirements, item>;
export function suspend<requirements, item>(
  operation: requirements,
  resume: (value: unknown) => Effect<requirements, item>,
): Effect<requirements, item> {
  return make_impure(operation, resume);
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
    fn as (value: unknown) => unknown,
    true,
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
    return make_impure(
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
    fn as (value: unknown) => unknown,
    false,
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
    return make_impure(
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

  return make_impure(operation, resume_pure) as Effect<
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
  let handled: unknown = effect;
  for (let index = 0; index < handlers.length; index += 1) {
    handled = handlers[index](handled as never);
  }
  return handled;
}

/** Wraps an effect in a fluent interpreter. */
export function interpret<requirements, item>(
  effect: Effect<requirements, item>,
): EffectInterpreter<requirements, item> {
  return {
    handle: (handler) => interpret(handler(effect)),
    run: (runner) => runner(effect),
    value: () => effect,
  };
}

/** Extracts the item from an effect with no remaining requirements. */
export function run<item>(effect: Effect<never, item>): item {
  if (effect[0] === "pure") {
    return effect[1];
  }

  const operation = effect[1] as unknown as TaggedOperation;
  throw new TypeError("Unhandled effect operation: " + operation[0]);
}

/**
 * Handles selected operations while preserving unmatched requirements.
 *
 * Pure handler results are resumed iteratively, so long synchronous operation
 * sequences do not grow the JavaScript stack. A handler may also translate the
 * selected operation into another effect capability.
 */
export function handle_operation<
  requirements,
  selected extends TaggedOperation & Operation<unknown>,
  handled_requirements,
  item,
>(
  effect: Effect<requirements, item>,
  select: (operation: unknown) => operation is selected,
  handle: (
    operation: selected,
  ) => Effect<handled_requirements, OperationOutput<selected>>,
): Effect<
  WithoutOperation<requirements, selected> | handled_requirements,
  item
> {
  let current = effect as Effect<requirements, unknown>;

  while (true) {
    if (current[0] === "pure") {
      return current as Effect<
        WithoutOperation<requirements, selected> | handled_requirements,
        item
      >;
    }
    const suspended = current;
    if (!select(suspended[1])) {
      return make_impure(
        suspended[1] as WithoutOperation<requirements, selected>,
        (value) => handle_operation(suspended[2](value), select, handle),
      ) as Effect<
        WithoutOperation<requirements, selected> | handled_requirements,
        item
      >;
    }
    const handled = handle(suspended[1]);
    if (!is_effect(handled)) {
      throw new TypeError("Operation handler returned an invalid effect");
    }
    if (handled[0] === "pure") {
      current = suspended[2](handled[1]) as Effect<requirements, unknown>;
      continue;
    }
    return bind(
      handled,
      (value) => handle_operation(suspended[2](value), select, handle),
    ) as Effect<
      WithoutOperation<requirements, selected> | handled_requirements,
      item
    >;
  }
}

function handle_lift_step<
  dictionary extends Dictionary,
  state,
  item,
  result,
>(
  effect: Effect<unknown, unknown>,
  runtime_kind: dictionary[typeof kind],
  state: state,
  handler: LiftHandler<dictionary, state, item, result>,
  terminal: boolean,
): unknown {
  let current = effect;
  let current_state = state;

  while (true) {
    if (terminal && !is_effect(current)) {
      throw new TypeError("Invalid effect value");
    }
    const tag = current[0];
    if (tag === "pure") {
      const done = handler.done(current[1] as item, current_state);
      return terminal ? done : pure(done);
    }
    if (tag !== "impure") throw new TypeError("Invalid effect value");
    if (is_lift_of(current[1], runtime_kind)) {
      const [value, next] = handler.handle(
        (current[1] as Lift<dictionary, unknown>)[1],
        current_state,
      );
      current = current[2](value);
      current_state = next;
      continue;
    }
    if (terminal) {
      throw new TypeError(
        "Unhandled effect operation: " + (current[1] as TaggedOperation)[0],
      );
    }
    const suspended = current;
    const suspended_state = current_state;
    return make_impure(
      suspended[1],
      (value) =>
        handle_lift_step(
          suspended[2](value),
          runtime_kind,
          suspended_state,
          handler,
          false,
        ) as Effect<unknown, unknown>,
    );
  }
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
  return handle_lift_step(
    effect as Effect<unknown, unknown>,
    runtime_kind,
    state,
    handler,
    true,
  ) as result;
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
  return handle_lift_step(
    effect as Effect<unknown, unknown>,
    runtime_kind,
    state,
    handler,
    false,
  ) as Effect<WithoutLift<requirements, dictionary>, result>;
}

function program<yielded, item>(
  run: () => Generator<yielded, item, unknown>,
): Effect<EffectRequirements<yielded>, item> {
  const iterator = run();
  const next = iterator.next();

  if (next.done) {
    return pure(next.value) as Effect<EffectRequirements<yielded>, item>;
  }

  return step(undefined, next.value, iterator);

  function run_with(
    path: ProgramPath | undefined,
  ): {
    readonly iterator: Generator<yielded, item, unknown>;
    readonly next: IteratorResult<yielded, item>;
  } {
    const iterator = run();
    let next = iterator.next();
    const values: unknown[] = [];
    for (let node = path; node !== undefined; node = node.previous) {
      values.push(node.value);
    }
    for (let i = values.length - 1; i >= 0; i -= 1) {
      if (next.done) return { iterator, next };
      next = iterator.next(values[i]);
    }
    return { iterator, next };
  }

  function step(
    path: ProgramPath | undefined,
    current: yielded,
    iterator: Generator<yielded, item, unknown>,
  ): Effect<EffectRequirements<yielded>, item> {
    let item_value: unknown = current;
    let effect: Effect<EffectRequirements<yielded>, unknown> | undefined;
    while (!is_data(item_value)) {
      effect = as_effect<EffectRequirements<yielded>, unknown>(item_value);
      if (effect[0] !== "pure") break;
      path = append_program_path(path, effect[1]);
      const next = iterator.next(effect[1]);
      if (next.done) return pure(next.value);
      item_value = next.value;
      effect = undefined;
    }

    let calls = 0;
    const suspended_path = path;
    const resume_step = (
      value: unknown,
    ): Effect<EffectRequirements<yielded>, item> => {
      if (calls === 0) {
        calls = 1;
        const next = iterator.next(value);
        return next.done ? pure(next.value) : step(
          append_program_path(suspended_path, value),
          next.value,
          iterator,
        );
      }
      calls += 1;
      const next_path = append_program_path(suspended_path, value);
      const state = run_with(next_path);
      return state.next.done
        ? pure(state.next.value)
        : step(next_path, state.next.value, state.iterator);
    };

    return effect === undefined
      ? make_impure(
        ["lift", item_value] as EffectRequirements<yielded>,
        resume_step,
      )
      : bind(effect, resume_step);
  }
}

function scope<requirements>(): ProgramScope<requirements> {
  return program as unknown as ProgramScope<requirements>;
}

/** Tests whether an unknown operation lifts the given dictionary kind. */
export function is_lift_of<dictionary extends Dictionary>(
  operation: unknown,
  runtime_kind: dictionary[typeof kind],
): operation is Lift<dictionary, unknown> {
  if (
    typeof operation !== "object" || operation === null ||
    (operation as TaggedOperation)[0] !== "lift"
  ) return false;
  const value = (operation as readonly [string, unknown])[1];
  return typeof value === "object" && value !== null &&
    (value as Dictionary)[kind] === runtime_kind;
}

/** Tests whether an unknown operation has the given tuple tag. */
export function has_tag<tag extends string>(
  operation: unknown,
  tag: tag,
): operation is TaggedOperation<tag> {
  return typeof operation === "object" && operation !== null &&
    (operation as TaggedOperation)[0] === tag;
}

function append_effect_frame<requirements, item>(
  effect: Impure<requirements, item>,
  fn: (value: unknown) => unknown,
  is_map: boolean,
): Effect<requirements, unknown> {
  const target = effect as unknown as MaybeFramedEffect;
  const state = target[effect_state];
  if (state === undefined && !is_map && target[2] === resume_pure) {
    return make_impure(
      effect[1],
      fn as (value: unknown) => Effect<requirements, unknown>,
    );
  }
  return make_framed(
    effect[1],
    state === undefined ? target[2] : state.resume,
    { previous: state?.frames, fn, is_map, ordered: undefined },
    state?.queue,
  );
}

function resume_effect(
  resume: EffectResume,
  frames: EffectFrame | undefined,
  queue: EffectQueue | undefined,
  value: unknown,
): Effect<unknown, unknown> {
  let current: Effect<unknown, unknown> | undefined;
  let pure_value: unknown;
  if (resume === resume_pure) {
    pure_value = value;
  } else {
    const next = resume(value);
    if (next[0] === "pure") pure_value = next[1];
    else current = next;
  }

  if (
    queue === undefined && frames !== undefined && frames.previous === undefined
  ) {
    if (current === undefined) {
      return frames.is_map
        ? pure(frames.fn(pure_value))
        : frames.fn(pure_value) as Effect<unknown, unknown>;
    }
    return append_effect_frame(
      current as Impure<unknown, unknown>,
      frames.fn,
      frames.is_map,
    );
  }

  let chunk_frames: readonly EffectFrame[] | undefined;
  let index = 0;
  let pending: EffectQueue | undefined;
  if (queue === undefined && frames !== undefined) {
    chunk_frames = effect_frames_in_order(frames);
  } else {
    pending = append_effect_queue(queue, queue_from_frames(frames));
  }

  while (chunk_frames !== undefined || pending !== undefined) {
    if (current !== undefined) {
      const rem = chunk_frames !== undefined
        ? { tag: "chunk" as const, frames: chunk_frames, index }
        : undefined;
      const tail = append_effect_queue(rem, pending)!;
      const target = current as unknown as MaybeFramedEffect;
      const state = target[effect_state];
      return state === undefined
        ? make_framed(current[1], target[2], undefined, tail)
        : make_framed(
          current[1],
          state.resume,
          undefined,
          append_effect_queue(
            append_effect_queue(state.queue, queue_from_frames(state.frames)),
            tail,
          ),
        );
    }

    if (chunk_frames === undefined) {
      let right_queue: EffectQueue | undefined;
      if (pending!.tag === "chunk") {
        chunk_frames = pending!.frames;
        index = pending!.index;
      } else {
        while (pending!.left.tag === "concat") {
          const left: Extract<EffectQueue, { tag: "concat" }> = pending!.left;
          pending = {
            tag: "concat",
            left: left.left,
            right: { tag: "concat", left: left.right, right: pending!.right },
          };
        }
        chunk_frames = pending!.left.frames;
        index = pending!.left.index;
        right_queue = pending!.right;
      }
      pending = right_queue;
    }

    const len = chunk_frames.length;
    while (index < len) {
      const frame = chunk_frames[index++];
      if (frame.is_map) {
        pure_value = frame.fn(pure_value);
      } else {
        const next = frame.fn(pure_value) as Effect<unknown, unknown>;
        if (next[0] === "pure") pure_value = next[1];
        else {
          current = next;
          break;
        }
      }
    }
    if (index === len) {
      chunk_frames = undefined;
      index = 0;
    }
  }

  return current ?? pure(pure_value);
}

function queue_from_frames(
  frames: EffectFrame | undefined,
): EffectQueue | undefined {
  return frames === undefined ? undefined : {
    tag: "chunk",
    frames: effect_frames_in_order(frames),
    index: 0,
  };
}

function append_effect_queue(
  first: EffectQueue | undefined,
  rest: EffectQueue | undefined,
): EffectQueue | undefined {
  if (first === undefined) return rest;
  if (rest === undefined) return first;
  return { tag: "concat", left: first, right: rest };
}

// Bound cached arrays by total slots. WeakRef would keep every newly flattened
// prefix alive until the current job ends, producing quadratic transient memory.
const ordered_effect_frames = new Set<EffectFrame>();
let ordered_frame_count = 0;
function effect_frames_in_order(frames: EffectFrame): EffectFrame[] {
  const cached = frames.ordered;
  if (cached !== undefined) return cached;
  if (frames.previous === undefined) return [frames];
  const ordered: EffectFrame[] = [];
  for (
    let frame: EffectFrame | undefined = frames;
    frame !== undefined;
    frame = frame.previous
  ) {
    ordered.push(frame);
  }
  ordered.reverse();
  if (ordered.length >= 16 && ordered.length <= 4096) {
    frames.ordered = ordered;
    ordered_effect_frames.add(frames);
    ordered_frame_count += ordered.length;
    while (ordered_frame_count > 4096) {
      const oldest = ordered_effect_frames.values().next().value!;
      ordered_effect_frames.delete(oldest);
      ordered_frame_count -= oldest.ordered!.length;
      oldest.ordered = undefined;
    }
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
    return make_impure(
      ["lift", value] as unknown as Lift<Dictionary, item>,
      resume_pure,
    ) as Effect<requirements, item>;
  }

  return value as Effect<requirements, item>;
}

/** Tests whether an unknown value is an Effect created by this module. */
export function is_effect(value: unknown): value is Effect<unknown, unknown> {
  return value instanceof DetachedEffectBase;
}

function resume_pure(value: unknown): Effect<never, unknown> {
  return pure(value);
}

function append_program_path(
  previous: ProgramPath | undefined,
  value: unknown,
): ProgramPath {
  return { previous, value };
}

function effect_iterator<requirements, item>(
  this: Effect<requirements, item>,
): Generator<Effect<requirements, item>, item, unknown> {
  return yield_data(this);
}

/** Explicit reusable control-flow instructions. Keep state immutable when resuming a suspension more than once. */
export type EffectPlanInstruction<requirements, state, result> =
  | { readonly tag: "done"; readonly finish: (state: state) => result }
  | { readonly tag: "branch"; readonly select: (state: state) => number }
  | {
    readonly tag: "operation";
    readonly operation: (state: state) => requirements;
    readonly resume: (state: state, value: unknown) => state;
    readonly next: number;
  }
  | {
    readonly tag: "step";
    readonly effect: (state: state) => Effect<requirements, unknown>;
    readonly resume: (state: state, value: unknown) => state;
    readonly next: number;
  };

/** Compiles an explicit effect graph with branches and dynamic effect continuations. */
export function compile_effect_plan<requirements, state, result>(
  instructions: readonly EffectPlanInstruction<requirements, state, result>[],
  entry = 0,
): (initial: state) => Effect<requirements, result> {
  const plan = instructions.map((instruction) => ({ ...instruction }));
  return (initial) => execute(entry, initial);
  function execute(index: number, state: state): Effect<requirements, result> {
    while (true) {
      const instruction = plan[index];
      if (instruction === undefined) {
        throw new RangeError(`Invalid effect plan instruction: ${index}`);
      }
      switch (instruction.tag) {
        case "done":
          return pure(instruction.finish(state));
        case "branch":
          index = instruction.select(state);
          break;
        case "operation": {
          const suspended_state = state;
          return suspend(
            instruction.operation(state),
            (value) =>
              execute(
                instruction.next,
                instruction.resume(suspended_state, value),
              ),
          );
        }
        case "step": {
          const effect = instruction.effect(state);
          if (!is_effect(effect)) {
            throw new TypeError("Effect plan step returned an invalid effect");
          }
          if (effect[0] === "pure") {
            state = instruction.resume(state, effect[1]);
            index = instruction.next;
            break;
          }
          const suspended_state = state;
          return bind(
            effect,
            (value) =>
              execute(
                instruction.next,
                instruction.resume(suspended_state, value),
              ),
          );
        }
      }
    }
  }
}
