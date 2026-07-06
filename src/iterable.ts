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
  Eq,
  Foldable,
  Functor,
  Monad,
  Monoid,
  Semigroup,
  Show,
  Traversable,
} from "./typeclasses.ts";

export type IterableT<item> = () => Iterable<item>;

export interface AsIterable
  extends
    As<AsIterable>,
    Show<AsIterable>,
    Eq<AsIterable>,
    Functor<AsIterable>,
    Applicative<AsIterable>,
    Semigroup<AsIterable>,
    Monoid<AsIterable>,
    Alternative<AsIterable>,
    Monad<AsIterable>,
    Foldable<AsIterable>,
    Traversable<AsIterable> {
  readonly [type_item]: unknown;
  readonly [type_data]: IterableT<this[typeof type_item]>;
}

type IterableValue<item> = Data<AsIterable, item>;

export const IterableT = data<AsIterable>();

export function from_factory<item>(
  factory: () => Iterable<item>,
): IterableValue<item> {
  return IterableT(factory);
}

export function from_iterable<item>(
  iterable: Iterable<item>,
): IterableValue<item> {
  const items = [...iterable];
  return IterableT(() => items);
}

export function to_array<item>(iterable: IterableValue<item>): item[] {
  return [...iterable.value()()];
}

Show.instance(IterableT)({
  show() {
    return Deno.inspect([...this.value()()]);
  },
});

Eq.instance(IterableT)({
  eq(right) {
    const left_iterator = this.value()()[Symbol.iterator]();
    const right_iterator = right.value()()[Symbol.iterator]();

    while (true) {
      const left = left_iterator.next();
      const right = right_iterator.next();

      if (left.done === true || right.done === true) {
        return left.done === right.done;
      }

      if (!Object.is(left.value, right.value)) {
        return false;
      }
    }
  },
});

Functor.instance(IterableT)({
  map(fn) {
    const source = this.value();

    return IterableT(function* () {
      for (const item of source()) {
        yield fn(item);
      }
    });
  },
});

Applicative.instance(IterableT)({
  pure(value) {
    return IterableT(function* () {
      yield value;
    });
  },

  ap(values) {
    const fns = this.value();
    const items = values.value();

    return IterableT(function* () {
      for (const fn of fns()) {
        for (const item of items()) {
          yield fn(item);
        }
      }
    });
  },
});

Semigroup.instance(IterableT)({
  concat(right) {
    const left = this.value();
    const right_value = right.value();

    return IterableT(function* () {
      yield* left();
      yield* right_value();
    });
  },
});

Monoid.instance(IterableT)({
  empty() {
    return IterableT(function* () {});
  },
});

Alternative.instance(IterableT)({
  empty() {
    return IterableT(function* () {});
  },

  alt(right) {
    const left = this.value();
    const right_value = right.value();

    return IterableT(function* () {
      yield* left();
      yield* right_value();
    });
  },
});

Monad.instance(IterableT)({
  bind(fn) {
    const source = this.value();

    return IterableT(function* () {
      for (const item of source()) {
        yield* fn(item).value()();
      }
    });
  },
});

Foldable.instance(IterableT)({
  fold(initial, fn) {
    let state = initial;

    for (const item of this.value()()) {
      state = fn(state, item);
    }

    return state;
  },
});

Traversable.instance(IterableT)({
  traverse(applicative, fn) {
    const items = [...this.value()()];

    if (items.length === 0) {
      return Applicative.pure(applicative, IterableT(function* () {}));
    }

    let index = items.length - 1;
    let out = Functor.map(fn(items[index]), iterable_single);

    for (index -= 1; index >= 0; index -= 1) {
      out = Applicative.ap(
        Functor.map(fn(items[index]), iterable_prepend),
        out,
      );
    }

    return out;
  },
});

function iterable_single<item>(item: item): IterableValue<item> {
  return IterableT(function* () {
    yield item;
  });
}

function iterable_prepend<item>(head: item) {
  return (tail: IterableValue<item>) => {
    return IterableT(function* () {
      yield head;
      yield* tail.value()();
    });
  };
}
