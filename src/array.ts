import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import {
  Alternative,
  Applicative,
  compare_unknown,
  Eq,
  Foldable,
  Functor,
  Monad,
  Monoid,
  Ord,
  Semigroup,
  Show,
  Traversable,
} from "./typeclasses.ts";

export type ArrayT<item> = readonly item[];

export interface AsArray
  extends
    As<AsArray>,
    Show<AsArray>,
    Eq<AsArray>,
    Functor<AsArray>,
    Applicative<AsArray>,
    Semigroup<AsArray>,
    Monoid<AsArray>,
    Alternative<AsArray>,
    Monad<AsArray>,
    Foldable<AsArray>,
    Traversable<AsArray>,
    Ord<AsArray> {
  readonly [type_item]: unknown;
  readonly [type_data]: ArrayT<this[typeof type_item]>;
}

type ArrayValue<item> = Data<AsArray, item>;

export const ArrayT: AsArray = data<AsArray>();

export function from_array<item>(items: readonly item[]): ArrayValue<item> {
  return ArrayT([...items]);
}

export function to_array<item>(array: ArrayValue<item>): item[] {
  return [...array.value()];
}

Show.instance(ArrayT)({
  show() {
    const array = this.value();
    return Deno.inspect(array);
  },
});

Eq.instance(ArrayT)({
  eq(right) {
    const left = this.value();
    const right_value = right.value();

    if (left.length !== right_value.length) {
      return false;
    }

    for (let index = 0; index < left.length; index += 1) {
      if (!Object.is(left[index], right_value[index])) {
        return false;
      }
    }

    return true;
  },
});

Ord.instance(ArrayT)({
  compare(right) {
    const left = this.value();
    const right_value = right.value();
    const length = Math.min(left.length, right_value.length);

    for (let index = 0; index < length; index += 1) {
      const order = compare_unknown(left[index], right_value[index]);

      switch (order) {
        case "eq":
          break;
        case "lt":
        case "gt":
          return order;
      }
    }

    return compare_unknown(left.length, right_value.length);
  },
});

Functor.instance(ArrayT)({
  map(fn) {
    const array = this.value();
    return ArrayT(array.map(fn));
  },
});

Applicative.instance(ArrayT)({
  pure(value) {
    return ArrayT([value]);
  },

  ap(values) {
    const fns = this.value();
    const items = values.value();

    return ArrayT(fns.flatMap((fn) => items.map(fn)));
  },
});

Semigroup.instance(ArrayT)({
  concat(right) {
    const left = this.value();
    return ArrayT([...left, ...right.value()]);
  },
});

Monoid.instance(ArrayT)({
  empty() {
    return ArrayT([]);
  },
});

Alternative.instance(ArrayT)({
  empty() {
    return ArrayT([]);
  },

  alt(right) {
    const left = this.value();
    return ArrayT([...left, ...right.value()]);
  },
});

Monad.instance(ArrayT)({
  bind(fn) {
    const array = this.value();
    return ArrayT(array.flatMap((item) => fn(item).value()));
  },
});

Foldable.instance(ArrayT)({
  fold(initial, fn) {
    const array = this.value();
    let state = initial;

    for (const item of array) {
      state = fn(state, item);
    }

    return state;
  },
});

Traversable.instance(ArrayT)({
  traverse(applicative, fn) {
    const array = this.value();

    if (array.length === 0) {
      return Applicative.pure(applicative, ArrayT([]));
    }

    let index = array.length - 1;
    let out = Functor.map(fn(array[index]), array_single);

    for (index -= 1; index >= 0; index -= 1) {
      out = Applicative.ap(Functor.map(fn(array[index]), array_prepend), out);
    }

    return out;
  },
});

function array_single<item>(item: item): ArrayValue<item> {
  return ArrayT([item]);
}

function array_prepend<item>(head: item) {
  return (tail: ArrayValue<item>) => ArrayT([head, ...tail.value()]);
}
