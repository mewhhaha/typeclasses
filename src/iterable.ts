import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { append_item } from "./internal.ts";
import { inspect } from "./inspect.ts";
import {
  Alternative,
  Applicative,
  applicative_lift_method,
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
    Monoid<AsIterable>,
    Alternative<AsIterable>,
    Monad<AsIterable>,
    Traversable<AsIterable> {
  readonly [type_item]: unknown;
  readonly [type_data]: IterableT<this[typeof type_item]>;
}

type IterableValue<item> = Data<AsIterable, item>;

export const IterableT: AsIterable = data<AsIterable>();

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
    return inspect([...this.value()()]);
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

  // The specialized ladder avoids the generic applicative_lift fallback's intermediates.
  [applicative_lift_method](fn, rest) {
    const first = this.value();

    switch (rest.length) {
      case 0:
        return IterableT(function* () {
          for (const value of first()) {
            yield fn(value);
          }
        });
      case 1:
        return lift_iterable_two(fn, first, rest[0].value());
      case 2:
        return lift_iterable_three(
          fn,
          first,
          rest[0].value(),
          rest[1].value(),
        );
      default:
        return lift_iterable_many(fn, first, rest);
    }
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

function lift_iterable_two<out>(
  fn: (...values: unknown[]) => out,
  first: IterableT<unknown>,
  second: IterableT<unknown>,
): IterableValue<out> {
  return IterableT(function* () {
    for (const left of first()) {
      for (const right of second()) {
        yield fn(left, right);
      }
    }
  });
}

function lift_iterable_three<out>(
  fn: (...values: unknown[]) => out,
  first: IterableT<unknown>,
  second: IterableT<unknown>,
  third: IterableT<unknown>,
): IterableValue<out> {
  return IterableT(function* () {
    for (const left of first()) {
      for (const middle of second()) {
        for (const right of third()) {
          yield fn(left, middle, right);
        }
      }
    }
  });
}

function lift_iterable_many<out>(
  fn: (...values: unknown[]) => out,
  first: IterableT<unknown>,
  rest: readonly IterableValue<unknown>[],
): IterableValue<out> {
  const sources = [
    first,
    ...rest.map((current) => current.value()),
  ];

  return IterableT(function* () {
    yield* iterate_iterable_product(fn, sources, 0, []);
  });
}

function* iterate_iterable_product<out>(
  fn: (...values: unknown[]) => out,
  sources: readonly IterableT<unknown>[],
  index: number,
  values: readonly unknown[],
): Generator<out> {
  if (index >= sources.length) {
    yield fn(...values);
    return;
  }

  for (const item of sources[index]()) {
    yield* iterate_iterable_product(
      fn,
      sources,
      index + 1,
      append_item(values, item),
    );
  }
}
