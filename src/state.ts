import {
  type As,
  type Data,
  data,
  is_data,
  kind,
  type type_data,
  type type_identity,
  type type_item,
  type WrappedData,
} from "./typeclass.ts";
import {
  type Effect,
  handle_lift,
  is_effect,
  is_lift_of,
  type Lift,
  type LiftHandler,
  type TaggedOperation,
} from "./effects.ts";
import {
  cell_dictionary,
  type CellIdentity,
  type NominalKey,
  type WidenedCellKey,
  type WithoutCell,
} from "./cell.ts";
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

/**
 * A keyed state cell: its callable dictionary and the operations addressing it.
 *
 * The operations live on the dictionary rather than in a wrapper type so that
 * `typeof cell` is exactly the dictionary its values carry, which is what lets
 * `Uses<typeof cell>` cancel against those values in `Program.scope`.
 */
export interface AsCell<key extends PropertyKey, state>
  extends
    As<AsCell<key, state>, CellIdentity<typeof state_identity, key>>,
    Show<AsCell<key, state>>,
    Monad<AsCell<key, state>> {
  /** The item produced by a cell value. */
  readonly [type_item]: unknown;
  /** The stateful computation represented by a cell value. */
  readonly [type_data]: State<state, this[typeof type_item]>;
  /** Wraps a stateful computation addressed to this cell. */
  <item>(value: State<state, item>): CellValue<key, state, item>;
  /** Reads this cell. */
  get(): CellValue<key, state, state>;
  /** Replaces this cell. */
  put(value: state): CellValue<key, state, void>;
  /** Updates this cell with a pure function. */
  modify(fn: (value: state) => state): CellValue<key, state, void>;
  /** Selects an item from this cell without changing it. */
  gets<item>(fn: (value: state) => item): CellValue<key, state, item>;
}

/** A State computation wrapped with its cell's dictionary. */
export type CellValue<key extends PropertyKey, state, item> = WrappedData<
  AsCell<key, state>,
  State<state, item>,
  item
>;

/**
 * Declares a keyed state cell.
 *
 * A cell has its own runtime kind and its own type identity, so it is handled
 * by its own `run_state` and is invisible to every other cell and to the
 * anonymous `get`/`put` operations. Name the cell, then give its state type:
 *
 * ```ts
 * const counter = state<"counter", number>();
 * const cursor = state<"cursor", string>();
 * ```
 *
 * The key distinguishes cells that hold the same state type; without it,
 * `state<"counter", number>` and a second number cell would be one type. It
 * exists only in the type, so **declare each key exactly once**: two
 * declarations sharing a key are one cell to the compiler and two at runtime,
 * and the second one's lifts survive a handler the types said would discharge
 * them, throwing at the terminal `run`. A key that is not a literal carries no
 * identity at all and is rejected outright.
 */
export function state<key extends PropertyKey, state>(): [
  NominalKey<key>,
] extends [never] ? WidenedCellKey : AsCell<key, state> {
  return make_state_cell() as [NominalKey<key>] extends [never] ? WidenedCellKey
    : AsCell<key, state>;
}

function make_state_cell<key extends PropertyKey, state>(): AsCell<key, state> {
  const dictionary = cell_dictionary<AsCell<key, state>>();

  Object.defineProperties(dictionary, {
    get: {
      value: () => wrap((current: state) => [current, current] as const),
    },
    put: {
      value: (next: state) =>
        wrap((_current: state) => [undefined, next] as const),
    },
    modify: {
      value: (fn: (current: state) => state) =>
        wrap((current: state) => [undefined, fn(current)] as const),
    },
    gets: {
      value: <item>(fn: (current: state) => item) =>
        wrap((current: state) => [fn(current), current] as const),
    },
  });

  Show.instance(dictionary)({
    show() {
      return "State(?)";
    },
  });

  Functor.instance(dictionary)({
    map(fn) {
      const stateful = this.value();

      return wrap((current: state) => {
        const [value, next] = stateful(current);
        return [fn(value), next] as const;
      });
    },
  });

  Applicative.instance(dictionary)({
    pure(value) {
      return wrap((current: state) => [value, current] as const);
    },

    [applicative_lift_method](fn, rest) {
      const first = this.value();
      const stateful_values = rest.map((current) => current.value());

      return wrap((current: state) => {
        const [first_value, first_state] = first(current);
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
      const stateful = this.value();
      const applied = value.value();

      return wrap((current: state) => {
        const [fn, next] = stateful(current);
        const [item, final] = applied(next);

        return [fn(item), final] as const;
      });
    },
  });

  Monad.instance(dictionary)({
    bind(fn) {
      const stateful = this.value();

      return wrap((current: state) => {
        const [value, next] = stateful(current);
        return fn(value).value()(next);
      });
    },
  });

  return dictionary;

  function wrap<item>(
    value: State<state, item>,
  ): CellValue<key, state, item> {
    return dictionary(value);
  }
}

/** @ignore */
export type WithoutStateCell<requirements, key extends PropertyKey> =
  WithoutCell<requirements, typeof state_identity, key>;

/**
 * The state every lift of `key` in `requirements` threads.
 *
 * One `run_state` serves every operation addressed to its cell, so the initial
 * value has to satisfy all of them at once. Each lift contributes a parameter
 * position, so cells sharing a key but disagreeing on the state type collapse
 * to `never` and the program is rejected. Lifts of other cells contribute
 * nothing and stay pending.
 */
export type StateCellItem<requirements, key extends PropertyKey> = (
  requirements extends Lift<infer dictionary, infer _item>
    ? dictionary[typeof type_identity] extends
      CellIdentity<typeof state_identity, key>
      ? dictionary extends
        { readonly [type_data]: (state: infer state) => unknown }
        ? (state: state) => void
      : never
    : never
    : never
) extends (state: infer state) => void ? state : unknown;

/**
 * The state a terminal cell run needs, or `never` when the effect still carries
 * requirements that the terminal runner cannot discharge.
 */
export type TerminalStateCellItem<requirements, key extends PropertyKey> =
  [WithoutStateCell<requirements, key>] extends [never]
    ? StateCellItem<requirements, key>
    : never;

/** @ignore */
export type WithoutState<requirements> = requirements extends
  Lift<infer dictionary, infer _item>
  ? dictionary[typeof type_identity] extends typeof state_identity ? never
  : requirements
  : requirements;

/**
 * The state every State lift in `requirements` threads.
 *
 * All State lifts share one runtime dictionary, so a single `run_state` serves
 * every `get` and `put` in the program from one cell. That cell has to satisfy
 * all of them at once: each lift contributes a parameter position, so a program
 * threading several state types yields their intersection. Unrelated types
 * collapse to `never`, so the program is rejected rather than silently writing
 * through the wrong slot.
 */
export type StateItem<requirements> = (
  requirements extends Lift<infer dictionary, infer _item>
    ? dictionary[typeof type_identity] extends typeof state_identity
      ? dictionary extends
        { readonly [type_data]: (state: infer state) => unknown }
        ? (state: state) => void
      : never
    : never
    : never
) extends (state: infer state) => void ? state : unknown;

const state_lift_handler: LiftHandler<
  AsState<unknown>,
  unknown,
  unknown,
  unknown
> = {
  done(value, current_state) {
    return [value, current_state] as const;
  },
  handle(value, current_state) {
    return value.value()(current_state);
  },
};

/** Handles State lifts with an initial state. */
export function run_state<requirements, item>(
  effect: Effect<requirements, item>,
  state: StateItem<requirements>,
): Effect<
  WithoutState<requirements>,
  readonly [item, StateItem<requirements>]
>;
/** Handles one cell's lifts with an initial state. */
export function run_state<
  key extends PropertyKey,
  state,
  requirements,
  item,
>(
  cell: AsCell<key, state>,
  effect: Effect<requirements, item>,
  initial: NoInfer<state> & StateCellItem<requirements, key>,
): Effect<
  WithoutStateCell<requirements, key>,
  readonly [item, state & StateCellItem<requirements, key>]
>;
export function run_state(
  ...args:
    | readonly [Effect<unknown, unknown>, unknown]
    | readonly [AsCell<PropertyKey, unknown>, Effect<unknown, unknown>, unknown]
): Effect<unknown, unknown> {
  if (args.length === 2) {
    const [effect, initial] = args;

    return handle_lift(effect, state_kind, initial, state_lift_handler);
  }

  const [cell, effect, initial] = args;

  return handle_lift(
    effect,
    cell[kind] as AsState<unknown>[typeof kind],
    initial,
    state_lift_handler,
  );
}

/**
 * The state a terminal run needs, or `never` when the effect still carries
 * requirements that `run_state_terminal` cannot discharge.
 */
export type TerminalStateItem<requirements> =
  [WithoutState<requirements>] extends [never] ? StateItem<requirements>
    : never;

/** Runs one State value or an effect containing only State lifts. */
export function run_state_terminal<state, item>(
  stateful: StateValue<state, item>,
  state: state,
): readonly [item, state];
/** Runs an effect containing only State lifts. */
export function run_state_terminal<requirements, item>(
  effect: Effect<requirements, item>,
  state: TerminalStateItem<requirements>,
): readonly [item, StateItem<requirements>];
/** Runs a State value or an effect containing only State lifts. */
export function run_state_terminal<requirements, state, item>(
  value:
    | StateValue<state, item>
    | Effect<requirements, item>,
  state: state & TerminalStateItem<requirements>,
): readonly [item, state];
/** Runs one cell value. */
export function run_state_terminal<key extends PropertyKey, state, item>(
  cell: AsCell<key, state>,
  stateful: CellValue<key, state, item>,
  initial: state,
): readonly [item, state];
/** Runs an effect whose only remaining lifts address `cell`. */
export function run_state_terminal<
  key extends PropertyKey,
  state,
  requirements,
  item,
>(
  cell: AsCell<key, state>,
  effect: Effect<requirements, item>,
  initial: NoInfer<state> & TerminalStateCellItem<requirements, key>,
): readonly [item, state];
export function run_state_terminal(
  ...args:
    | readonly [
      StateValue<unknown, unknown> | Effect<unknown, unknown>,
      unknown,
    ]
    | readonly [
      AsCell<PropertyKey, unknown>,
      CellValue<PropertyKey, unknown, unknown> | Effect<unknown, unknown>,
      unknown,
    ]
): readonly [unknown, unknown] {
  if (args.length === 2) {
    const [effect, initial] = args;

    return run_state_kind(effect, state_kind, initial);
  }

  const [cell, effect, initial] = args;

  return run_state_kind(
    effect,
    cell[kind] as AsState<unknown>[typeof kind],
    initial,
  );
}

function run_state_kind(
  effect:
    | StateValue<unknown, unknown>
    | CellValue<PropertyKey, unknown, unknown>
    | Effect<unknown, unknown>,
  runtime_kind: AsState<unknown>[typeof kind],
  initial: unknown,
): readonly [unknown, unknown] {
  if (is_data(effect)) {
    if ((effect as Data<AsState<unknown>, unknown>)[kind] !== runtime_kind) {
      throw new TypeError("Unhandled effect operation: lift");
    }

    const [value, next] = (effect as StateValue<unknown, unknown>)
      .value()(initial);

    return [value, next];
  }

  let current = effect as Effect<Lift<AsState<unknown>, unknown>, unknown>;
  let current_state = initial;

  while (true) {
    if (!is_effect(current)) {
      throw new TypeError("Invalid effect value");
    }

    if (current[0] === "pure") {
      return [current[1], current_state];
    }

    if (current[0] !== "impure") {
      throw new TypeError("Invalid effect value");
    }

    const operation = current[1];

    if (!is_lift_of(operation, runtime_kind)) {
      throw new TypeError(
        "Unhandled effect operation: " + (operation as TaggedOperation)[0],
      );
    }

    const [value, next] = operation[1].value()(current_state);
    current = current[2](value) as Effect<
      Lift<AsState<unknown>, unknown>,
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
