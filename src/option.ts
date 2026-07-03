import { define_dictionary, type DefinedDictionary } from "./trait.ts";
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

export const option_kind = Symbol("Option");

declare module "./trait.ts" {
  interface ContextValues<item> {
    [option_kind]: Option<item>;
  }
}

export interface OptionDictionary
  extends DefinedDictionary<typeof option_kind> {}

export const Option = define_dictionary<OptionDictionary>(
  option_kind,
);

export function some<item>(value: item) {
  return Option(option_some(value));
}

export function none<item = never>() {
  return Option(option_none<item>());
}

export function from_nullable<item>(
  value: item | null | undefined,
) {
  if (value === null) {
    return none<item>();
  }

  if (value === undefined) {
    return none<item>();
  }

  return Option(option_some<item>(value));
}

Format.implement(Option)({
  fmt(value) {
    const option = value.value();

    if (option.tag === "none") {
      return "None";
    }

    return "Some(" + Deno.inspect(option.value) + ")";
  },
});

export interface OptionDictionary extends Format<OptionDictionary> {}

Equal.implement(Option)({
  eq(left_value, right) {
    const left = left_value.value();
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

export interface OptionDictionary extends Equal<OptionDictionary> {}

Functor.implement(Option)({
  map(value, fn) {
    const option = value.value();

    if (option.tag === "none") {
      return none();
    }

    return some(fn(option.value));
  },
});

export interface OptionDictionary extends Functor<OptionDictionary> {}

Applicative.implement(Option)({
  pure(_value, value) {
    return some(value);
  },

  ap(fn_value, value) {
    const fn = fn_value.value();
    const option = value.value();

    if (fn.tag === "none") {
      return none();
    }

    if (option.tag === "none") {
      return none();
    }

    return some(fn.value(option.value));
  },
});

export interface OptionDictionary extends Applicative<OptionDictionary> {}

Alternative.implement(Option)({
  empty(_value) {
    return none();
  },

  alt(value, right) {
    const option = value.value();

    if (option.tag === "some") {
      return Option(option);
    }

    return right;
  },
});

export interface OptionDictionary extends Alternative<OptionDictionary> {}

Monad.implement(Option)({
  bind(value, fn) {
    const option = value.value();

    if (option.tag === "none") {
      return none();
    }

    return fn(option.value);
  },
});

export interface OptionDictionary extends Monad<OptionDictionary> {}

Foldable.implement(Option)({
  fold(value, initial, fn) {
    const option = value.value();

    if (option.tag === "none") {
      return initial;
    }

    return fn(initial, option.value);
  },
});

export interface OptionDictionary extends Foldable<OptionDictionary> {}

Traversable.implement(Option)({
  traverse(value, applicative, fn) {
    const option = value.value();

    if (option.tag === "none") {
      return Applicative.pure(applicative, none());
    }

    return Functor.map(fn(option.value), (value) => some(value));
  },
});

export interface OptionDictionary extends Traversable<OptionDictionary> {}

function option_some<item>(value: item): Some<item> {
  return { tag: "some", value };
}

function option_none<item = never>(): Option<item> {
  return { tag: "none" };
}
