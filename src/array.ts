import {
  type Dictionary,
  kind,
  require_this,
  trait_constructor,
  type Value,
} from "./trait.ts";
import {
  Alternative,
  alternative_trait,
  type AlternativeImplementation,
  Applicative,
  applicative_trait,
  type ApplicativeImplementation,
  Equal,
  equal_trait,
  type EqualImplementation,
  Foldable,
  foldable_trait,
  type FoldableImplementation,
  Format,
  format_trait,
  type FormatImplementation,
  Functor,
  functor_trait,
  type FunctorImplementation,
  Monad,
  monad_trait,
  type MonadImplementation,
  Monoid,
  monoid_trait,
  type MonoidImplementation,
  Semigroup,
  semigroup_trait,
  type SemigroupImplementation,
  Traversable,
  traversable_trait,
  type TraversableImplementation,
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

const array_format = {
  fmt(this: ArrayValue<unknown> | void): string {
    const array = require_this(this, "ArrayT.Format.fmt").value();
    return Deno.inspect(array);
  },
} satisfies FormatImplementation<typeof ArrayT>;

ArrayT[format_trait] = array_format;
ArrayT.fmt = array_format.fmt;

export interface ArrayDictionary
  extends Format<typeof ArrayT>, FormatImplementation<typeof ArrayT> {}

const array_equal = {
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
} satisfies EqualImplementation<typeof ArrayT>;

ArrayT[equal_trait] = array_equal;
ArrayT.eq = array_equal.eq;

export interface ArrayDictionary
  extends Equal<typeof ArrayT>, EqualImplementation<typeof ArrayT> {}

const array_functor = {
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
} satisfies FunctorImplementation<typeof ArrayT>;

ArrayT[functor_trait] = array_functor;
ArrayT.map = array_functor.map;

export interface ArrayDictionary
  extends Functor<typeof ArrayT>, FunctorImplementation<typeof ArrayT> {}

const array_applicative = {
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
} satisfies ApplicativeImplementation<typeof ArrayT>;

ArrayT[applicative_trait] = array_applicative;
ArrayT.pure = array_applicative.pure;
ArrayT.ap = array_applicative.ap;

export interface ArrayDictionary
  extends
    Applicative<typeof ArrayT>,
    ApplicativeImplementation<typeof ArrayT> {}

const array_semigroup = {
  concat<item>(
    this: ArrayValue<item> | void,
    right: ArrayValue<item>,
  ): ArrayValue<item> {
    const left = require_this(this, "ArrayT.Semigroup.concat").value();
    return ArrayT([...left, ...right.value()]);
  },
} satisfies SemigroupImplementation<typeof ArrayT>;

ArrayT[semigroup_trait] = array_semigroup;
ArrayT.concat = array_semigroup.concat;

export interface ArrayDictionary
  extends Semigroup<typeof ArrayT>, SemigroupImplementation<typeof ArrayT> {}

const array_monoid = {
  empty<item>(): ArrayValue<item> {
    return ArrayT<item>([]);
  },
} satisfies MonoidImplementation<typeof ArrayT>;

ArrayT[monoid_trait] = array_monoid;
ArrayT.empty = array_monoid.empty;

export interface ArrayDictionary
  extends Monoid<typeof ArrayT>, MonoidImplementation<typeof ArrayT> {}

const array_alternative = {
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
} satisfies AlternativeImplementation<typeof ArrayT>;

ArrayT[alternative_trait] = array_alternative;
ArrayT.alt = array_alternative.alt;

export interface ArrayDictionary
  extends
    Alternative<typeof ArrayT>,
    AlternativeImplementation<typeof ArrayT> {}

const array_monad = {
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
} satisfies MonadImplementation<typeof ArrayT>;

ArrayT[monad_trait] = array_monad;
ArrayT.bind = array_monad.bind;

export interface ArrayDictionary
  extends Monad<typeof ArrayT>, MonadImplementation<typeof ArrayT> {}

const array_foldable = {
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
} satisfies FoldableImplementation<typeof ArrayT>;

ArrayT[foldable_trait] = array_foldable;
ArrayT.fold = array_foldable.fold;

export interface ArrayDictionary
  extends Foldable<typeof ArrayT>, FoldableImplementation<typeof ArrayT> {}

const array_traversable = {
  traverse<applicative extends Dictionary & Applicative<applicative>, from, to>(
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
} satisfies TraversableImplementation<typeof ArrayT>;

ArrayT[traversable_trait] = array_traversable;
ArrayT.traverse = array_traversable.traverse;

export interface ArrayDictionary
  extends
    Traversable<typeof ArrayT>,
    TraversableImplementation<typeof ArrayT> {}
