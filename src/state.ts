import {
  type As,
  type Data,
  data,
  type DictionaryDataType,
  is_data,
  kind,
  type type_data,
  type type_item,
  type WrappedData,
} from "./typeclass.ts";
import {
  type Effect,
  handle_lift,
  is_effect,
  is_lift_of,
  type Lift,
  type TaggedOperation,
} from "./effects.ts";
import {
  Applicative,
  applicative_lift_method,
  Functor,
  Monad,
  Show,
} from "./typeclasses.ts";

/** @ignore */
export declare const state_identity: unique symbol;

/** A computation that produces an item while threading state. */
export type State<state, item> = (state: state) => readonly [item, state];

/** The callable State dictionary for one state type. */
export interface AsState<state>
  extends
    As<AsState<state>, typeof state_identity>,
    Show<AsState<state>>,
    Monad<AsState<state>> {
  /** The item produced by a State value. */
  readonly [type_item]: unknown;
  /** The stateful computation represented by a State value. */
  readonly [type_data]: State<state, this[typeof type_item]>;
  /** Wraps a stateful computation. */
  <item>(value: State<state, item>): StateValue<state, item>;
}

/** A State computation wrapped with its typeclass dictionary. */
export type StateValue<state, item> = WrappedData<
  AsState<state>,
  State<state, item>,
  item
>;

/** @ignore */
export type StateConstructor =
  & AsState<unknown>
  & {
    <state, item>(value: State<state, item>): StateValue<state, item>;
  };

/** The State dictionary and constructor. */
export const State = data<AsState<unknown>>() as StateConstructor;
const state_kind = State[kind];

/** Reads the current state. */
export function get<state>(): StateValue<state, state> {
  return State((state: state) => [state, state]);
}

/** Replaces the current state. */
export function put<state>(state: state): StateValue<state, void> {
  return State((_previous: state) => [undefined, state]);
}

/** Updates the current state with a pure function. */
export function modify<state>(
  fn: (state: state) => state,
): StateValue<state, void> {
  return State((state: state) => [undefined, fn(state)]);
}

/** Selects an item from the current state without changing it. */
export function gets<state, item>(
  fn: (state: state) => item,
): StateValue<state, item> {
  return State((state: state) => [fn(state), state]);
}

/** @ignore */
export type WithoutState<requirements, state> = requirements extends
  Lift<infer dictionary, infer _item>
  ? DictionaryDataType<dictionary> extends DictionaryDataType<AsState<state>>
    ? never
  : requirements
  : requirements;

/** Handles State lifts with an initial state. */
export function run_state<requirements, state, item>(
  effect: Effect<requirements, item>,
  state: state,
): Effect<WithoutState<requirements, state>, readonly [item, state]> {
  return handle_lift(effect, state_kind, state, {
    done(value, current_state) {
      return [value as item, current_state] as const;
    },
    handle(value, current_state) {
      return value.value()(current_state);
    },
  });
}

/** Runs one State value or an effect containing only State lifts. */
export function run_state_terminal<state, item>(
  stateful: StateValue<state, item>,
  state: state,
): readonly [item, state];
/** Runs an effect containing only State lifts. */
export function run_state_terminal<state, item>(
  effect: Effect<Lift<AsState<state>, unknown>, item>,
  state: state,
): readonly [item, state];
/** Runs a State value or an effect containing only State lifts. */
export function run_state_terminal<state, item>(
  value:
    | StateValue<state, item>
    | Effect<Lift<AsState<state>, unknown>, item>,
  state: state,
): readonly [item, state];
export function run_state_terminal<state, item>(
  effect:
    | StateValue<state, item>
    | Effect<Lift<AsState<state>, unknown>, item>,
  state: state,
): readonly [item, state] {
  if (is_data(effect)) {
    if ((effect as Data<AsState<unknown>, unknown>)[kind] !== state_kind) {
      throw new TypeError("Unhandled effect operation: lift");
    }

    const [value, next] = (effect as StateValue<state, item>).value()(state);
    return [value, next];
  }

  let current = effect as Effect<Lift<AsState<state>, unknown>, unknown>;
  let current_state = state;

  while (true) {
    if (!is_effect(current)) {
      throw new TypeError("Invalid effect value");
    }

    if (current[0] === "pure") {
      return [current[1] as item, current_state];
    }

    if (current[0] !== "impure") {
      throw new TypeError("Invalid effect value");
    }

    const operation = current[1];

    if (!is_lift_of(operation, state_kind)) {
      throw new TypeError(
        "Unhandled effect operation: " + (operation as TaggedOperation)[0],
      );
    }

    const [value, next] = operation[1].value()(current_state);
    current = current[2](value) as Effect<
      Lift<AsState<state>, unknown>,
      unknown
    >;
    current_state = next;
  }
}

/** Returns a State value's item and discards its final state. */
export function eval_state<state, item>(
  stateful: Data<AsState<state>, item>,
  state: state,
): item {
  return stateful.value()(state)[0];
}

/** Returns a State value's final state and discards its item. */
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
