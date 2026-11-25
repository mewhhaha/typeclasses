import type { Runnable } from "./data_value.ts";
import {
  type As,
  type Data,
  data,
  kind,
  type type_data,
  type type_item,
  type WrappedData,
} from "./typeclass.ts";
import { register_traversal } from "./traversal.ts";
import {
  Applicative,
  applicative_lift_method,
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
import { type CustomDoRunner, do_runner_method } from "./typeclasses/monad.ts";

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
export const Fn: FnConstructor = /* @__PURE__ */ create_fn();

/** Wrap a unary function with the Fn dictionary. */
export function fn<input, item>(value: RawFn<input, item>): Fn<input, item> {
  return Fn(value);
}

/** Lift a unary function into the function Arrow. */
export const arr: typeof fn = fn;

function create_fn(): FnConstructor {
  const Fn = data<AsFn<unknown>>(fn_identity) as FnConstructor;

  Object.defineProperty(Fn, "with_input", {
    value: <input>(): AsFn<input> => Fn as unknown as AsFn<input>,
  });

  Show.instance(Fn)({
    show() {
      return "Fn(?)";
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

  Applicative.instance(Fn)({
    pure(value) {
      return Fn((_input: unknown) => value);
    },

    [applicative_lift_method](fn, rest) {
      const first = this.value();
      const len = rest.length;
      if (len === 0) return Fn((input: unknown) => fn(first(input)));
      if (len === 1) {
        const second = rest[0].value();
        return Fn((input: unknown) => fn(first(input), second(input)));
      }
      const fns = rest.map((r) => r.value());
      return Fn((input: unknown) =>
        fn(first(input), ...fns.map((f) => f(input)))
      );
    },

    ap(value) {
      const run = this.value();
      const arg = value.value();
      return Fn((input: unknown) => run(input)(arg(input)));
    },
  });

  Monad.instance(Fn)({
    bind(fn) {
      const run = this.value();

      return Fn((input: unknown) => {
        return fn(run(input)).value()(input);
      });
    },
  });

  const c_bind = Fn.bind;
  const c_pure = Fn.pure;
  const fn_do: CustomDoRunner = (first_value, first_iterator, run) => {
    const first = first_value as Data<AsFn<unknown>, unknown>;
    if (
      first[kind] !== Fn[kind] || first.bind !== c_bind || first.pure !== c_pure
    ) return undefined;
    const first_raw = first.value();
    let claimed = false;
    return Fn((input: unknown) => {
      let iter = first_iterator;
      if (claimed) {
        iter = run();
        const head = iter.next();
        if (head.done) return head.value;
      } else claimed = true;
      let next = iter.next(first_raw(input));
      while (!next.done) {
        next = iter.next(
          (next.value as Data<AsFn<unknown>, unknown>).value()(input),
        );
      }
      return next.value;
    });
  };
  Object.defineProperty(Fn, do_runner_method, { value: fn_do });

  register_traversal(
    Fn as unknown as AsFn<unknown>,
    <from, to, result>(
      items: Iterable<from>,
      fn: (item: from) => Data<AsFn<unknown>, to>,
      build: (items: Iterable<to>) => result,
    ): Data<AsFn<unknown>, result> => {
      const fns: RawFn<unknown, to>[] = [];
      for (const item of items) {
        fns.push(fn(item).value() as RawFn<unknown, to>);
      }
      return Fn((input: unknown) => build(fns.map((f) => f(input)))) as Data<
        AsFn<unknown>,
        result
      >;
    },
    <from, to>(
      items: readonly from[],
      fn: (item: from) => Data<AsFn<unknown>, to>,
    ): Data<AsFn<unknown>, to[]> => {
      const snapshot = items.slice();
      return Fn((input: unknown) =>
        snapshot.map((item) => fn(item).value()(input) as to)
      ) as Data<AsFn<unknown>, to[]>;
    },
  );

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

  const fn_id = Fn((value: unknown) => value);

  Category.instance(Fn)({
    id<item>(this: AsFn<unknown>) {
      return fn_id as Fn<item, item>;
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
    arr: fn,

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

  return Fn;
}
