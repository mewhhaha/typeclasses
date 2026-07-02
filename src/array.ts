import { kind, require_this, trait_constructor, type Value } from "./trait.ts";
import {
  Alternative,
  Applicative,
  Equal,
  Foldable,
  Format,
  Functor,
  Monad,
  Monoid,
  Semigroup,
  Traversable,
} from "./traits.ts";

export type ArrayT<item> = readonly item[];

export const array_kind: unique symbol = Symbol("ArrayT");

declare module "./registry.ts" {
  interface Registry<item> {
    [array_kind]: ArrayT<item>;
  }
}

export interface ArrayDictionary {
  <item>(items: ArrayT<item>): ArrayValue<item>;
  [kind]: typeof array_kind;
}

type ArrayValue<item> = Value<ArrayDictionary, item>;

export const ArrayT = function ArrayT<item>(
  items: ArrayT<item>,
): ArrayValue<item> {
  return array_trait(items);
} as ArrayDictionary;

ArrayT[kind] = array_kind;

const array_trait = trait_constructor(ArrayT);

export function from_array<item>(items: readonly item[]): ArrayValue<item> {
  return ArrayT([...items]);
}

export function to_array<item>(array: ArrayValue<item>): item[] {
  return [...array.value()];
}

Format.implement(ArrayT, {
  fmt(this: ArrayValue<unknown> | void): string {
    const array = require_this(this, "ArrayT.Format.fmt").value();
    return Deno.inspect(array);
  },
});

export interface ArrayDictionary extends Format<typeof ArrayT> {}

Equal.implement(ArrayT, {
  eq<item>(
    this: ArrayValue<item> | void,
    right: ArrayValue<item>,
  ): boolean {
    const left = require_this(this, "ArrayT.Equal.eq").value();
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

export interface ArrayDictionary extends Equal<typeof ArrayT> {}

Functor.implement(ArrayT, {
  map<from, to>(
    this: ArrayValue<from> | void,
    fn: (value: from) => to,
  ): ArrayValue<to> {
    const array = require_this(this, "ArrayT.Functor.map").value();
    const out: to[] = [];

    for (const item of array) {
      out.push(fn(item));
    }

    return ArrayT(out);
  },
});

export interface ArrayDictionary extends Functor<typeof ArrayT> {}

Applicative.implement(ArrayT, {
  pure<item>(value: item): ArrayValue<item> {
    return ArrayT([value]);
  },

  ap<from, to>(
    this: ArrayValue<(value: from) => to> | void,
    values: ArrayValue<from>,
  ): ArrayValue<to> {
    const fns = require_this(this, "ArrayT.Applicative.ap").value();
    const out: to[] = [];

    for (const fn of fns) {
      for (const value of values.value()) {
        out.push(fn(value));
      }
    }

    return ArrayT(out);
  },
});

export interface ArrayDictionary extends Applicative<typeof ArrayT> {}

Semigroup.implement(ArrayT, {
  concat<item>(
    this: ArrayValue<item> | void,
    right: ArrayValue<item>,
  ): ArrayValue<item> {
    const left = require_this(this, "ArrayT.Semigroup.concat").value();
    return ArrayT([...left, ...right.value()]);
  },
});

export interface ArrayDictionary extends Semigroup<typeof ArrayT> {}

Monoid.implement(ArrayT, {
  empty<item>(): ArrayValue<item> {
    return ArrayT<item>([]);
  },
});

export interface ArrayDictionary extends Monoid<typeof ArrayT> {}

Alternative.implement(ArrayT, {
  empty<item>(): ArrayValue<item> {
    return ArrayT<item>([]);
  },

  alt<item>(
    this: ArrayValue<item> | void,
    right: ArrayValue<item>,
  ): ArrayValue<item> {
    const left = require_this(this, "ArrayT.Alternative.alt").value();
    return ArrayT([...left, ...right.value()]);
  },
});

export interface ArrayDictionary extends Alternative<typeof ArrayT> {}

Monad.implement(ArrayT, {
  bind<from, to>(
    this: ArrayValue<from> | void,
    fn: (value: from) => ArrayValue<to>,
  ): ArrayValue<to> {
    const array = require_this(this, "ArrayT.Monad.bind").value();
    const out: to[] = [];

    for (const item of array) {
      out.push(...fn(item).value());
    }

    return ArrayT(out);
  },
});

export interface ArrayDictionary extends Monad<typeof ArrayT> {}

Foldable.implement(ArrayT, {
  fold<item, out>(
    this: ArrayValue<item> | void,
    initial: out,
    fn: (state: out, item: item) => out,
  ): out {
    const array = require_this(this, "ArrayT.Foldable.fold").value();
    let state = initial;

    for (const item of array) {
      state = fn(state, item);
    }

    return state;
  },
});

export interface ArrayDictionary extends Foldable<typeof ArrayT> {}

Traversable.implement(ArrayT, {
  traverse<applicative extends Applicative<applicative>, from, to>(
    this: ArrayValue<from> | void,
    applicative: Value<applicative, unknown>,
    fn: (value: from) => Value<applicative, to>,
  ): Value<applicative, ArrayValue<to>> {
    const array = require_this(this, "ArrayT.Traversable.traverse").value();
    let out = Applicative.pure(applicative, ArrayT<to>([]));

    for (let index = array.length - 1; index >= 0; index -= 1) {
      const item = array[index];
      const cons_head = Functor.map(fn(item), (head) => {
        return (tail: ArrayValue<to>) => ArrayT([head, ...tail.value()]);
      });
      out = Applicative.ap(cons_head, out);
    }

    return out;
  },
});

export interface ArrayDictionary extends Traversable<typeof ArrayT> {}
