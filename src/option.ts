import {
  type Dictionary,
  kind,
  require_this,
  trait_constructor,
  type Value,
} from "./trait.ts";
import {
  Alternative,
  Applicative,
  Equal,
  Foldable,
  Format,
  Functor,
  Monad,
  Traversable,
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

Format.implement(Option, {
  fmt(this: OptionValue<unknown> | void): string {
    const option = require_this(this, "Option.Format.fmt").value();

    if (option.tag === "none") {
      return "None";
    }

    return "Some(" + Deno.inspect(option.value) + ")";
  },
});

export interface OptionDictionary extends Format.Trait<typeof Option> {}

Equal.implement(Option, {
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
});

export interface OptionDictionary extends Equal.Trait<typeof Option> {}

Functor.implement(Option, {
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
});

export interface OptionDictionary extends Functor.Trait<typeof Option> {}

Applicative.implement(Option, {
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
});

export interface OptionDictionary extends Applicative.Trait<typeof Option> {}

Alternative.implement(Option, {
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
});

export interface OptionDictionary extends Alternative.Trait<typeof Option> {}

Monad.implement(Option, {
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
});

export interface OptionDictionary extends Monad.Trait<typeof Option> {}

Foldable.implement(Option, {
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
});

export interface OptionDictionary extends Foldable.Trait<typeof Option> {}

Traversable.implement(Option, {
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
});

export interface OptionDictionary extends Traversable.Trait<typeof Option> {}

function option_some<item>(value: item): Some<item> {
  return { tag: "some", value };
}

function option_none<item = never>(): Option<item> {
  return { tag: "none" };
}
