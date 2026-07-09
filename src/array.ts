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
  applicative_lift_method,
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
    Monoid<AsArray>,
    Alternative<AsArray>,
    Monad<AsArray>,
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

  [applicative_lift_method](fn, rest) {
    const first = this.value();

    switch (rest.length) {
      case 0:
        return ArrayT(first.map((value) => fn(value)));
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
    const out = new Array<to>(fns.length * items.length);
    let index = 0;

    for (const fn of fns) {
      for (const item of items) {
        out[index] = fn(item);
        index += 1;
      }
    }

    return ArrayT(out);
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

    const out = new Array<to>(length);
    let out_index = 0;

    for (const chunk of chunks) {
      for (const item of chunk) {
        out[out_index] = item;
        out_index += 1;
      }
    }

    return ArrayT(out);
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

function lift_array_two<out>(
  fn: (...values: unknown[]) => out,
  first: readonly unknown[],
  second: readonly unknown[],
): ArrayValue<out> {
  const out = new Array<out>(first.length * second.length);
  let out_index = 0;

  for (let left_index = 0; left_index < first.length; left_index += 1) {
    const left = first[left_index];

    for (let right_index = 0; right_index < second.length; right_index += 1) {
      out[out_index] = fn(left, second[right_index]);
      out_index += 1;
    }
  }

  return ArrayT(out);
}

function lift_array_three<out>(
  fn: (...values: unknown[]) => out,
  first: readonly unknown[],
  second: readonly unknown[],
  third: readonly unknown[],
): ArrayValue<out> {
  const out = new Array<out>(first.length * second.length * third.length);
  let out_index = 0;

  for (let left_index = 0; left_index < first.length; left_index += 1) {
    const left = first[left_index];

    for (
      let middle_index = 0;
      middle_index < second.length;
      middle_index += 1
    ) {
      const middle = second[middle_index];

      for (let right_index = 0; right_index < third.length; right_index += 1) {
        out[out_index] = fn(left, middle, third[right_index]);
        out_index += 1;
      }
    }
  }

  return ArrayT(out);
}

function lift_array_many<out>(
  fn: (...values: unknown[]) => out,
  first: readonly unknown[],
  rest: readonly ArrayValue<unknown>[],
): ArrayValue<out> {
  let rows = first.map((value) => [value] as unknown[]);

  for (const current of rest) {
    const source = current.value();
    const next: unknown[][] = [];

    for (const row of rows) {
      for (const item of source) {
        next.push(append_item(row, item));
      }
    }

    rows = next;
  }

  return ArrayT(rows.map((row) => fn(...row)));
}

function append_item(values: readonly unknown[], item: unknown): unknown[] {
  const next = new Array<unknown>(values.length + 1);

  for (let index = 0; index < values.length; index += 1) {
    next[index] = values[index];
  }

  next[values.length] = item;

  return next;
}
