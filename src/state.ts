import { define, type Dictionary, type Trait, type Value } from "./trait.ts";
import {
  Effect,
  is_effect,
  is_lift_of,
  type Lift,
  type WithoutLift,
} from "./effects.ts";
import { Applicative, Format, Functor, Monad } from "./traits.ts";

export type State<state, item> = (state: state) => readonly [item, state];

export const state_kind = Symbol("State");

declare module "./trait.ts" {
  interface TraitTypes<dictionary, item> {
    [state_kind]: dictionary extends AsState<infer state> ? State<state, item>
      : never;
  }
}

export interface AsState<state> extends Dictionary<typeof state_kind> {
  <item>(value: State<state, item>): StateValue<state, item>;
}

export type StateValue<state, item> = Trait<
  AsState<state>,
  State<state, item>,
  item
>;

type StateConstructor =
  & AsState<unknown>
  & {
    <state, item>(value: State<state, item>): StateValue<state, item>;
  };

export const State = define<AsState<unknown>>(
  state_kind,
) as StateConstructor;

export function get<state>(): StateValue<state, state> {
  return State((state: state) => [state, state]);
}

export function put<state>(state: state): StateValue<state, void> {
  return State((_previous: state) => [undefined, state]);
}

export function modify<state>(
  fn: (state: state) => state,
): StateValue<state, void> {
  return State((state: state) => [undefined, fn(state)]);
}

export function gets<state, item>(
  fn: (state: state) => item,
): StateValue<state, item> {
  return State((state: state) => [fn(state), state]);
}

export function run_state<state, item>(
  stateful: Value<AsState<state>, item>,
  state: state,
): readonly [item, state];
export function run_state<requirements, state, item>(
  effect: Effect<requirements, item>,
  state: state,
): Effect<WithoutLift<requirements, AsState<state>>, readonly [item, state]>;
export function run_state<requirements, state, item>(
  stateful_or_effect:
    | Value<AsState<state>, item>
    | Effect<requirements, item>,
  state: state,
):
  | readonly [item, state]
  | Effect<WithoutLift<requirements, AsState<state>>, readonly [item, state]> {
  if (is_effect(stateful_or_effect)) {
    return run_state_effect(stateful_or_effect, state);
  }

  return stateful_or_effect.value()(state);
}

export function eval_state<state, item>(
  stateful: Value<AsState<state>, item>,
  state: state,
): item {
  return run_state(stateful, state)[0];
}

export function exec_state<state, item>(
  stateful: Value<AsState<state>, item>,
  state: state,
): state {
  return run_state(stateful, state)[1];
}

function run_state_effect<requirements, state, item>(
  effect: Effect<requirements, item>,
  state: state,
): Effect<WithoutLift<requirements, AsState<state>>, readonly [item, state]> {
  if (effect.tag === "pure") {
    return Effect.pure([effect.value, state] as const);
  }

  if (is_lift_of(effect.operation, state_kind)) {
    const operation = effect.operation as unknown as Lift<
      AsState<state>,
      unknown
    >;
    const [value, next] = run_state(operation.value, state);
    return run_state_effect(effect.resume(value), next);
  }

  return Effect.suspend(
    effect.operation as WithoutLift<requirements, AsState<state>>,
    (value) => run_state_effect(effect.resume(value), state),
  );
}

Format.implement(State)({
  fmt() {
    return "State(?)";
  },
});

export interface AsState<state> extends Format<AsState<state>> {}

Functor.implement(State)({
  map(fn) {
    return State((state: unknown) => {
      const [value, next] = run_state(this, state);
      return [fn(value), next];
    });
  },
});

export interface AsState<state> extends Functor<AsState<state>> {}

Applicative.implement(State)({
  pure(value) {
    return State((state: unknown) => [value, state]);
  },

  ap(value) {
    return State((state: unknown) => {
      const [fn, next] = run_state(this, state);
      const [item, final] = run_state(value, next);

      return [fn(item), final];
    });
  },
});

export interface AsState<state> extends Applicative<AsState<state>> {}

Monad.implement(State)({
  bind(fn) {
    return State((state: unknown) => {
      const [value, next] = run_state(this, state);
      return run_state(fn(value), next);
    });
  },
});

export interface AsState<state> extends Monad<AsState<state>> {}
