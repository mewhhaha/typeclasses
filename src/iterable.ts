import type { Maybe } from "./maybe.ts";
import { find_method, some_method } from "./typeclasses/foldable.ts";
import type { Runnable } from "./data_value.ts";
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
export const iterable_identity: unique symbol = /* @__PURE__ */ Symbol(
  "iterable_identity",
);

/** A factory that supplies the iterable wrapped by the dictionary. */
export type RawIterableT<item> = () => Iterable<item>;

/** @ignore */
export interface AsIterableLambda {
  readonly [type_item]: unknown;
  readonly [type_data]: RawIterableT<this[typeof type_item]>;
}

/** Dictionary type for lazy synchronous iterable factories. */
export interface AsIterable
  extends
    As<AsIterableLambda, typeof iterable_identity>,
    Show<AsIterable>,
    Eq<AsIterable>,
    Monoid<AsIterable>,
    Alternative<AsIterable>,
    Monad<AsIterable>,
    Traversable<AsIterable>,
    Runnable {
  /** Lazily keep matching items, preserving type-guard narrowing. */
  filter<item, narrowed extends item>(
    this: IterableT<item>,
    predicate: (item: item) => item is narrowed,
  ): IterableT<narrowed>;
  /** Lazily keep matching items. */
  filter<item>(
    this: IterableT<item>,
    predicate: (item: item) => boolean,
  ): IterableT<item>;
  /** Yield at most count items, closing the upstream iterator on early exit. */
  take<item>(this: IterableT<item>, count: number): IterableT<item>;
}

/** A wrapped IterableT value with its dictionary operations. */
export type IterableT<item> = Data<AsIterable, item>;

/** Callable iterable dictionary with lazy list-like typeclass instances. */
export const IterableT: AsIterable = /* @__PURE__ */ create_iterable();

/** Wrap a factory whose iterable is requested for each traversal. */
export function from_factory<item>(
  factory: () => Iterable<item>,
): IterableT<item> {
  return IterableT(factory);
}

/** Wrap a live array view without copying; later source mutations are visible. */
export function from_array<item>(
  items: readonly item[],
): IterableT<item> {
  const factory = () => items;
  known_sizes.set(factory, { items, limit: Infinity });
  return IterableT(factory);
}

/** Snapshot an iterable so the wrapped value can be traversed repeatedly. */
export function from_iterable<item>(
  iterable: Iterable<item>,
): IterableT<item> {
  const items = [...iterable];
  const factory = () => items;
  known_sizes.set(factory, { items, limit: Infinity });
  return IterableT(factory);
}

/** Materialize a wrapped iterable into a mutable array. */
export function to_array<item>(iterable: IterableT<item>): item[] {
  const factory = iterable.value();
  const size = known_sizes.get(factory);
  if (size === undefined) return [...factory()];
  if (size.limit === 0) return [];
  const out = new Array<item>(Math.min(size.items.length, size.limit));
  let index = 0;
  for (const item of factory()) out[index++] = item;
  out.length = index;
  return out;
}

/** Lazily keep matching items, preserving type-guard narrowing. */
export function filter<item, narrowed extends item>(
  iterable: IterableT<item>,
  predicate: (item: NoInfer<item>) => item is narrowed,
): IterableT<narrowed>;
/** Lazily keep matching items. */
export function filter<item>(
  iterable: IterableT<item>,
  predicate: (item: NoInfer<item>) => boolean,
): IterableT<item>;
export function filter<item>(
  iterable: IterableT<item>,
  predicate: (item: item) => boolean,
): IterableT<item> {
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
  iterable: IterableT<item>,
  count: number,
): IterableT<item> {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError("take count must be a nonnegative safe integer");
  }
  return pipeline(iterable, { tag: "take", count });
}

function filter_method<item, narrowed extends item>(
  this: IterableT<item>,
  predicate: (item: item) => item is narrowed,
): IterableT<narrowed>;
function filter_method<item>(
  this: IterableT<item>,
  predicate: (item: item) => boolean,
): IterableT<item>;
function filter_method<item>(
  this: IterableT<item>,
  predicate: (item: item) => boolean,
): IterableT<item> {
  return filter(this, predicate);
}

function empty_iterable<item>(this: AsIterable): Data<AsIterable, item> {
  return IterableT(function* () {});
}

function lift_iterable_two<output>(
  fn: (...values: unknown[]) => output,
  first: RawIterableT<unknown>,
  second: RawIterableT<unknown>,
): IterableT<output> {
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
  first: RawIterableT<unknown>,
  second: RawIterableT<unknown>,
  third: RawIterableT<unknown>,
): IterableT<output> {
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
  first: RawIterableT<unknown>,
  rest: readonly IterableT<unknown>[],
): IterableT<output> {
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
  sources: readonly RawIterableT<unknown>[],
  _index: number,
  values: unknown[],
): Generator<output> {
  const iterators: Iterator<unknown>[] = [];
  let depth = 0;
  let failed = false;
  try {
    while (depth >= 0) {
      if (depth === sources.length) {
        yield fn(...values);
        depth -= 1;
        continue;
      }
      const iterator = iterators[depth] ??= sources[depth]()[Symbol.iterator]();
      const next = iterator.next();
      if (next.done) {
        iterators.pop();
        depth -= 1;
        continue;
      }
      values[depth] = next.value;
      depth += 1;
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    close_iterators(iterators, failed);
  }
}

type Stage =
  | { readonly tag: "map"; readonly fn: (item: unknown) => unknown }
  | { readonly tag: "filter"; readonly fn: (item: unknown) => boolean }
  | { readonly tag: "take"; readonly count: number }
  | {
    readonly tag: "filter_map";
    readonly fn: (item: unknown) => Maybe<unknown>;
  };
type Stages = { readonly stage: Stage; readonly previous?: Stages };
type Pipeline = {
  readonly source: RawIterableT<unknown>;
  readonly stages: Stages;
  ordered?: readonly Stage[];
};
const pipelines = new WeakMap<RawIterableT<unknown>, Pipeline>();
const known_sizes = new WeakMap<RawIterableT<unknown>, {
  readonly items: readonly unknown[];
  readonly limit: number;
}>();

// One generator owns the source. Plans share immutable links; counters belong
// to each traversal, so replay and interleaved consumers remain independent.
function pipeline<from, to = from>(
  value: IterableT<from>,
  stage: Stage,
): IterableT<to> {
  const current = value.value();
  const previous = pipelines.get(current);
  let source: RawIterableT<unknown> = current;
  let stages: Stages = { stage };
  if (previous !== undefined) {
    source = previous.source;
    stages = { stage, previous: previous.stages };
  }
  const plan: Pipeline = { source, stages };
  const factory = function* (): Generator<to> {
    const ordered = ordered_stages(plan);
    if (ordered.every((stage) => stage.tag === "map")) {
      const functions = ordered.map((stage) =>
        (stage as Extract<Stage, { tag: "map" }>).fn
      );
      for (let item of source()) {
        for (const fn of functions) item = fn(item);
        yield item as to;
      }
      return;
    }
    let remaining: number[] | undefined;
    if (ordered.some((stage) => stage.tag === "take")) {
      remaining = ordered.map((stage) => {
        if (stage.tag === "take") return stage.count;
        return Infinity;
      });
      if (remaining.includes(0)) return;
    }
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
            remaining![index] -= 1;
            if (remaining![index] === 0) stop = true;
            break;
          case "filter_map": {
            const [tag, value] = operation.fn(item).value();
            if (tag === "Nothing") keep = false;
            else item = value;
            break;
          }
        }
        if (!keep) break;
      }
      if (keep) yield item as to;
      if (stop) return;
    }
  };
  pipelines.set(factory, plan);
  const size = known_sizes.get(current);
  if (size !== undefined) {
    switch (stage.tag) {
      case "map":
        known_sizes.set(factory, size);
        break;
      case "take":
        known_sizes.set(factory, {
          items: size.items,
          limit: Math.min(size.limit, stage.count),
        });
        break;
    }
  }
  return IterableT(factory);
}

/** Collect at most limit items; closes the source without reading ahead. */
export function preview<item>(
  iterable: IterableT<item>,
  limit = 100,
): item[] {
  return to_array(take(iterable, limit));
}

/** Explicit live array view; mutations are visible on the next traversal. */
export const from_array_view = from_array;
/** Explicit finite snapshot; consumes the source immediately. */
export const from_snapshot = from_iterable;

function ordered_stages(plan: Pipeline): readonly Stage[] {
  if (plan.ordered !== undefined) return plan.ordered;
  const ordered: Stage[] = [];
  let link: Stages | undefined = plan.stages;
  while (link !== undefined) {
    ordered.push(link.stage);
    link = link.previous;
  }
  ordered.reverse();
  plan.ordered = ordered;
  return ordered;
}

function close_iterators(
  iterators: readonly Iterator<unknown>[],
  failed: boolean,
): void {
  let failure: { error: unknown } | undefined;
  for (let index = iterators.length - 1; index >= 0; index -= 1) {
    try {
      iterators[index].return?.();
    } catch (error) {
      failure ??= { error };
    }
  }
  if (!failed && failure !== undefined) throw failure.error;
}

/** Keep and transform a value in one stage; Nothing drops it. */
export function filter_map<from, to>(
  iterable: IterableT<from>,
  fn: (item: from) => Maybe<to>,
): IterableT<to> {
  return pipeline(iterable, {
    tag: "filter_map",
    fn: fn as (item: unknown) => Maybe<unknown>,
  });
}

/**
 * Prepare a reusable terminal loop. A known map/filter/take pipeline lowers to
 * its three callbacks without stage dispatch, counters arrays or yielded values.
 * Other plans retain ordinary iteration and IteratorClose behavior.
 */
export function compile_fold<item>(iterable: IterableT<item>): <state>(
  initial: state,
  reduce: (state: state, item: item) => state,
) => state {
  const factory = iterable.value();
  const plan = pipelines.get(factory);
  if (plan !== undefined) {
    const stages = ordered_stages(plan);
    const [map, filter, take] = stages;
    if (
      stages.length === 3 && map.tag === "map" && filter.tag === "filter" &&
      take.tag === "take"
    ) {
      return (initial, reduce) => {
        let state = initial;
        let remaining = take.count;
        if (remaining === 0) return state;
        for (const input of plan.source()) {
          const item = map.fn(input);
          if (!filter.fn(item)) continue;
          state = reduce(state, item as item);
          remaining -= 1;
          if (remaining === 0) break;
        }
        return state;
      };
    }
  }
  return (initial, reduce) => {
    let state = initial;
    for (const item of factory()) state = reduce(state, item);
    return state;
  };
}

function create_iterable(): AsIterable {
  const IterableT: AsIterable = data<AsIterable>(iterable_identity);
  IterableT.filter = filter_method;

  IterableT.take = function <item>(
    this: IterableT<item>,
    count: number,
  ): IterableT<item> {
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
      return pipeline(this, {
        tag: "map",
        fn: fn as (item: unknown) => unknown,
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
    [some_method](predicate) {
      for (const item of this.value()()) if (predicate(item)) return true;
      return false;
    },
    [find_method](predicate) {
      for (const item of this.value()()) if (predicate(item)) return item;
      return undefined;
    },

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
      return compile_fold(this)(initial, fn);
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
  return IterableT;
}
