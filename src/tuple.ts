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
import { inspect } from "./inspect.ts";
import { register_traversal } from "./traversal.ts";
import {
  Applicative,
  applicative_lift_method,
  Bifunctor,
  type BifunctorContext,
  Comonad,
  compare_unknown,
  Eq,
  Foldable,
  Functor,
  Monad,
  type Monoid as MonoidDictionary,
  Ord,
  Show,
  Traversable,
} from "./typeclasses.ts";
import { type CustomDoRunner, do_runner_method } from "./typeclasses/monad.ts";

/** @ignore */
export const tuple_identity: unique symbol = /* @__PURE__ */ Symbol(
  "tuple_identity",
);

/** An immutable pair whose right component is the higher-kinded value. */
export type RawTuple<left, right> = readonly [left, right];

/** @ignore */
export interface TupleBifunctorContext extends BifunctorContext {
  readonly [type_data]: AsTuple<this[typeof type_item]>;
}

/** @ignore */
export interface AsTupleLambda<left = unknown> {
  readonly [type_item]: unknown;
  readonly [type_data]: RawTuple<left, this[typeof type_item]>;
}

/** Dictionary type for tuples with a fixed left component. */
export interface AsTuple<left = unknown>
  extends
    As<AsTupleLambda<left>, typeof tuple_identity>,
    Show<AsTuple<left>>,
    Ord<AsTuple<left>>,
    Bifunctor<AsTuple<left>, left, TupleBifunctorContext>,
    Traversable<AsTuple<left>>,
    Comonad<AsTuple<left>> {
}

/** A wrapped tuple with explicit left and right component types. */
export type Tuple<left, right> = Data<AsTuple<left>, right>;

/** @ignore */
export interface AsTupleMonoidLambda<output extends Dictionary, left> {
  readonly [type_item]: unknown;
  readonly [type_data]: RawTuple<
    Data<output, left>,
    this[typeof type_item]
  >;
}

/** Tuple dictionary configured to accumulate wrapped left values with a monoid. */
export interface AsTupleMonoid<
  output extends Dictionary,
  left,
> extends
  As<AsTupleMonoidLambda<output, left>, typeof tuple_identity>,
  Monad<AsTupleMonoid<output, left>> {
  /** Wrap a pair for the configured left-value dictionary. */
  <right>(
    value: RawTuple<Data<output, left>, right>,
  ): TupleMonoidValue<output, left, right>;
}

/** A tuple value whose wrapped left component accumulates monoidally. */
export type TupleMonoidValue<
  output extends Dictionary,
  left,
  right,
> = WrappedData<
  AsTupleMonoid<output, left>,
  RawTuple<Data<output, left>, right>,
  right
>;

/** A tuple dictionary configured with a monoid for its left component. */
export type TupleMonoidDictionary<
  output extends Dictionary,
  left,
> = AsTupleMonoid<output, left>;

/** A tuple dictionary specialized to one left-component type. */
export type TupleDictionary<left> = AsTuple<left>;

/** @ignore */
export type TupleConstructor =
  & {
    /** Wrap an immutable pair. */
    <left, right>(value: RawTuple<left, right>): Tuple<left, right>;
    /** Specialize tuple operations to one left-component type. */
    with_left<left>(): TupleDictionary<left>;
    /** Configure tuple applicative and monad operations to accumulate left values. */
    with_monoid<output extends MonoidDictionary<output>, left>(
      empty: Data<output, left>,
    ): TupleMonoidDictionary<output, left>;
  }
  & {
    readonly [key in keyof AsTuple<unknown>]: AsTuple<unknown>[key];
  };

/** Callable tuple dictionary with fixed-left and monoidal-left configurations. */
export const Tuple: TupleConstructor = /* @__PURE__ */ create_tuple();

function tuple_with_left<left>(): TupleDictionary<left> {
  return Tuple as unknown as TupleDictionary<left>;
}

function carry_add<output extends MonoidDictionary<output>, left>(
  pending: (Data<output, left> | undefined)[],
  value: Data<output, left>,
): void {
  let level = 0;
  while (pending[level] !== undefined) {
    value = pending[level]!.concat(value);
    pending[level++] = undefined;
  }
  pending[level] = value;
}

function carry_done<output extends MonoidDictionary<output>, left>(
  pending: (Data<output, left> | undefined)[],
): Data<output, left> {
  let result: Data<output, left> | undefined;
  for (let i = pending.length - 1; i >= 0; i -= 1) {
    const chunk = pending[i];
    if (chunk !== undefined) {
      result = result === undefined ? chunk : result.concat(chunk);
    }
  }
  return result!;
}

function tuple_with_monoid<
  output extends MonoidDictionary<output>,
  left,
>(empty: Data<output, left>): TupleMonoidDictionary<output, left> {
  const dictionary = data<AsTupleMonoid<output, left>>(tuple_identity);

  Functor.instance(dictionary)({
    map(fn) {
      const pair = this.value();
      return wrap(pair[0], fn(pair[1]));
    },
  });

  Applicative.instance(dictionary)({
    pure(value) {
      return wrap(empty.empty(), value);
    },

    [applicative_lift_method](fn, rest) {
      const [out0, first] = this.value();
      const len = rest.length;
      if (len === 0) return wrap(out0, fn(first));
      if (len === 1) {
        const pair = rest[0].value();
        return wrap(out0.concat(pair[0]), fn(first, pair[1]));
      }
      const values = [first];
      let combined = out0;
      for (let i = 0; i < len; i += 1) {
        const pair = rest[i].value();
        combined = combined.concat(pair[0]);
        values.push(pair[1]);
      }
      return wrap(combined, fn(...values));
    },

    ap(value) {
      const a = this.value();
      const b = value.value();
      return wrap(a[0].concat(b[0]), a[1](b[1]));
    },
  });

  Monad.instance(dictionary)({
    bind(fn) {
      const a = this.value();
      const b = fn(a[1]).value();
      return wrap(a[0].concat(b[0]), b[1]);
    },
  });

  const c_bind = dictionary.bind;
  const c_pure = dictionary.pure;
  const tuple_do: CustomDoRunner = (first_value, first_iterator) => {
    const first = first_value as TupleMonoidValue<output, left, unknown>;
    if (
      first[kind] !== dictionary[kind] || first.bind !== c_bind ||
      first.pure !== c_pure
    ) return undefined;
    const [o0, v0] = first.value();
    const pending: (Data<output, left> | undefined)[] = [o0];
    let next = first_iterator.next(v0);
    while (!next.done) {
      const pair = (next.value as TupleMonoidValue<output, left, unknown>)
        .value();
      carry_add(pending, pair[0]);
      next = first_iterator.next(pair[1]);
    }
    return wrap(carry_done(pending), next.value);
  };
  Object.defineProperty(dictionary, do_runner_method, { value: tuple_do });

  const traverse_impl = <from, to, result>(
    items: Iterable<from>,
    fn: (item: from) => Data<AsTupleMonoid<output, left>, to>,
    build?: (items: Iterable<to>) => result,
  ): Data<AsTupleMonoid<output, left>, result> => {
    const pending: (Data<output, left> | undefined)[] = [];
    const out: to[] = [];
    for (const item of items) {
      const pair = fn(item).value();
      carry_add(pending, pair[0]);
      out.push(pair[1]);
    }
    return wrap(
      pending.length === 0 ? empty.empty<left>() : carry_done(pending),
      build ? build(out) : out as unknown as result,
    );
  };
  register_traversal(dictionary, traverse_impl, traverse_impl as never);

  return dictionary;

  function wrap<right>(
    output: Data<output, left>,
    value: right,
  ): TupleMonoidValue<output, left, right> {
    return dictionary([output, value] as const);
  }
}

/** Wrap two components as an immutable tuple value. */
export function tuple<left, right>(
  left: left,
  right: right,
): Tuple<left, right> {
  return Tuple([left, right] as const) as Tuple<left, right>;
}

/** Read the left component of a wrapped tuple. */
export function fst<left, right>(value: Tuple<left, right>): left {
  return value.value()[0];
}

/** Read the right component of a wrapped tuple. */
export function snd<left, right>(value: Tuple<left, right>): right {
  return value.value()[1];
}

/** Swap the components of a wrapped tuple. */
export function swap<left, right>(
  value: Tuple<left, right>,
): Tuple<right, left> {
  const pair = value.value();
  return tuple(pair[1], pair[0]);
}

function create_tuple(): TupleConstructor {
  const Tuple = data<AsTuple<unknown>>(
    tuple_identity,
  ) as unknown as TupleConstructor;

  Object.defineProperties(Tuple, {
    with_left: { value: tuple_with_left },
    with_monoid: { value: tuple_with_monoid },
  });

  Show.instance(Tuple)({
    show() {
      const pair = this.value();
      return "Tuple(" + inspect(pair[0]) + ", " + inspect(pair[1]) + ")";
    },
  });

  Eq.instance(Tuple)({
    eq(right) {
      if (this === right) return true;
      const a = this.value();
      const b = right.value();
      return Object.is(a[0], b[0]) && Object.is(a[1], b[1]);
    },
  });

  Ord.instance(Tuple)({
    compare(right) {
      if (this === right) return "eq";
      const a = this.value();
      const b = right.value();
      const first_order = compare_unknown(a[0], b[0]);
      return first_order === "eq" ? compare_unknown(a[1], b[1]) : first_order;
    },
  });

  Bifunctor.instance(Tuple)({
    bimap<right, next_left, next_right>(
      this: Data<AsTuple<unknown>, right>,
      map_left: (value: unknown) => next_left,
      map_right: (value: right) => next_right,
    ) {
      const pair = this.value();
      return tuple(map_left(pair[0]), map_right(pair[1]));
    },
  });

  Functor.instance(Tuple)({
    map(fn) {
      const pair = this.value();
      return tuple(pair[0], fn(pair[1]));
    },
  });

  Foldable.instance(Tuple)({
    fold(initial, fn) {
      return fn(initial, this.value()[1]);
    },
  });

  Traversable.instance(Tuple)({
    traverse(_applicative, fn) {
      const pair = this.value();
      const left = pair[0];
      return Functor.map(fn(pair[1]), (value) => tuple(left, value));
    },
  });

  Comonad.instance(Tuple)({
    extract() {
      return this.value()[1];
    },

    extend(fn) {
      return tuple(this.value()[0], fn(this));
    },
  });

  return Tuple;
}
