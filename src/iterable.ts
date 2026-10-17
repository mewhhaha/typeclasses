import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { traverse_items } from "./traversal.ts";
import { inspect } from "./inspect.ts";
import {
  Alternative,
  Applicative,
  applicative_lift_method,
  Eq,
  fold_while_method,
  Foldable,
  Functor,
  Monad,
  Monoid,
  Semigroup,
  Show,
  Traversable,
} from "./typeclasses.ts";

/** @ignore */
export declare const iterable_identity: unique symbol;

/** A factory that supplies the iterable wrapped by the dictionary. */
export type IterableT<item> = () => Iterable<item>;

/** Dictionary type for lazy synchronous iterable factories. */
export interface AsIterable
  extends
    As<AsIterable, typeof iterable_identity>,
    Show<AsIterable>,
    Eq<AsIterable>,
    Monoid<AsIterable>,
    Alternative<AsIterable>,
    Monad<AsIterable>,
    Traversable<AsIterable> {
  /** Higher-kinded slot for the yielded value type. */
  readonly [type_item]: unknown;
  /** Iterable factory at the selected value type. */
  readonly [type_data]: IterableT<this[typeof type_item]>;
  /** Lazily keep matching items, preserving type-guard narrowing. */
  filter<item, narrowed extends item>(
    this: IterableValue<item>,
    predicate: (item: item) => item is narrowed,
  ): IterableValue<narrowed>;
  /** Lazily keep matching items. */
  filter<item>(
    this: IterableValue<item>,
    predicate: (item: item) => boolean,
  ): IterableValue<item>;
  /** Yield at most count items, closing the upstream iterator on early exit. */
  take<item>(this: IterableValue<item>, count: number): IterableValue<item>;
}

/** @ignore */
export type IterableValue<item> = Data<AsIterable, item>;

/** Callable iterable dictionary with lazy list-like typeclass instances. */
export const IterableT: AsIterable = data<AsIterable>();

/** Wrap a factory whose iterable is requested for each traversal. */
export function from_factory<item>(
  factory: () => Iterable<item>,
): IterableValue<item> {
  return IterableT(factory);
}

/** Wrap a live array view without copying; later source mutations are visible. */
export function from_array<item>(
  items: readonly item[],
): IterableValue<item> {
  return IterableT(() => items);
}

/** Snapshot an iterable so the wrapped value can be traversed repeatedly. */
export function from_iterable<item>(
  iterable: Iterable<item>,
): IterableValue<item> {
  const items = [...iterable];
  return IterableT(() => items);
}

/** Materialize a wrapped iterable into a mutable array. */
export function to_array<item>(iterable: IterableValue<item>): item[] {
  return [...iterable.value()()];
}

/** Lazily keep matching items, preserving type-guard narrowing. */
export function filter<item, narrowed extends item>(
  iterable: IterableValue<item>,
  predicate: (item: NoInfer<item>) => item is narrowed,
): IterableValue<narrowed>;
/** Lazily keep matching items. */
export function filter<item>(
  iterable: IterableValue<item>,
  predicate: (item: NoInfer<item>) => boolean,
): IterableValue<item>;
export function filter<item>(
  iterable: IterableValue<item>,
  predicate: (item: item) => boolean,
): IterableValue<item> {
  return pipeline(iterable, {
    tag: "filter",
    fn: predicate as (item: unknown) => boolean,
  });
}

/**
 * Yield at most count items without reading ahead, closing upstream on early
 * exit. Count must be a nonnegative safe integer; zero never opens the source.
 */
export function take<item>(
  iterable: IterableValue<item>,
  count: number,
): IterableValue<item> {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError("take count must be a nonnegative safe integer");
  }
  return pipeline(iterable, { tag: "take", count });
}

function filter_method<item, narrowed extends item>(
  this: IterableValue<item>,
  predicate: (item: item) => item is narrowed,
): IterableValue<narrowed>;
function filter_method<item>(
  this: IterableValue<item>,
  predicate: (item: item) => boolean,
): IterableValue<item>;
function filter_method<item>(
  this: IterableValue<item>,
  predicate: (item: item) => boolean,
): IterableValue<item> {
  return filter(this, predicate);
}

IterableT.filter = filter_method;
IterableT.take = function <item>(
  this: IterableValue<item>,
  count: number,
): IterableValue<item> {
  return take(this, count);
};

Show.instance(IterableT)({
  show() {
    const items = preview(this, 100);
    if (items.length === 100) return inspect(items) + " (preview limit 100)";
    return inspect(items);
  },
});

Eq.instance(IterableT)({
  eq(right) {
    const left_iterator = this.value()()[Symbol.iterator]();
    let right_iterator: Iterator<unknown> | undefined;

    let left_done = false;
    let right_done = false;

    try {
      right_iterator = right.value()()[Symbol.iterator]();
      while (true) {
        const left = left_iterator.next();
        left_done = left.done === true;
        const right = right_iterator.next();
        right_done = right.done === true;

        if (left_done || right_done) {
          return left_done === right_done;
        }

        if (!Object.is(left.value, right.value)) {
          return false;
        }
      }
    } finally {
      try {
        if (!left_done) left_iterator.return?.();
      } finally {
        if (!right_done) right_iterator?.return?.();
      }
    }
  },
});

Functor.instance(IterableT)({
  map(fn) {
    return pipeline(this, { tag: "map", fn: fn as (item: unknown) => unknown });
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
  empty: empty_iterable,
});

Alternative.instance(IterableT)({
  empty: empty_iterable,

  alt(right) {
    const left = this.value();
    const right_value = right.value();

    return IterableT(function* () {
      yield* left();
      yield* right_value();
    });
  },
});

function empty_iterable<item>(this: AsIterable): Data<AsIterable, item> {
  return IterableT(function* () {});
}

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
  [fold_while_method](initial, fn) {
    let state = initial;
    for (const item of this.value()()) {
      const [tag, next] = fn(state, item);
      state = next;
      if (tag === "Done") return state;
    }
    return state;
  },

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
    return Functor.map(
      traverse_items(this.value()(), applicative, fn),
      (items) => IterableT(() => items),
    );
  },
});

function lift_iterable_two<output>(
  fn: (...values: unknown[]) => output,
  first: IterableT<unknown>,
  second: IterableT<unknown>,
): IterableValue<output> {
  return IterableT(function* () {
    for (const left of first()) {
      for (const right of second()) {
        yield fn(left, right);
      }
    }
  });
}

function lift_iterable_three<output>(
  fn: (...values: unknown[]) => output,
  first: IterableT<unknown>,
  second: IterableT<unknown>,
  third: IterableT<unknown>,
): IterableValue<output> {
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

function lift_iterable_many<output>(
  fn: (...values: unknown[]) => output,
  first: IterableT<unknown>,
  rest: readonly IterableValue<unknown>[],
): IterableValue<output> {
  const sources = [
    first,
    ...rest.map((current) => current.value()),
  ];

  return IterableT(function* () {
    yield* iterate_iterable_product(fn, sources, 0, []);
  });
}

function* iterate_iterable_product<output>(
  fn: (...values: unknown[]) => output,
  sources: readonly IterableT<unknown>[],
  index: number,
  values: unknown[],
): Generator<output> {
  if (index >= sources.length) {
    yield fn(...values);
    return;
  }

  for (const item of sources[index]()) {
    values[index] = item;
    yield* iterate_iterable_product(
      fn,
      sources,
      index + 1,
      values,
    );
  }
}

type Stage =
  | { readonly tag: "map"; readonly fn: (item: unknown) => unknown }
  | { readonly tag: "filter"; readonly fn: (item: unknown) => boolean }
  | { readonly tag: "take"; readonly count: number };
type Stages = { readonly stage: Stage; readonly previous?: Stages };
type Pipeline = {
  readonly source: IterableT<unknown>;
  readonly stages: Stages;
};
const pipelines = new WeakMap<IterableT<unknown>, Pipeline>();

// One generator owns the source. Plans share immutable links; counters belong
// to each traversal, so replay and interleaved consumers remain independent.
function pipeline<from, to = from>(
  value: IterableValue<from>,
  stage: Stage,
): IterableValue<to> {
  const current = value.value();
  const previous = pipelines.get(current);
  let source: IterableT<unknown> = current;
  let stages: Stages = { stage };
  if (previous !== undefined) {
    source = previous.source;
    stages = { stage, previous: previous.stages };
  }
  const factory = function* (): Generator<to> {
    const ordered: Stage[] = [];
    let link: Stages | undefined = stages;
    while (link !== undefined) {
      ordered.push(link.stage);
      link = link.previous;
    }
    ordered.reverse();
    const remaining = ordered.map((stage) => {
      if (stage.tag === "take") return stage.count;
      return Infinity;
    });
    if (remaining.includes(0)) return;
    for (const input of source()) {
      let item = input;
      let keep = true;
      let stop = false;
      for (let index = 0; index < ordered.length; index += 1) {
        const operation = ordered[index];
        switch (operation.tag) {
          case "map":
            item = operation.fn(item);
            break;
          case "filter":
            keep = operation.fn(item);
            break;
          case "take":
            remaining[index] -= 1;
            if (remaining[index] === 0) stop = true;
            break;
        }
        if (!keep) break;
      }
      if (keep) yield item as to;
      if (stop) return;
    }
  };
  pipelines.set(factory, { source, stages });
  return IterableT(factory);
}

/** Collect at most limit items; closes the source without reading ahead. */
export function preview<item>(
  iterable: IterableValue<item>,
  limit = 100,
): item[] {
  return to_array(take(iterable, limit));
}

/** Explicit live array view; mutations are visible on the next traversal. */
export const from_array_view = from_array;
/** Explicit finite snapshot; consumes the source immediately. */
export const from_snapshot = from_iterable;
