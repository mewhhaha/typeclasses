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
  Traversable,
  traversable_trait,
  type TraversableImplementation,
} from "./traits.ts";

export type Option<item> =
  | { tag: "some"; value: item }
  | { tag: "none" };

type Some<item> = { tag: "some"; value: item };

export const option_kind: unique symbol = Symbol("Option");

declare module "./registry.ts" {
  interface Registry<item> {
    [option_kind]: Option<item>;
  }
}

export interface OptionDictionary {
  <item>(value: Option<item>): OptionValue<item>;
  [kind]: typeof option_kind;
}

type OptionValue<item> = Value<OptionDictionary, item>;

export const Option = function Option<item>(
  value: Option<item>,
): OptionValue<item> {
  return option_trait(value);
} as OptionDictionary;

Option[kind] = option_kind;

const option_trait = trait_constructor(Option);

export function some<item>(value: item): OptionValue<item> {
  return Option(option_some(value));
}

export function none<item = never>(): OptionValue<item> {
  return Option(option_none<item>());
}

export function from_nullable<item>(
  value: item | null | undefined,
): OptionValue<item> {
  if (value === null) {
    return none<item>();
  }

  if (value === undefined) {
    return none<item>();
  }

  return Option(option_some<item>(value));
}

const option_format = {
  fmt(this: OptionValue<unknown> | void): string {
    const option = require_this(this, "Option.Format.fmt").value();

    if (option.tag === "none") {
      return "None";
    }

    return "Some(" + Deno.inspect(option.value) + ")";
  },
} satisfies FormatImplementation<typeof Option>;

Option[format_trait] = option_format;
Option.fmt = option_format.fmt;

export interface OptionDictionary
  extends Format<typeof Option>, FormatImplementation<typeof Option> {}

const option_equal = {
  eq<item>(
    this: OptionValue<item> | void,
    right: OptionValue<item>,
  ): boolean {
    const left = require_this(this, "Option.Equal.eq").value();
    const right_value = right.value();

    if (left.tag === "none" && right_value.tag === "none") {
      return true;
    }

    if (left.tag === "some" && right_value.tag === "some") {
      return Object.is(left.value, right_value.value);
    }

    return false;
  },
} satisfies EqualImplementation<typeof Option>;

Option[equal_trait] = option_equal;
Option.eq = option_equal.eq;

export interface OptionDictionary
  extends Equal<typeof Option>, EqualImplementation<typeof Option> {}

const option_functor = {
  map<from, to>(
    this: OptionValue<from> | void,
    fn: (value: from) => to,
  ): OptionValue<to> {
    const option = require_this(this, "Option.Functor.map").value();

    if (option.tag === "none") {
      return none<to>();
    }

    return some(fn(option.value));
  },
} satisfies FunctorImplementation<typeof Option>;

Option[functor_trait] = option_functor;
Option.map = option_functor.map;

export interface OptionDictionary
  extends Functor<typeof Option>, FunctorImplementation<typeof Option> {}

const option_applicative = {
  pure<item>(value: item): OptionValue<item> {
    return some(value);
  },

  ap<from, to>(
    this: OptionValue<(value: from) => to> | void,
    value: OptionValue<from>,
  ): OptionValue<to> {
    const fn = require_this(this, "Option.Applicative.ap").value();
    const option = value.value();

    if (fn.tag === "none") {
      return none<to>();
    }

    if (option.tag === "none") {
      return none<to>();
    }

    return some(fn.value(option.value));
  },
} satisfies ApplicativeImplementation<typeof Option>;

Option[applicative_trait] = option_applicative;
Option.pure = option_applicative.pure;
Option.ap = option_applicative.ap;

export interface OptionDictionary
  extends
    Applicative<typeof Option>,
    ApplicativeImplementation<typeof Option> {}

const option_alternative = {
  empty<item>(): OptionValue<item> {
    return none<item>();
  },

  alt<item>(
    this: OptionValue<item> | void,
    right: OptionValue<item>,
  ): OptionValue<item> {
    const option = require_this(this, "Option.Alternative.alt").value();

    if (option.tag === "some") {
      return Option(option);
    }

    return right;
  },
} satisfies AlternativeImplementation<typeof Option>;

Option[alternative_trait] = option_alternative;
Option.empty = option_alternative.empty;
Option.alt = option_alternative.alt;

export interface OptionDictionary
  extends
    Alternative<typeof Option>,
    AlternativeImplementation<typeof Option> {}

const option_monad = {
  bind<from, to>(
    this: OptionValue<from> | void,
    fn: (value: from) => OptionValue<to>,
  ): OptionValue<to> {
    const option = require_this(this, "Option.Monad.bind").value();

    if (option.tag === "none") {
      return none<to>();
    }

    return fn(option.value);
  },
} satisfies MonadImplementation<typeof Option>;

Option[monad_trait] = option_monad;
Option.bind = option_monad.bind;

export interface OptionDictionary
  extends Monad<typeof Option>, MonadImplementation<typeof Option> {}

const option_foldable = {
  fold<item, out>(
    this: OptionValue<item> | void,
    initial: out,
    fn: (state: out, item: item) => out,
  ): out {
    const option = require_this(this, "Option.Foldable.fold").value();

    if (option.tag === "none") {
      return initial;
    }

    return fn(initial, option.value);
  },
} satisfies FoldableImplementation<typeof Option>;

Option[foldable_trait] = option_foldable;
Option.fold = option_foldable.fold;

export interface OptionDictionary
  extends Foldable<typeof Option>, FoldableImplementation<typeof Option> {}

const option_traversable = {
  traverse<applicative extends Dictionary & Applicative<applicative>, from, to>(
    this: OptionValue<from> | void,
    applicative: Value<applicative, unknown>,
    fn: (value: from) => Value<applicative, to>,
  ): Value<applicative, OptionValue<to>> {
    const option = require_this(this, "Option.Traversable.traverse").value();

    if (option.tag === "none") {
      return Applicative.pure(applicative, none<to>());
    }

    return Functor.map(fn(option.value), (value) => some(value));
  },
} satisfies TraversableImplementation<typeof Option>;

Option[traversable_trait] = option_traversable;
Option.traverse = option_traversable.traverse;

export interface OptionDictionary
  extends
    Traversable<typeof Option>,
    TraversableImplementation<typeof Option> {}

function option_some<item>(value: item): Some<item> {
  return { tag: "some", value };
}

function option_none<item = never>(): Option<item> {
  return { tag: "none" };
}
