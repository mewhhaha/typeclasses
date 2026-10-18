import type { Runnable } from "./data_value.ts";
import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
  type WrappedData,
} from "./typeclass.ts";
import {
  Arrow,
  type ArrowContext,
  Category,
  Functor,
  Monad,
  Parse,
  Profunctor,
  type ProfunctorContext,
  Show,
} from "./typeclasses.ts";

/** @ignore */
export const fn_identity: unique symbol = /* @__PURE__ */ Symbol("fn_identity");

/** A unary function from an input to an output item. */
export type RawFn<input, item> = (value: input) => item;

/** @ignore */
export interface FnContext extends ArrowContext, ProfunctorContext {
  readonly [type_data]: AsFn<this[typeof type_item]>;
}

/** @ignore */
export interface AsFnLambda<input = unknown> {
  readonly [type_item]: unknown;
  readonly [type_data]: RawFn<input, this[typeof type_item]>;
}

/** The callable function dictionary for a fixed input type. */
export interface AsFn<input = unknown>
  extends
    As<AsFnLambda<input>, typeof fn_identity>,
    Show<AsFn<input>>,
    Monad<AsFn<input>>,
    Profunctor<AsFn<input>, input, FnContext>,
    Arrow<AsFn<input>, input, FnContext>,
    Parse<AsFn<input>>,
    Runnable {
}

/** A wrapped function with its typeclass instances attached. */
export type Fn<input, item> = Data<AsFn<input>, item>;

/** @ignore */
export type FnConstructor =
  & {
    <input, item>(value: RawFn<input, item>): Fn<input, item>;
    with_input<input>(): AsFn<input>;
  }
  & {
    readonly [key in keyof AsFn<unknown>]: AsFn<unknown>[key];
  };

/** The shared callable dictionary for wrapped functions. */
export const Fn = data<AsFn<unknown>>(fn_identity) as FnConstructor;

Object.defineProperty(Fn, "with_input", {
  value: fn_with_input,
});

function fn_with_input<input>(): AsFn<input> {
  return Fn as unknown as AsFn<input>;
}

/** Wrap a unary function with the Fn dictionary. */
export function fn<input, item>(value: RawFn<input, item>): Fn<input, item> {
  return Fn(value);
}

/** Lift a unary function into the function Arrow. */
export function arr<input, item>(
  value: RawFn<input, item>,
): Fn<input, item> {
  return fn(value);
}

Show.instance(Fn)({
  show() {
    return "Fn(?)";
  },
});

Monad.derive(Fn.with_input<unknown>())({
  pure(value) {
    return Fn((_input: unknown) => value);
  },

  bind(fn) {
    const run = this.value();

    return Fn((input: unknown) => {
      return fn(run(input)).value()(input);
    });
  },
});

Functor.instance(Fn)({
  map(output) {
    const run = this.value();

    return Fn((value: unknown) => {
      return output(run(value));
    });
  },
});

Profunctor.instance(Fn)({
  dimap<to, next_input, next_to>(
    this: Data<AsFn<unknown>, to>,
    input: (value: next_input) => unknown,
    output: (value: to) => next_to,
  ) {
    const run = this.value();

    return Fn((value: next_input) => {
      return output(run(input(value)));
    });
  },
});

Category.instance(Fn)({
  id<item>(this: AsFn<unknown>) {
    return Fn((value: item) => {
      return value;
    });
  },

  compose<to, next_input>(
    this: Data<AsFn<unknown>, to>,
    before: Data<AsFn<next_input>, unknown>,
  ) {
    const after_run = this.value();
    const before_run = before.value();

    return Fn((value: next_input) => {
      return after_run(before_run(value));
    });
  },
});

Arrow.instance(Fn)({
  arr<from, to>(
    this: AsFn<unknown>,
    fn: (value: from) => to,
  ) {
    return Fn(fn);
  },

  first<to, extra>(this: Data<AsFn<unknown>, to>) {
    const run = this.value();

    return Fn((pair: readonly [unknown, extra]) => {
      return [run(pair[0]), pair[1]] as const;
    });
  },

  second<to, extra>(this: Data<AsFn<unknown>, to>) {
    const run = this.value();

    return Fn((pair: readonly [extra, unknown]) => {
      return [pair[0], run(pair[1])] as const;
    });
  },
});

Parse.instance(Fn)({
  parse<item>(
    this: WrappedData<AsFn<unknown>, (input: string) => item, item>,
    input: string,
  ) {
    return this.value()(input);
  },
});
