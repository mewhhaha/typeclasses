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

export type List<item> =
  | { tag: "nil" }
  | { tag: "cons"; head: item; tail: List<item> };

export const list_kind: unique symbol = Symbol("List");

declare module "./registry.ts" {
  interface Registry<item> {
    [list_kind]: List<item>;
  }
}

export interface ListDictionary {
  <item>(value: List<item>): ListValue<item>;
  [kind]: typeof list_kind;
}

type ListValue<item> = Value<ListDictionary, item>;

export const List = function List<item>(
  value: List<item>,
): ListValue<item> {
  return list_trait(value);
} as ListDictionary;

List[kind] = list_kind;

const list_trait = trait_constructor(List);

export function nil<item>(): ListValue<item> {
  return List(list_nil<item>());
}

export function cons<item>(
  head: item,
  tail: ListValue<item>,
): ListValue<item> {
  return List(list_cons(head, tail.value()));
}

export function from_array<item>(items: item[]): ListValue<item> {
  return List(list_from_array(items));
}

export function to_array<item>(list: ListValue<item>): item[] {
  const items: item[] = [];
  let rest = list.value();

  while (rest.tag === "cons") {
    items.push(rest.head);
    rest = rest.tail;
  }

  return items;
}

function list_from_array<item>(items: item[]): List<item> {
  let list = list_nil<item>();

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    list = list_cons(item, list);
  }

  return list;
}

const list_format = {
  fmt(this: ListValue<unknown> | void): string {
    const list = require_this(this, "List.Format.fmt");
    const items = to_array(list).map((item) => Deno.inspect(item));
    return "[" + items.join(", ") + "]";
  },
} satisfies FormatImplementation<typeof List>;

List[format_trait] = list_format;
List.fmt = list_format.fmt;

export interface ListDictionary
  extends Format<typeof List>, FormatImplementation<typeof List> {}

const list_equal = {
  eq<item>(
    this: ListValue<item> | void,
    right: ListValue<item>,
  ): boolean {
    const left = require_this(this, "List.Equal.eq");
    let left_rest = left.value();
    let right_rest = right.value();

    while (left_rest.tag === "cons" && right_rest.tag === "cons") {
      if (!Object.is(left_rest.head, right_rest.head)) {
        return false;
      }

      left_rest = left_rest.tail;
      right_rest = right_rest.tail;
    }

    return left_rest.tag === "nil" && right_rest.tag === "nil";
  },
} satisfies EqualImplementation<typeof List>;

List[equal_trait] = list_equal;
List.eq = list_equal.eq;

export interface ListDictionary
  extends Equal<typeof List>, EqualImplementation<typeof List> {}

const list_functor = {
  map<from, to>(
    this: ListValue<from> | void,
    fn: (value: from) => to,
  ): ListValue<to> {
    const list = require_this(this, "List.Functor.map");
    const items = to_array(list);
    const mapped: to[] = [];

    for (const item of items) {
      mapped.push(fn(item));
    }

    return List(list_from_array(mapped));
  },
} satisfies FunctorImplementation<typeof List>;

List[functor_trait] = list_functor;
List.map = list_functor.map;

export interface ListDictionary
  extends Functor<typeof List>, FunctorImplementation<typeof List> {}

const list_applicative = {
  pure<item>(
    value: item,
  ): ListValue<item> {
    return List(list_cons(value, list_nil()));
  },

  ap<from, to>(
    this: ListValue<(value: from) => to> | void,
    values: ListValue<from>,
  ): ListValue<to> {
    const fns = require_this(this, "List.Applicative.ap");
    const out: to[] = [];

    for (const fn of to_array(fns)) {
      for (const value of to_array(values)) {
        out.push(fn(value));
      }
    }

    return List(list_from_array(out));
  },
} satisfies ApplicativeImplementation<typeof List>;

List[applicative_trait] = list_applicative;
List.pure = list_applicative.pure;
List.ap = list_applicative.ap;

export interface ListDictionary
  extends Applicative<typeof List>, ApplicativeImplementation<typeof List> {}

const list_semigroup = {
  concat<item>(
    this: ListValue<item> | void,
    right: ListValue<item>,
  ): ListValue<item> {
    const left = require_this(this, "List.Semigroup.concat");
    return from_array([...to_array(left), ...to_array(right)]);
  },
} satisfies SemigroupImplementation<typeof List>;

List[semigroup_trait] = list_semigroup;
List.concat = list_semigroup.concat;

export interface ListDictionary
  extends Semigroup<typeof List>, SemigroupImplementation<typeof List> {}

const list_monoid = {
  empty<item>(): ListValue<item> {
    return nil<item>();
  },
} satisfies MonoidImplementation<typeof List>;

List[monoid_trait] = list_monoid;
List.empty = list_monoid.empty;

export interface ListDictionary
  extends Monoid<typeof List>, MonoidImplementation<typeof List> {}

const list_alternative = {
  empty<item>(): ListValue<item> {
    return nil<item>();
  },

  alt<item>(
    this: ListValue<item> | void,
    right: ListValue<item>,
  ): ListValue<item> {
    const left = require_this(this, "List.Alternative.alt");
    return from_array([...to_array(left), ...to_array(right)]);
  },
} satisfies AlternativeImplementation<typeof List>;

List[alternative_trait] = list_alternative;
List.alt = list_alternative.alt;

export interface ListDictionary
  extends Alternative<typeof List>, AlternativeImplementation<typeof List> {}

const list_monad = {
  bind<from, to>(
    this: ListValue<from> | void,
    fn: (value: from) => ListValue<to>,
  ): ListValue<to> {
    const list = require_this(this, "List.Monad.bind");
    const out: to[] = [];

    for (const item of to_array(list)) {
      const values = fn(item);

      for (const value of to_array(values)) {
        out.push(value);
      }
    }

    return List(list_from_array(out));
  },
} satisfies MonadImplementation<typeof List>;

List[monad_trait] = list_monad;
List.bind = list_monad.bind;

export interface ListDictionary
  extends Monad<typeof List>, MonadImplementation<typeof List> {}

const list_foldable = {
  fold<item, out>(
    this: ListValue<item> | void,
    initial: out,
    fn: (state: out, item: item) => out,
  ): out {
    const list = require_this(this, "List.Foldable.fold");
    let state = initial;

    for (const item of to_array(list)) {
      state = fn(state, item);
    }

    return state;
  },
} satisfies FoldableImplementation<typeof List>;

List[foldable_trait] = list_foldable;
List.fold = list_foldable.fold;

export interface ListDictionary
  extends Foldable<typeof List>, FoldableImplementation<typeof List> {}

const list_traversable = {
  traverse<applicative extends Dictionary & Applicative<applicative>, from, to>(
    this: ListValue<from> | void,
    applicative: Value<applicative, unknown>,
    fn: (value: from) => Value<applicative, to>,
  ): Value<applicative, ListValue<to>> {
    const list = require_this(this, "List.Traversable.traverse");
    const items = to_array(list);
    let out = Applicative.pure(applicative, nil<to>());

    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      const cons_head = Functor.map(fn(item), (head) => {
        return (tail: ListValue<to>) => cons(head, tail);
      });
      out = Applicative.ap(cons_head, out);
    }

    return out;
  },
} satisfies TraversableImplementation<typeof List>;

List[traversable_trait] = list_traversable;
List.traverse = list_traversable.traverse;

export interface ListDictionary
  extends Traversable<typeof List>, TraversableImplementation<typeof List> {}

function list_nil<item>(): List<item> {
  return { tag: "nil" };
}

function list_cons<item>(head: item, tail: List<item>): List<item> {
  return { tag: "cons", head, tail };
}
