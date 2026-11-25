import {
  find_method,
  fold_while_method,
  some_method,
} from "./typeclasses/foldable.ts";
import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { traverse_items_into } from "./traversal.ts";
import { custom_iterable } from "./internal.ts";
import { inspect } from "./inspect.ts";
import { loop_done, type LoopStep, rec } from "./loop.ts";
import {
  Alternative,
  Applicative,
  applicative_lift_method,
  compare_unknown,
  Eq,
  Foldable,
  Functor,
  Monad,
  MonadRec,
  Monoid,
  Ord,
  Semigroup,
  Show,
  Traversable,
} from "./typeclasses.ts";

/** @ignore */
export const array_identity: unique symbol = /* @__PURE__ */ Symbol(
  "array_identity",
);

/** The immutable array representation wrapped by the ArrayT dictionary. */
export type RawArrayT<item> = readonly item[];

/** @ignore */
export interface AsArrayLambda {
  readonly [type_item]: unknown;
  readonly [type_data]: RawArrayT<this[typeof type_item]>;
}

/** Dictionary type for immutable arrays and their list-like instances. */
export interface AsArray
  extends
    As<AsArrayLambda, typeof array_identity>,
    Show<AsArray>,
    Monoid<AsArray>,
    Alternative<AsArray>,
    Monad<AsArray>,
    MonadRec<AsArray>,
    Traversable<AsArray>,
    Ord<AsArray> {
}

/** An immutable array wrapped with its dictionary methods. */
export type ArrayT<item> = Data<AsArray, item>;

/** Callable immutable-array dictionary with fluent typeclass methods. */
export const ArrayT: AsArray = /* @__PURE__ */ create_array();

/** Snapshot an array. All positions, including holes, become explicit values. */
export function from_array<item>(items: readonly item[]): ArrayT<item> {
  return ArrayT([...items]);
}

/** Copy a wrapped immutable array into a mutable JavaScript array. */
export function to_array<item>(array: ArrayT<item>): item[] {
  return [...array.value()];
}

/**
 * Replace existing array elements in place, preserving their type and skipping
 * holes. Aliases observe updates. A thrown callback leaves partial updates.
 * The initial length determines the visited index range.
 */
export function map_in_place<item>(
  items: item[],
  fn: (item: NoInfer<item>, index: number) => NoInfer<item>,
): void {
  const length = items.length;

  for (let index = 0; index < length; index += 1) {
    if (index in items) items[index] = fn(items[index], index);
  }
}

/**
 * Map into an existing output array, resizing it to the source length and
 * removing stale entries at source holes. A thrown callback leaves partial
 * updates. Passing the source as destination performs in-place mapping.
 */
export function map_into<from, to>(
  source: readonly from[],
  destination: to[],
  fn: (item: NoInfer<from>, index: number) => NoInfer<to>,
): void {
  const length = source.length;
  destination.length = length;

  for (let index = 0; index < length; index += 1) {
    if (index in source) {
      destination[index] = fn(source[index], index);
    } else {
      delete destination[index];
    }
  }
}

/** @ignore Canonical implementation identity for specialized accumulators. */
export const array_concat_method: AsArray["concat"] =
  /* @__PURE__ */ (() => ArrayT.concat)();

function empty_array<item>(this: AsArray): Data<AsArray, item> {
  return ArrayT([]);
}

function lift_array_two<result>(
  fn: (...values: unknown[]) => result,
  first: readonly unknown[],
  second: readonly unknown[],
): ArrayT<result> {
  const total = first.length * second.length;
  if (total === 0) return ArrayT([]);
  const out = new Array<result>(total);
  let out_index = 0;

  for (let i = 0; i < first.length; i += 1) {
    const left = first[i];
    for (let j = 0; j < second.length; j += 1) {
      out[out_index++] = fn(left, second[j]);
    }
  }

  return ArrayT(out);
}

function lift_array_three<result>(
  fn: (...values: unknown[]) => result,
  first: readonly unknown[],
  second: readonly unknown[],
  third: readonly unknown[],
): ArrayT<result> {
  const total = first.length * second.length * third.length;
  if (total === 0) return ArrayT([]);
  const out = new Array<result>(total);
  let out_index = 0;

  for (let i = 0; i < first.length; i += 1) {
    const left = first[i];
    for (let j = 0; j < second.length; j += 1) {
      const middle = second[j];
      for (let k = 0; k < third.length; k += 1) {
        out[out_index++] = fn(left, middle, third[k]);
      }
    }
  }

  return ArrayT(out);
}

function lift_array_many<result>(
  fn: (...values: unknown[]) => result,
  first: readonly unknown[],
  rest: readonly ArrayT<unknown>[],
): ArrayT<result> {
  const sources = [first, ...rest.map((value) => value.value())];
  const values: unknown[] = [];
  if (sources.some((source) => source.length === 0)) return ArrayT([]);
  let length = 1;
  for (const source of sources) {
    length *= source.length;
    if (!Number.isSafeInteger(length) || length > 0xffff_ffff) {
      throw new RangeError("Array product exceeds maximum array length");
    }
  }
  const out = new Array<result>(length);
  let out_index = 0;
  const positions = new Array<number>(sources.length).fill(0);
  let depth = 0;
  while (depth >= 0) {
    if (depth === sources.length) {
      out[out_index++] = fn(...values);
      depth -= 1;
      continue;
    }
    const position = positions[depth];
    if (position === sources[depth].length) {
      positions[depth] = 0;
      depth -= 1;
      continue;
    }
    values[depth] = sources[depth][position];
    positions[depth] += 1;
    depth += 1;
  }
  out.length = out_index;
  return ArrayT(out);
}

/** Explicit shallow snapshot; later source mutations are invisible. */
export const from_snapshot = from_array;
/** Wrap an array by reference; later mutations remain visible. */
export function from_array_view<item>(
  items: readonly item[],
): ArrayT<item> {
  return ArrayT(items);
}

/** Pair every position, including holes, with its zero-based index. */
export function indexed<item>(
  array: ArrayT<item>,
): ArrayT<readonly [number, item]> {
  const source = array.value();
  const out = new Array<readonly [number, item]>(source.length);
  for (let index = 0; index < source.length; index += 1) {
    out[index] = [index, source[index]];
  }
  return ArrayT(out);
}

/** Flatten each callback result immediately, without retaining result chunks. */
export function flat_map_streaming<from, to>(
  array: ArrayT<from>,
  fn: (item: from) => Iterable<to>,
): ArrayT<to> {
  const out: to[] = [];
  for (const item of array.value()) {
    for (const value of fn(item)) out.push(value);
  }
  return ArrayT(out);
}

function create_array(): AsArray {
  const ArrayT: AsArray = data<AsArray>(array_identity);
  Show.instance(ArrayT)({
    show() {
      const array = this.value();
      return inspect(array);
    },
  });

  Eq.instance(ArrayT)({
    eq(right) {
      const left = this.value();
      const right_value = right.value();
      if (left === right_value) return true;
      const len = left.length;
      if (len !== right_value.length) return false;

      for (let index = 0; index < len; index += 1) {
        if (!Object.is(left[index], right_value[index])) return false;
      }

      return true;
    },
  });

  Ord.instance(ArrayT)({
    compare(right) {
      const left = this.value();
      const right_value = right.value();
      if (left === right_value) return "eq";
      const left_len = left.length;
      const right_len = right_value.length;
      const length = left_len < right_len ? left_len : right_len;

      for (let index = 0; index < length; index += 1) {
        const order = compare_unknown(left[index], right_value[index]);
        if (order !== "eq") return order;
      }

      return left_len < right_len ? "lt" : left_len > right_len ? "gt" : "eq";
    },
  });

  Functor.instance(ArrayT)({
    map(fn) {
      const array = this.value();
      const out = new Array<ReturnType<typeof fn>>(array.length);
      for (let index = 0; index < array.length; index += 1) {
        out[index] = fn(array[index]);
      }
      return ArrayT(out);
    },
  });

  Applicative.instance(ArrayT)({
    pure(value) {
      return ArrayT([value]);
    },

    // The specialized ladder avoids the generic applicative_lift fallback's intermediates.
    [applicative_lift_method](fn, rest) {
      const first = this.value();

      switch (rest.length) {
        case 0:
          return Functor.map(this, fn);
        case 1:
          return lift_array_two(fn, first, rest[0].value());
        case 2:
          return lift_array_three(fn, first, rest[0].value(), rest[1].value());
        default:
          return lift_array_many(fn, first, rest);
      }
    },

    ap<from, to>(
      this: Data<AsArray, (value: NoInfer<from>) => to>,
      values: Data<AsArray, from>,
    ): Data<AsArray, to> {
      const fns = this.value();
      const items = values.value();
      const total = fns.length * items.length;
      if (total === 0) return ArrayT([]);
      const out = new Array<to>(total);
      let index = 0;

      for (let i = 0; i < fns.length; i += 1) {
        const fn = fns[i];
        for (let j = 0; j < items.length; j += 1) {
          out[index++] = fn(items[j]);
        }
      }

      return ArrayT(out);
    },
  });

  function concat_array<item>(
    this: Data<AsArray, item>,
    right: Data<AsArray, item>,
  ): Data<AsArray, item> {
    const left = this.value();
    const right_value = right.value();
    const cl = custom_iterable(left);
    if (cl !== undefined) return ArrayT([...cl, ...right_value]);
    const cr = custom_iterable(right_value);
    if (cr !== undefined) return ArrayT([...left.slice(), ...cr]);
    const n = left.length;
    const out = new Array<item>(n + right_value.length);
    for (let i = 0; i < n; i += 1) out[i] = left[i];
    for (let i = 0; i < right_value.length; i += 1) out[n + i] = right_value[i];
    return ArrayT(out);
  }

  Semigroup.instance(ArrayT)({
    concat: concat_array,
  });

  Monoid.instance(ArrayT)({
    empty: empty_array,
  });

  Alternative.instance(ArrayT)({
    empty: empty_array,
    alt: concat_array,
  });

  Monad.instance(ArrayT)({
    bind<from, to>(
      this: Data<AsArray, from>,
      fn: (value: from) => Data<AsArray, to>,
    ): Data<AsArray, to> {
      const array = this.value();
      const chunks = new Array<readonly to[]>(array.length);
      let length = 0;

      for (let index = 0; index < array.length; index += 1) {
        const chunk = fn(array[index]).value();
        chunks[index] = chunk;
        length += chunk.length;
      }

      if (length === 0) return ArrayT([]);
      const out = new Array<to>(length);
      let out_index = 0;

      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i];
        for (let j = 0; j < chunk.length; j += 1) out[out_index++] = chunk[j];
      }

      return ArrayT(out);
    },
  });

  MonadRec.instance(ArrayT)({
    tail_rec_m<state, output>(
      initial: state,
      step: (state: state) => Data<AsArray, LoopStep<state, output>>,
    ): Data<AsArray, output> {
      const pending: LoopStep<state, output>[] = [rec(initial)];
      const output: output[] = [];

      while (pending.length > 0) {
        const [tag, value] = pending.pop()!;
        if (tag === loop_done) output.push(value);
        else {
          const next = step(value).value();
          for (let i = next.length - 1; i >= 0; i -= 1) pending.push(next[i]);
        }
      }

      return ArrayT(output);
    },
  });

  Foldable.instance(ArrayT)({
    [some_method](predicate) {
      for (const item of this.value()) if (predicate(item)) return true;
      return false;
    },
    [find_method](predicate) {
      for (const item of this.value()) if (predicate(item)) return item;
      return undefined;
    },
    [fold_while_method](initial, fn) {
      let state = initial;
      const items = this.value();
      for (let i = 0; i < items.length; i += 1) {
        const step = fn(state, items[i]);
        state = step[1];
        if (step[0] === "Done") return state;
      }
      return state;
    },

    fold(initial, fn) {
      let state = initial;
      for (const item of this.value()) state = fn(state, item);
      return state;
    },
  });

  Traversable.instance(ArrayT)({
    traverse(applicative, fn) {
      return traverse_items_into(
        this.value(),
        applicative,
        fn,
        ArrayT as unknown as <item>(
          items: Iterable<item>,
        ) => Data<AsArray, item>,
      );
    },
  });
  return ArrayT;
}
