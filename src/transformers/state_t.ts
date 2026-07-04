import { define, type Dictionary, type Trait, type Value } from "../trait.ts";
import { Applicative, Format, Functor, Monad } from "../traits.ts";

export type StateT<
  base extends Dictionary,
  state,
  item,
> = (state: state) => Value<base, readonly [item, state]>;

export const state_t_kind = Symbol("StateT");

declare module "../trait.ts" {
  interface TraitTypes<dictionary, item> {
    [state_t_kind]: dictionary extends AsStateT<infer base, infer state>
      ? StateT<base, state, item>
      : never;
  }
}

export interface AsStateT<
  base extends Dictionary,
  state,
> extends Dictionary<typeof state_t_kind> {
  readonly base: Value<base, unknown>;
  <item>(value: StateT<base, state, item>): StateTValue<base, state, item>;
}

export type StateTValue<
  base extends Dictionary,
  state,
  item,
> = Trait<
  AsStateT<base, state>,
  StateT<base, state, item>,
  item
>;

export type StateTConstructor<base extends Monad<base>> =
  & AsStateT<base, unknown>
  & {
    <state, item>(
      value: StateT<base, state, item>,
    ): StateTValue<base, state, item>;
    get<state>(): StateTValue<base, state, state>;
    put<state>(state: state): StateTValue<base, state, void>;
    modify<state>(
      fn: (state: state) => state,
    ): StateTValue<base, state, void>;
    gets<state, item>(
      fn: (state: state) => item,
    ): StateTValue<base, state, item>;
    lift<state, item>(
      value: Value<base, item>,
    ): StateTValue<base, state, item>;
    run<state, item>(
      stateful: Value<AsStateT<base, state>, item>,
      state: state,
    ): Value<base, readonly [item, state]>;
    eval<state, item>(
      stateful: Value<AsStateT<base, state>, item>,
      state: state,
    ): Value<base, item>;
    exec<state, item>(
      stateful: Value<AsStateT<base, state>, item>,
      state: state,
    ): Value<base, state>;
  };

export function StateT<base extends Monad<base>>(
  base: Value<base, unknown>,
): StateTConstructor<base> {
  const target = define<AsStateT<base, unknown>>(
    state_t_kind,
  ) as StateTConstructor<base>;

  Object.defineProperty(target, "base", {
    enumerable: true,
    value: base,
  });

  target.get = function get<state>() {
    return target((state: state) => {
      return Applicative.pure(base, [state, state] as const);
    });
  };
  target.put = function put<state>(state: state) {
    return target((_previous: state) => {
      return Applicative.pure(base, [undefined, state] as const);
    });
  };
  target.modify = function modify<state>(fn: (state: state) => state) {
    return target((state: state) => {
      return Applicative.pure(base, [undefined, fn(state)] as const);
    });
  };
  target.gets = function gets<state, item>(fn: (state: state) => item) {
    return target((state: state) => {
      return Applicative.pure(base, [fn(state), state] as const);
    });
  };
  target.lift = function lift<state, item>(value: Value<base, item>) {
    return target((state: state) => {
      return Functor.map(value, (item) => [item, state] as const);
    });
  };
  target.run = run_state_t;
  target.eval = eval_state_t;
  target.exec = exec_state_t;

  Format.implement(target)({
    fmt() {
      return "StateT(?)";
    },
  });

  Functor.implement(target)({
    map(fn) {
      return target((state: unknown) => {
        return Functor.map(run_state_t(this, state), ([value, next]) => {
          return [fn(value), next] as const;
        });
      });
    },
  });

  Applicative.implement(target)({
    pure(value) {
      return target((state: unknown) => {
        return Applicative.pure(base, [value, state] as const);
      });
    },

    ap(value) {
      return target((state: unknown) => {
        return Monad.bind(run_state_t(this, state), ([fn, next]) => {
          return Functor.map(run_state_t(value, next), ([item, final]) => {
            return [fn(item), final] as const;
          });
        });
      });
    },
  });

  Monad.implement(target)({
    bind(fn) {
      return target((state: unknown) => {
        return Monad.bind(run_state_t(this, state), ([value, next]) => {
          return run_state_t(fn(value), next);
        });
      });
    },
  });

  return target;
}

export interface AsStateT<base extends Dictionary, state>
  extends
    Format<AsStateT<base, state>>,
    Functor<AsStateT<base, state>>,
    Applicative<AsStateT<base, state>>,
    Monad<AsStateT<base, state>> {}

export function run_state_t<base extends Dictionary, state, item>(
  stateful: Value<AsStateT<base, state>, item>,
  state: state,
): Value<base, readonly [item, state]> {
  return stateful.value()(state);
}

export function eval_state_t<base extends Monad<base>, state, item>(
  stateful: Value<AsStateT<base, state>, item>,
  state: state,
): Value<base, item> {
  return run_state_t(stateful, state).map(([item]) => item);
}

export function exec_state_t<base extends Monad<base>, state, item>(
  stateful: Value<AsStateT<base, state>, item>,
  state: state,
): Value<base, state> {
  return run_state_t(stateful, state).map(([_item, state]) => state);
}
