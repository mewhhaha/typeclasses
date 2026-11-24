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
  const factory: TaggedIterableFactory<item> = () => items;
  factory[iterable_array] = items;
  return IterableT(factory);
}

/** Snapshot an iterable so the wrapped value can be traversed repeatedly. */
export function from_iterable<item>(
  iterable: Iterable<item>,
): IterableT<item> {
  const items = [...iterable];
  const factory: TaggedIterableFactory<item> = () => items;
  factory[iterable_array] = items;
  return IterableT(factory);
}

/** Materialize a wrapped iterable into a mutable array. */
export function to_array<item>(iterable: IterableT<item>): item[] {
  const factory = iterable.value();
  const plan = pipeline_of(factory);
  if (plan !== undefined) {
    const out: item[] = [];
    push_pipeline<item>(plan, (value) => {
      out.push(value);
      return false;
    });
    return out;
  }
  const items = fast_array_of(factory);
  return items !== undefined ? (items.slice() as item[]) : [...factory()];
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
type PipelineMeta = {
  readonly ordered: readonly Stage[];
  readonly has_take: boolean;
  readonly has_zero_take: boolean;
};
type Pipeline = {
  readonly source: RawIterableT<unknown>;
  readonly stages: Stages;
  meta?: PipelineMeta;
};
const iterable_pipeline = Symbol("IterableT.pipeline");
const iterable_array = Symbol("IterableT.array");
type TaggedIterableFactory<item = unknown> = RawIterableT<item> & {
  [iterable_pipeline]?: Pipeline;
  [iterable_array]?: readonly unknown[];
};

function pipeline_of(factory: RawIterableT<unknown>): Pipeline | undefined {
  return (factory as TaggedIterableFactory)[iterable_pipeline];
}
function fast_array_of(
  source: RawIterableT<unknown>,
): readonly unknown[] | undefined {
  const items = (source as TaggedIterableFactory)[iterable_array];
  if (
    items !== undefined && Array.isArray(items) &&
    items[Symbol.iterator] === Array.prototype[Symbol.iterator]
  ) {
    return items;
  }
  return undefined;
}

// One generator owns the source. Plans share immutable links; counters belong
// to each traversal, so replay and interleaved consumers remain independent.
function pipeline<from, to = from>(
  value: IterableT<from>,
  stage: Stage,
): IterableT<to> {
  const current = value.value();
  const previous = pipeline_of(current);
  let source: RawIterableT<unknown> = current;
  let stages: Stages = { stage };
  if (previous !== undefined) {
    source = previous.source;
    stages = { stage, previous: previous.stages };
  }
  const plan: Pipeline = { source, stages };
  const factory: TaggedIterableFactory<to> = function* (): Generator<to> {
    const meta = pipeline_meta(plan);
    if (meta.has_zero_take) return;
    const ordered = meta.ordered;
    const remaining = meta.has_take ? init_remaining(ordered) : undefined;
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
  factory[iterable_pipeline] = plan;
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

function pipeline_meta(plan: Pipeline): PipelineMeta {
  if (plan.meta !== undefined) return plan.meta;
  const ordered: Stage[] = [];
  let link: Stages | undefined = plan.stages;
  while (link !== undefined) {
    ordered.push(link.stage);
    link = link.previous;
  }
  ordered.reverse();
  let has_take = false;
  let has_zero_take = false;
  for (let index = 0; index < ordered.length; index += 1) {
    const stage = ordered[index];
    if (stage.tag === "take") {
      has_take = true;
      if (stage.count === 0) has_zero_take = true;
    }
  }
  const meta: PipelineMeta = { ordered, has_take, has_zero_take };
  plan.meta = meta;
  return meta;
}

function init_remaining(ordered: readonly Stage[]): number[] {
  const remaining = new Array<number>(ordered.length);
  for (let index = 0; index < ordered.length; index += 1) {
    const stage = ordered[index];
    remaining[index] = stage.tag === "take" ? stage.count : Infinity;
  }
  return remaining;
}

function push_pipeline<item>(
  plan: Pipeline,
  visit: (item: item) => boolean,
): void {
  const meta = pipeline_meta(plan);
  if (meta.has_zero_take) return;
  const items = fast_array_of(plan.source);
  const ordered = meta.ordered;
  if (items !== undefined) {
    if (ordered.length === 1 && ordered[0].tag === "map") {
      const f0 = ordered[0].fn;
      for (let index = 0; index < items.length; index += 1) {
        if (visit(f0(items[index]) as item)) return;
      }
      return;
    }
    if (
      ordered.length === 2 && ordered[0].tag === "map" &&
      ordered[1].tag === "filter"
    ) {
      const map_fn = ordered[0].fn;
      const filter_fn = ordered[1].fn;
      for (let index = 0; index < items.length; index += 1) {
        const mapped = map_fn(items[index]);
        if (filter_fn(mapped) && visit(mapped as item)) return;
      }
      return;
    }
  }
  const remaining = meta.has_take ? init_remaining(ordered) : undefined;
  const step_item = (input: unknown): boolean => {
    let value = input;
    let keep = true;
    let stop = false;
    for (let index = 0; index < ordered.length; index += 1) {
      const operation = ordered[index];
      switch (operation.tag) {
        case "map":
          value = operation.fn(value);
          break;
        case "filter":
          keep = operation.fn(value);
          break;
        case "take":
          remaining![index] -= 1;
          if (remaining![index] === 0) stop = true;
          break;
        case "filter_map": {
          const [tag, payload] = operation.fn(value).value();
          if (tag === "Nothing") keep = false;
          else value = payload;
          break;
        }
      }
      if (!keep) break;
    }
    if (keep && visit(value as item)) return true;
    return stop;
  };
  if (items !== undefined) {
    for (let index = 0; index < items.length; index += 1) {
      if (step_item(items[index])) return;
    }
    return;
  }
  for (const input of plan.source()) {
    if (step_item(input)) return;
  }
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
 * Prepare a reusable terminal loop. Pipeline stages lower directly into a push
 * loop without generator yields or iterator-result boxes, retaining IteratorClose
 * on early exit.
 */
export function compile_fold<item>(iterable: IterableT<item>): <state>(
  initial: state,
  reduce: (state: state, item: item) => state,
) => state {
  const factory = iterable.value();
  const plan = pipeline_of(factory);
  if (plan !== undefined) {
    const meta = pipeline_meta(plan);
    if (meta.has_zero_take) return (initial) => initial;
    return (initial, reduce) => {
      let state = initial;
      push_pipeline<item>(plan, (value) => {
        state = reduce(state, value);
        return false;
      });
      return state;
    };
  }
  const items = fast_array_of(factory);
  if (items !== undefined) {
    return (initial, reduce) => {
      let state = initial;
      for (let index = 0; index < items.length; index += 1) {
        state = reduce(state, items[index] as item);
      }
      return state;
    };
  }
  return (initial, reduce) => {
    let state = initial;
    for (const item of factory()) state = reduce(state, item);
    return state;
  };
}

function run_pipeline_until<item>(
  factory: RawIterableT<item>,
  visit: (item: item) => boolean,
): void {
  const plan = pipeline_of(factory);
  if (plan !== undefined) {
    push_pipeline(plan, visit);
    return;
  }
  const items = fast_array_of(factory);
  if (items !== undefined) {
    for (let index = 0; index < items.length; index += 1) {
      if (visit(items[index] as item)) return;
    }
    return;
  }
  for (const item of factory()) {
    if (visit(item)) return;
  }
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
      let matched = false;
      run_pipeline_until(this.value(), (item) => {
        if (predicate(item)) {
          matched = true;
          return true;
        }
        return false;
      });
      return matched;
    },
    [find_method](predicate) {
      let found: unknown;
      run_pipeline_until(this.value(), (item) => {
        if (predicate(item)) {
          found = item;
          return true;
        }
        return false;
      });
      return found as never;
    },

    [fold_while_method](initial, fn) {
      let state = initial;
      run_pipeline_until(this.value(), (item) => {
        const [tag, next] = fn(state, item);
        state = next;
        return tag === "Done";
      });
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
