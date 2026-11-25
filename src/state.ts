import type { Runnable } from "./data_value.ts";
import {
  bind_state_computation,
  map_state_computation,
} from "./computation.ts";
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
  is_effect,
  is_lift_of,
  type Lift,
  pure,
  suspend,
  type TaggedOperation,
} from "./effects.ts";
import {
  cell_dictionary,
  type CellIdentity,
  type NominalKey,
  type WithoutCell,
} from "./cell.ts";
import { register_traversal } from "./traversal.ts";
import {
  Applicative,
  applicative_lift_method,
  Functor,
  Monad,
  Show,
} from "./typeclasses.ts";
import { type CustomDoRunner, do_runner_method } from "./typeclasses/monad.ts";

/** @ignore */
export const state_identity: unique symbol = /* @__PURE__ */ Symbol(
  "state_identity",
);

/** A computation that produces an item while threading state. */
export type RawState<state, item> = (state: state) => readonly [item, state];

/** @ignore */
export interface AsStateLambda<state> {
  readonly [type_item]: unknown;
  readonly [type_data]: RawState<state, this[typeof type_item]>;
}

/** The callable State dictionary for one state type. */
export interface AsState<state>
  extends
    As<AsStateLambda<state>, typeof state_identity>,
    Show<AsState<state>>,
    Monad<AsState<state>>,
    Runnable {
  /** Wraps a stateful computation. */
  <item>(value: RawState<state, item>): State<state, item>;
}

/** A State computation wrapped with its typeclass dictionary. */
export type State<state, item> = WrappedData<
  AsState<state>,
  RawState<state, item>,
  item
>;

/** @ignore */
export type StateConstructor =
  & AsState<unknown>
  & {
    <state, item>(value: RawState<state, item>): State<state, item>;
    /** Selects the state type for pure values and generic operations. */
    with_state<state>(): AsState<state>;
  };

/** The State dictionary and constructor. */
export const State = data<AsState<unknown>>(state_identity) as StateConstructor;
const state_kind = State[kind];

Object.defineProperty(State, "with_state", {
  value: <state>(): AsState<state> => State as unknown as AsState<state>,
});

function read_state<state>(state: state): readonly [state, state] {
  return [state, state];
}

/** Reads the current state. */
export function get<state>(): State<state, state> {
  return State(read_state) as State<state, state>;
}

/** Replaces the current state. */
export function put<state>(state: state): State<state, void> {
  return State((_previous: state) => [undefined, state]);
}

/** Updates the current state with a pure function. */
export function modify<state>(
  fn: (state: state) => state,
): State<state, void> {
  return State((state: state) => [undefined, fn(state)]);
}

/** Selects an item from the current state without changing it. */
export function gets<state, item>(
  fn: (state: state) => item,
): State<state, item> {
  return State((state: state) => [fn(state), state]);
}

/** @ignore */
export interface AsCellLambda<state> {
  readonly [type_item]: unknown;
  readonly [type_data]: RawState<state, this[typeof type_item]>;
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
    As<AsCellLambda<state>, CellIdentity<typeof state_identity, key>>,
    Show<AsCell<key, state>>,
    Monad<AsCell<key, state>>,
    Runnable {
  /** Wraps a stateful computation addressed to this cell. */
  <item>(value: RawState<state, item>): CellValue<key, state, item>;
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
  RawState<state, item>,
  item
>;

/**
 * Declare a State cell without repeating its key in type arguments:
 * `const counter = state<number>()("counter")`.
 */
export function state<state>(): <const key extends PropertyKey>(
  key: key & NominalKey<key>,
) => AsCell<key, state>;
/** Declare a State cell addressed by a runtime key within the State family. */
export function state<key extends PropertyKey, state>(
  key: key & NominalKey<key>,
): AsCell<key, state>;
export function state(key?: PropertyKey): unknown {
  if (arguments.length === 0) {
    return (cell_key: PropertyKey) => make_state_cell(cell_key);
  }

  return make_state_cell(key as PropertyKey);
}

function make_state_cell<key extends PropertyKey, state>(
  key: key,
): AsCell<key, state> {
  const dictionary = cell_dictionary<AsCell<key, state>>(State, key);

  Object.defineProperties(dictionary, {
    get: {
      value: () => wrap(read_state<state>),
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

      return wrap(
        map_state_computation(
          stateful,
          fn,
        ),
      );
    },
  });

  Applicative.instance(dictionary)({
    pure(value) {
      return wrap((current: state) => [value, current] as const);
    },

    [applicative_lift_method](fn, rest) {
      const first = this.value();
      const len = rest.length;

      if (len === 0) {
        return wrap((current: state) => {
          const [value, next] = first(current);
          return [fn(value), next] as const;
        });
      }
      if (len === 1) {
        const second = rest[0].value();
        return wrap((current: state) => {
          const [a, next] = first(current);
          const [b, final] = second(next);
          return [fn(a, b), final] as const;
        });
      }
      if (len === 2) {
        const second = rest[0].value();
        const third = rest[1].value();
        return wrap((current: state) => {
          const [a, next] = first(current);
          const [b, after] = second(next);
          const [c, final] = third(after);
          return [fn(a, b, c), final] as const;
        });
      }
      const stateful_values = rest.map((current) => current.value());
      return wrap((current: state) => {
        const [first_value, first_state] = first(current);
        const values = new Array<unknown>(len + 1);
        values[0] = first_value;
        let current_state = first_state;

        for (let i = 0; i < len; i += 1) {
          const [value, next_state] = stateful_values[i](current_state);
          values[i + 1] = value;
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
      return wrap(bind_state_computation(this.value(), fn));
    },
  });

  register_state_traversal(dictionary);

  return dictionary;

  function wrap<item>(
    value: RawState<state, item>,
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

function run_state_effect(
  effect: Effect<unknown, unknown>,
  runtime_kind: AsState<unknown>[typeof kind],
  initial: unknown,
): Effect<unknown, unknown> {
  let current = effect;
  let current_state = initial;

  while (true) {
    if (current[0] === "pure") {
      return pure([current[1], current_state] as const);
    }

    if (is_lift_of(current[1], runtime_kind)) {
      const lifted = (current[1] as Lift<AsState<unknown>, unknown>)[1];
      const [value, next] = lifted.value()(current_state);
      current = current[2](value);
      current_state = next;
      continue;
    }

    const suspended = current;
    const saved_state = current_state;
    return suspend(
      suspended[1],
      (value) =>
        run_state_effect(suspended[2](value), runtime_kind, saved_state),
    );
  }
}

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
  first: Effect<unknown, unknown> | AsCell<PropertyKey, unknown>,
  second: unknown,
  third?: unknown,
): Effect<unknown, unknown> {
  if (arguments.length === 2) {
    return run_state_effect(
      first as Effect<unknown, unknown>,
      state_kind,
      second,
    );
  }

  return run_state_effect(
    second as Effect<unknown, unknown>,
    (first as AsCell<PropertyKey, unknown>)[
      kind
    ] as AsState<unknown>[typeof kind],
    third,
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
  stateful: State<state, item>,
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
    | State<state, item>
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
  first:
    | State<unknown, unknown>
    | Effect<unknown, unknown>
    | AsCell<PropertyKey, unknown>,
  second: unknown,
  third?: unknown,
): readonly [unknown, unknown] {
  if (arguments.length === 2) {
    return run_state_kind(
      first as State<unknown, unknown> | Effect<unknown, unknown>,
      state_kind,
      second,
    );
  }

  return run_state_kind(
    second as
      | CellValue<PropertyKey, unknown, unknown>
      | Effect<unknown, unknown>,
    (first as AsCell<PropertyKey, unknown>)[
      kind
    ] as AsState<unknown>[typeof kind],
    third,
  );
}

function run_state_kind(
  effect:
    | State<unknown, unknown>
    | CellValue<PropertyKey, unknown, unknown>
    | Effect<unknown, unknown>,
  runtime_kind: AsState<unknown>[typeof kind],
  initial: unknown,
): readonly [unknown, unknown] {
  if (is_data(effect)) {
    if ((effect as Data<AsState<unknown>, unknown>)[kind] !== runtime_kind) {
      throw new TypeError("Unhandled effect operation: lift");
    }

    const [value, next] = (effect as State<unknown, unknown>)
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
    return State(
      map_state_computation(
        this.value(),
        fn,
      ),
    );
  },
});

Applicative.instance(State)({
  pure(value) {
    return State((state: unknown) => [value, state]);
  },

  [applicative_lift_method](fn, rest) {
    const first = this.value();
    const len = rest.length;

    if (len === 0) {
      return State((state: unknown) => {
        const [value, next] = first(state);
        return [fn(value), next] as const;
      });
    }
    if (len === 1) {
      const second = rest[0].value();
      return State((state: unknown) => {
        const [a, next] = first(state);
        const [b, final] = second(next);
        return [fn(a, b), final] as const;
      });
    }
    if (len === 2) {
      const second = rest[0].value();
      const third = rest[1].value();
      return State((state: unknown) => {
        const [a, next] = first(state);
        const [b, after] = second(next);
        const [c, final] = third(after);
        return [fn(a, b, c), final] as const;
      });
    }
    const stateful_values = rest.map((current) => current.value());
    return State((state: unknown) => {
      const [first_value, first_state] = first(state);
      const values = new Array<unknown>(len + 1);
      values[0] = first_value;
      let current_state = first_state;

      for (let i = 0; i < len; i += 1) {
        const [value, next_state] = stateful_values[i](current_state);
        values[i + 1] = value;
        current_state = next_state;
      }

      return [fn(...values), current_state] as const;
    });
  },

  ap(value) {
    const first = this.value();
    const second = value.value();
    return State((state: unknown) => {
      const [fn, next] = first(state);
      const [item, final] = second(next);

      return [fn(item), final];
    });
  },
});

Monad.instance(State)({
  bind(fn) {
    return State(bind_state_computation(this.value(), fn));
  },
});

function register_state_traversal(dictionary: unknown): void {
  const dict = dictionary as AsState<unknown> & {
    (v: RawState<unknown, unknown>): Data<AsState<unknown>, unknown>;
  };
  const d_kind = dict[kind];
  const c_bind = dict.bind;
  const c_pure = dict.pure;
  const state_do: CustomDoRunner = (first_value, first_iterator, run) => {
    const first = first_value as Data<AsState<unknown>, unknown>;
    if (
      first[kind] !== d_kind || first.bind !== c_bind || first.pure !== c_pure
    ) return undefined;
    const first_raw = first.value();
    let first_claimed = false;
    return dict((initial: unknown) => {
      const [v0, s0] = first_raw(initial);
      let current_state = s0;
      let iter: Generator<unknown, unknown, unknown>;
      let next: IteratorResult<unknown, unknown>;
      if (!first_claimed) {
        first_claimed = true;
        iter = first_iterator;
        next = iter.next(v0);
      } else {
        iter = run();
        const skipped = iter.next();
        if (skipped.done) return [skipped.value, current_state] as const;
        next = iter.next(v0);
      }
      while (!next.done) {
        const [val, next_state] =
          (next.value as Data<AsState<unknown>, unknown>)
            .value()(current_state);
        current_state = next_state;
        next = iter.next(val);
      }
      return [next.value, current_state] as const;
    });
  };
  Object.defineProperty(dictionary as object, do_runner_method, {
    value: state_do,
  });
  register_traversal(
    dict,
    <from, to, result>(
      items: Iterable<from>,
      fn: (item: from) => Data<AsState<unknown>, to>,
      build: (items: Iterable<to>) => result,
    ): Data<AsState<unknown>, result> => {
      const fns: RawState<unknown, to>[] = [];
      for (const item of items) {
        fns.push(fn(item).value() as RawState<unknown, to>);
      }
      return dict((initial: unknown) => {
        const out = new Array<to>(fns.length);
        let current = initial;
        for (let i = 0; i < fns.length; i += 1) {
          const [value, next] = fns[i](current);
          out[i] = value;
          current = next;
        }
        return [build(out), current] as const;
      }) as Data<AsState<unknown>, result>;
    },
    <from, to>(
      items: readonly from[],
      fn: (item: from) => Data<AsState<unknown>, to>,
    ): Data<AsState<unknown>, to[]> => {
      const snapshot = items.slice();
      return dict((initial: unknown) => {
        const out = new Array<to>(snapshot.length);
        let current = initial;
        for (let i = 0; i < snapshot.length; i += 1) {
          const [value, next] = fn(snapshot[i]).value()(current);
          out[i] = value as to;
          current = next;
        }
        return [out, current] as const;
      }) as Data<AsState<unknown>, to[]>;
    },
  );
}

register_state_traversal(State);
