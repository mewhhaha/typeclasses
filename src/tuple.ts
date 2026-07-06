import {
  type As,
  data,
  type type_data,
  type type_item,
  type WrappedData,
} from "./typeclass.ts";
import {
  Bifunctor,
  Comonad,
  compare_unknown,
  Eq,
  Foldable,
  Functor,
  Ord,
  Show,
  Traversable,
} from "./typeclasses.ts";

export type Tuple<left, right> = readonly [left, right];

export interface AsTuple
  extends
    As<AsTuple>,
    Show<AsTuple>,
    Eq<AsTuple>,
    Ord<AsTuple>,
    Bifunctor<AsTuple>,
    Functor<AsTuple>,
    Foldable<AsTuple>,
    Traversable<AsTuple>,
    Comonad<AsTuple> {
  readonly [type_item]: unknown;
  readonly [type_data]: Tuple<unknown, this[typeof type_item]>;
}

export type TupleValue<left, right> = WrappedData<
  AsTuple,
  Tuple<left, right>,
  right
>;

type TupleConstructor =
  & AsTuple
  & {
    <left, right>(value: Tuple<left, right>): TupleValue<left, right>;
  };

export const Tuple = data<AsTuple>() as TupleConstructor;

export function tuple<left, right>(
  left: left,
  right: right,
): TupleValue<left, right> {
  return Tuple([left, right] as const) as TupleValue<left, right>;
}

export function fst<left, right>(value: TupleValue<left, right>): left {
  return value.value()[0];
}

export function snd<left, right>(value: TupleValue<left, right>): right {
  return value.value()[1];
}

export function swap<left, right>(
  value: TupleValue<left, right>,
): TupleValue<right, left> {
  const [left, right] = value.value();

  return tuple(right, left);
}

Show.instance(Tuple)({
  show() {
    const [left, right] = this.value();

    return "Tuple(" + Deno.inspect(left) + ", " + Deno.inspect(right) + ")";
  },
});

Eq.instance(Tuple)({
  eq(right) {
    const [left_first, left_second] = this.value();
    const [right_first, right_second] = right.value();

    if (!Object.is(left_first, right_first)) {
      return false;
    }

    return Object.is(left_second, right_second);
  },
});

Ord.instance(Tuple)({
  compare(right) {
    const [left_first, left_second] = this.value();
    const [right_first, right_second] = right.value();
    const first_order = compare_unknown(left_first, right_first);

    switch (first_order) {
      case "eq":
        return compare_unknown(left_second, right_second);
      case "lt":
      case "gt":
        return first_order;
    }
  },
});

Bifunctor.instance(Tuple)({
  bimap<raw, left, right, next_left, next_right>(
    this: WrappedData<AsTuple, raw, right>,
    map_left: (value: left) => next_left,
    map_right: (value: right) => next_right,
  ) {
    const [left, right] = this.value() as Tuple<left, right>;

    return unknown_typeclass<next_right>(
      tuple(map_left(left), map_right(right)),
    );
  },
});

Functor.instance(Tuple)({
  map(fn) {
    const [left, right] = this.value();

    return tuple(left, fn(right));
  },
});

Foldable.instance(Tuple)({
  fold(initial, fn) {
    const [_left, right] = this.value();

    return fn(initial, right);
  },
});

Traversable.instance(Tuple)({
  traverse(_applicative, fn) {
    const [left, right] = this.value();

    return Functor.map(fn(right), (value) => tuple(left, value));
  },
});

Comonad.instance(Tuple)({
  extract() {
    const [_left, right] = this.value();

    return right;
  },

  extend(fn) {
    const [left] = this.value();

    return tuple(left, fn(this));
  },
});

function unknown_typeclass<item>(
  value: unknown,
): WrappedData<AsTuple, unknown, item> {
  return value as WrappedData<AsTuple, unknown, item>;
}
