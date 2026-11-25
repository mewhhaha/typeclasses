import type { Maybe } from "./maybe.ts";
import { find_method, some_method } from "./typeclasses/foldable.ts";
import type { Runnable } from "./data_value.ts";
import {
  type As,
  type Data,
  data,
  tagged_payload,
  tagged_tag,
  tagged_value,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { traverse_items_into } from "./traversal.ts";
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
  return from_array([...iterable]);
}

function push_array_item<item>(out: item[], value: item): item[] {
  out.push(value);
  return out;
}

/** Materialize a wrapped iterable into a mutable array. */
export function to_array<item>(iterable: IterableT<item>): item[] {
  const factory = iterable.value();
  const items = fast_array_of(factory);
  return items !== undefined
    ? (items.slice() as item[])
    : fold_factory(factory, [] as item[], push_array_item);
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

function assert_take_count(count: number): void {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError("take count must be a nonnegative safe integer");
  }
}

/**
 * Yield at most count items without reading ahead, closing upstream on early
 * exit. Count must be a nonnegative safe integer; zero never opens the source.
 */
export function take<item>(
  iterable: IterableT<item>,
  count: number,
): IterableT<item> {
  assert_take_count(count);
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
  return from_array<item>([]);
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

  return IterableT(() => iterate_iterable_product(fn, sources));
}

function* iterate_iterable_product<output>(
  fn: (...values: unknown[]) => output,
  sources: readonly RawIterableT<unknown>[],
): Generator<output> {
  const values: unknown[] = [];
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
const iterable_pipeline = Symbol();
const iterable_array = Symbol();
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
    const state: StageState = { value: undefined, stop: false };
    for (const input of source()) {
      if (eval_stages(input, ordered, remaining, state)) {
        yield state.value as to;
      }
      if (state.stop) return;
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
  assert_take_count(limit);
  if (limit === 0) return [];
  const factory = iterable.value();
  const items = fast_array_of(factory);
  if (items !== undefined) {
    const count = items.length < limit ? items.length : limit;
    const out = new Array<item>(count);
    for (let i = 0; i < count; i += 1) out[i] = items[i] as item;
    return out;
  }
  const out: item[] = [];
  run_pipeline_until(factory, (value) => {
    out.push(value);
    return out.length >= limit;
  });
  return out;
}

/** Explicit live array view; mutations are visible on the next traversal. */
export const from_array_view = from_array;
/** Explicit finite snapshot; consumes the source immediately. */
export const from_snapshot = from_iterable;

function pipeline_meta(plan: Pipeline): PipelineMeta {
  if (plan.meta !== undefined) return plan.meta;
  const ordered: Stage[] = [];
  let has_take = false;
  let has_zero_take = false;
  for (
    let link: Stages | undefined = plan.stages;
    link !== undefined;
    link = link.previous
  ) {
    const stage = link.stage;
    ordered.push(stage);
    if (stage.tag === "take") {
      has_take = true;
      if (stage.count === 0) has_zero_take = true;
    }
  }
  ordered.reverse();
  return (plan.meta = { ordered, has_take, has_zero_take });
}

function init_remaining(ordered: readonly Stage[]): number[] {
  return ordered.map((stage) => stage.tag === "take" ? stage.count : Infinity);
}

type StageState = { value: unknown; stop: boolean };

function eval_stages(
  input: unknown,
  ordered: readonly Stage[],
  remaining: number[] | undefined,
  state: StageState,
): boolean {
  let value = input;
  for (let index = 0; index < ordered.length; index += 1) {
    const op = ordered[index];
    switch (op.tag) {
      case "map":
        value = op.fn(value);
        break;
      case "filter":
        if (!op.fn(value)) return false;
        break;
      case "take":
        if (--remaining![index] === 0) state.stop = true;
        break;
      case "filter_map": {
        const res = op.fn(value) as unknown as {
          readonly [tagged_tag]?: PropertyKey;
          readonly [tagged_payload]?: unknown;
          readonly [tagged_value]?: () => readonly [string, unknown];
          value(): readonly [string, unknown];
        };
        const value_fn = res.value;
        if (value_fn !== undefined && value_fn === res[tagged_value]) {
          if (res[tagged_tag] === "Nothing") return false;
          value = res[tagged_payload];
        } else {
          const raw = value_fn.call(res);
          if (raw[0] === "Nothing") return false;
          value = raw[1];
        }
        break;
      }
    }
  }
  state.value = value;
  return true;
}

function fold_pipeline<item, state>(
  plan: Pipeline,
  initial: state,
  reduce: (state: state, item: item) => state,
): state {
  const meta = pipeline_meta(plan);
  if (meta.has_zero_take) return initial;
  let acc = initial;
  const items = fast_array_of(plan.source);
  const ordered = meta.ordered;
  if (items !== undefined) {
    const last = ordered[ordered.length - 1];
    const has_tail_take = last.tag === "take";
    let rem = has_tail_take ? last.count : Infinity;
    const core = has_tail_take ? ordered.length - 1 : ordered.length;
    if (core === 0) {
      for (let i = 0; i < items.length && i < rem; i += 1) {
        acc = reduce(acc, items[i] as item);
      }
      return acc;
    }
    const s0 = ordered[0];
    if (core === 1) {
      if (s0.tag === "map") {
        const f0 = s0.fn;
        for (let i = 0; i < items.length && i < rem; i += 1) {
          acc = reduce(acc, f0(items[i]) as item);
        }
        return acc;
      }
      if (s0.tag === "filter") {
        const f0 = s0.fn;
        for (let i = 0; i < items.length; i += 1) {
          const v = items[i];
          if (f0(v)) {
            acc = reduce(acc, v as item);
            if (--rem === 0) break;
          }
        }
        return acc;
      }
    }
    if (core === 2) {
      const s1 = ordered[1];
      if (s0.tag === "map" && s1.tag === "filter") {
        const f0 = s0.fn, f1 = s1.fn;
        for (let i = 0; i < items.length; i += 1) {
          const m = f0(items[i]);
          if (f1(m)) {
            acc = reduce(acc, m as item);
            if (--rem === 0) break;
          }
        }
        return acc;
      }
      if (s0.tag === "filter" && s1.tag === "map") {
        const f0 = s0.fn, f1 = s1.fn;
        for (let i = 0; i < items.length; i += 1) {
          const v = items[i];
          if (f0(v)) {
            acc = reduce(acc, f1(v) as item);
            if (--rem === 0) break;
          }
        }
        return acc;
      }
    }
  }
  push_pipeline<item>(plan, (value) => {
    acc = reduce(acc, value);
    return false;
  });
  return acc;
}

function push_pipeline<item>(
  plan: Pipeline,
  visit: (item: item) => boolean,
): void {
  const meta = pipeline_meta(plan);
  if (meta.has_zero_take) return;
  const items = fast_array_of(plan.source);
  const ordered = meta.ordered;
  const remaining = meta.has_take ? init_remaining(ordered) : undefined;
  const state: StageState = { value: undefined, stop: false };
  if (items !== undefined) {
    for (let i = 0; i < items.length; i += 1) {
      if (
        (eval_stages(items[i], ordered, remaining, state) &&
          visit(state.value as item)) || state.stop
      ) return;
    }
    return;
  }
  for (const input of plan.source()) {
    if (
      (eval_stages(input, ordered, remaining, state) &&
        visit(state.value as item)) || state.stop
    ) return;
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
function fold_factory<item, state>(
  factory: RawIterableT<item>,
  initial: state,
  reduce: (state: state, item: item) => state,
): state {
  const plan = pipeline_of(factory);
  if (plan !== undefined) return fold_pipeline(plan, initial, reduce);
  const items = fast_array_of(factory);
  let state = initial;
  if (items !== undefined) {
    for (let i = 0; i < items.length; i += 1) {
      state = reduce(state, items[i] as item);
    }
    return state;
  }
  for (const item of factory()) state = reduce(state, item);
  return state;
}

/** Compile a reusable fold function for an `IterableT` pipeline. */
export function compile_fold<item>(iterable: IterableT<item>): <state>(
  initial: state,
  reduce: (state: state, item: item) => state,
) => state {
  const factory = iterable.value();
  return (initial, reduce) => fold_factory(factory, initial, reduce);
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
      const left_factory = this.value();
      const right_factory = right.value();
      const left_items = fast_array_of(left_factory);
      const right_items = fast_array_of(right_factory);
      if (left_items !== undefined && right_items !== undefined) {
        if (left_items === right_items) return true;
        const len = left_items.length;
        if (len !== right_items.length) return false;
        for (let i = 0; i < len; i += 1) {
          if (!Object.is(left_items[i], right_items[i])) return false;
        }
        return true;
      }
      const left_iterator = left_factory()[Symbol.iterator]();
      let right_iterator: Iterator<unknown> | undefined;

      let left_done = false;
      let right_done = false;

      try {
        right_iterator = right_factory()[Symbol.iterator]();
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
      return from_array([value]);
    },

    // The specialized ladder avoids the generic applicative_lift fallback's intermediates.
    [applicative_lift_method](fn, rest) {
      const first = this.value();

      switch (rest.length) {
        case 0:
          return Functor.map(this, fn);
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
      return lift_iterable_two(
        (fn, item) => (fn as (x: unknown) => unknown)(item),
        this.value(),
        values.value(),
      ) as never;
    },
  });

  function concat_iterable<item>(
    this: Data<AsIterable, item>,
    right: Data<AsIterable, item>,
  ): Data<AsIterable, item> {
    const left = this.value();
    const right_value = right.value();
    return IterableT(function* () {
      yield* left();
      yield* right_value();
    });
  }

  Semigroup.instance(IterableT)({
    concat: concat_iterable,
  });

  Monoid.instance(IterableT)({
    empty: empty_iterable,
  });

  Alternative.instance(IterableT)({
    empty: empty_iterable,
    alt: concat_iterable,
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
      run_pipeline_until(
        this.value(),
        (item) => predicate(item) ? (matched = true) : false,
      );
      return matched;
    },
    [find_method](predicate) {
      let found: unknown;
      run_pipeline_until(
        this.value(),
        (item) => predicate(item) ? (found = item, true) : false,
      );
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
      return fold_factory(this.value(), initial, fn);
    },
  });

  Traversable.instance(IterableT)({
    traverse(applicative, fn) {
      return traverse_items_into(
        this.value()(),
        applicative,
        fn,
        from_array as <item>(items: Iterable<item>) => IterableT<item>,
      );
    },
  });
  return IterableT;
}
