import {
  type As,
  type Data,
  data,
  type Dictionary,
  kind,
  type type_data,
  type type_item,
  type WrappedData,
} from "./typeclass.ts";
import {
  type Effect,
  type Lift,
  pure,
  suspend,
  type WithoutLift,
} from "./effects.ts";
import {
  Applicative,
  applicative_lift_method,
  Functor,
  Monad,
  Show,
} from "./typeclasses.ts";

export type State<state, item> = (state: state) => readonly [item, state];

export interface AsState<state>
  extends
    As<AsState<state>>,
    Show<AsState<state>>,
    Functor<AsState<state>>,
    Applicative<AsState<state>>,
    Monad<AsState<state>> {
  readonly [type_item]: unknown;
  readonly [type_data]: State<state, this[typeof type_item]>;
  <item>(value: State<state, item>): StateValue<state, item>;
}

export type StateValue<state, item> = WrappedData<
  AsState<state>,
  State<state, item>,
  item
>;

type StateConstructor =
  & AsState<unknown>
  & {
    <state, item>(value: State<state, item>): StateValue<state, item>;
  };

export const State = data<AsState<unknown>>() as StateConstructor;

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

export function run_state<requirements, state, item>(
  effect: Effect<requirements, item>,
  state: state,
): Effect<WithoutLift<requirements, AsState<state>>, readonly [item, state]> {
  if (effect[0] === "pure") {
    return pure([effect[1], state] as const);
  }

  const operation = effect[1] as readonly [string, unknown];

  if (operation[0] === "lift" && is_state_value(operation[1])) {
    const lifted = effect[1] as unknown as Lift<
      AsState<state>,
      unknown
    >;
    const [value, next] = lifted[1].value()(state);
    return run_state(effect[2](value), next);
  }

  return suspend(
    effect[1] as WithoutLift<requirements, AsState<state>>,
    (value) => run_state(effect[2](value), state),
  ) as Effect<
    WithoutLift<requirements, AsState<state>>,
    readonly [item, state]
  >;
}

function is_state_value(value: unknown): value is Dictionary {
  if (typeof value !== "object") {
    return false;
  }

  if (value === null) {
    return false;
  }

  return (value as Dictionary)[kind] === State[kind];
}

export function eval_state<state, item>(
  stateful: Data<AsState<state>, item>,
  state: state,
): item {
  return stateful.value()(state)[0];
}

export function exec_state<state, item>(
  stateful: Data<AsState<state>, item>,
  state: state,
): state {
  return stateful.value()(state)[1];
}

Show.instance(State)({
  show() {
    return "State(?)";
  },
});

Functor.instance(State)({
  map(fn) {
    return State((state: unknown) => {
      const [value, next] = this.value()(state);
      return [fn(value), next];
    });
  },
});

Applicative.instance(State)({
  pure(value) {
    return State((state: unknown) => [value, state]);
  },

  [applicative_lift_method](fn, rest) {
    const first = this.value();
    const stateful_values = rest.map((current) => current.value());

    return State((state: unknown) => {
      const [first_value, first_state] = first(state);
      const values = [first_value];
      let current_state = first_state;

      for (const stateful of stateful_values) {
        const [value, next_state] = stateful(current_state);
        values.push(value);
        current_state = next_state;
      }

      return [fn(...values), current_state] as const;
    });
  },

  ap(value) {
    return State((state: unknown) => {
      const [fn, next] = this.value()(state);
      const [item, final] = value.value()(next);

      return [fn(item), final];
    });
  },
});

Monad.instance(State)({
  bind(fn) {
    return State((state: unknown) => {
      const [value, next] = this.value()(state);
      return fn(value).value()(next);
    });
  },
});
