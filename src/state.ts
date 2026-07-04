import { type As, define, type Trait, type Value } from "./trait.ts";
import { Applicative, Format, Functor, Monad } from "./traits.ts";

export type State<state, item> = (state: state) => readonly [item, state];

type StateContext<item> = (state: never) => readonly [item, unknown];

export const state_kind = Symbol("State");

declare module "./trait.ts" {
  interface TraitTypes<item> {
    [state_kind]: StateContext<item>;
  }
}

export interface AsState extends As<typeof state_kind> {
  <state, item>(value: State<state, item>): StateValue<state, item>;
}

export type StateValue<state, item> = Trait<
  AsState,
  State<state, item>,
  item
>;

export const State = define<AsState>(
  state_kind,
);

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
  stateful: Value<AsState, item>,
  state: state,
): readonly [item, state] {
  return (stateful.value() as State<state, item>)(state);
}

export function eval_state<state, item>(
  stateful: Value<AsState, item>,
  state: state,
): item {
  return run_state(stateful, state)[0];
}

export function exec_state<state, item>(
  stateful: Value<AsState, item>,
  state: state,
): state {
  return run_state(stateful, state)[1];
}

Format.implement(State)({
  fmt() {
    return "State(?)";
  },
});

export interface AsState extends Format<AsState> {}

Functor.implement(State)({
  map(fn) {
    return State((state: never) => {
      const [value, next] = run_state(this, state);
      return [fn(value), next];
    });
  },
});

export interface AsState extends Functor<AsState> {}

Applicative.implement(State)({
  pure(value) {
    return State((state: never) => [value, state]);
  },

  ap(value) {
    return State((state: never) => {
      const [fn, next] = run_state(this, state);
      const [item, final] = run_state(value, next);

      return [fn(item), final];
    });
  },
});

export interface AsState extends Applicative<AsState> {}

Monad.implement(State)({
  bind(fn) {
    return State((state: never) => {
      const [value, next] = run_state(this, state);
      return run_state(fn(value), next);
    });
  },
});

export interface AsState extends Monad<AsState> {}
