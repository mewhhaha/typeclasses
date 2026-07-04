import { type As, define, type Value } from "./trait.ts";
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
  | readonly ["some", item]
  | None;

export type Some<item> = readonly ["some", item];
export type None = readonly ["none"];

export const option_kind = Symbol("Option");

declare module "./trait.ts" {
  interface TraitTypes<dictionary, item> {
    [option_kind]: Option<item>;
  }
}

export interface AsOption extends As<typeof option_kind> {}

type OptionValue<item> = Value<AsOption, item>;

export const Option = define<AsOption>(
  option_kind,
);
const none_value = Option(option_none<never>());

export function some<item>(value: item) {
  return Option(option_some(value));
}

export function none<item = never>(): OptionValue<item> {
  return none_value as OptionValue<item>;
}

export function is_some<item>(value: Option<item>): value is Some<item> {
  return value[0] === "some";
}

export function is_none<item>(value: Option<item>): value is None {
  return value[0] === "none";
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
  fmt() {
    const option = this.value();

    if (option[0] === "none") {
      return "None";
    }

    return "Some(" + Deno.inspect(option[1]) + ")";
  },
});

export interface AsOption extends Format<AsOption> {}

Equal.implement(Option)({
  eq(right) {
    const left = this.value();
    const right_value = right.value();

    if (left[0] === "none" && right_value[0] === "none") {
      return true;
    }

    if (left[0] === "some" && right_value[0] === "some") {
      return Object.is(left[1], right_value[1]);
    }

    return false;
  },
});

export interface AsOption extends Equal<AsOption> {}

Functor.implement(Option)({
  map(fn) {
    const option = this.value();

    if (option[0] === "none") {
      return same_context(this);
    }

    return some(fn(option[1]));
  },
});

export interface AsOption extends Functor<AsOption> {}

Applicative.implement(Option)({
  pure(value) {
    return some(value);
  },

  ap(value) {
    const fn = this.value();
    const option = value.value();

    if (fn[0] === "none") {
      return same_context(this);
    }

    if (option[0] === "none") {
      return same_context(value);
    }

    return some(fn[1](option[1]));
  },
});

export interface AsOption extends Applicative<AsOption> {}

Alternative.implement(Option)({
  empty() {
    return none();
  },

  alt(right) {
    const option = this.value();

    if (option[0] === "some") {
      return Option(option);
    }

    return right;
  },
});

export interface AsOption extends Alternative<AsOption> {}

Monad.implement(Option)({
  bind(fn) {
    const option = this.value();

    if (option[0] === "none") {
      return same_context(this);
    }

    return fn(option[1]);
  },
});

export interface AsOption extends Monad<AsOption> {}

Foldable.implement(Option)({
  fold(initial, fn) {
    const option = this.value();

    if (option[0] === "none") {
      return initial;
    }

    return fn(initial, option[1]);
  },
});

export interface AsOption extends Foldable<AsOption> {}

Traversable.implement(Option)({
  traverse(applicative, fn) {
    const option = this.value();

    if (option[0] === "none") {
      return Applicative.pure(applicative, none());
    }

    return Functor.map(fn(option[1]), (value) => some(value));
  },
});

export interface AsOption extends Traversable<AsOption> {}

function option_some<item>(value: item): Some<item> {
  return ["some", value];
}

function option_none<item = never>(): Option<item> {
  return ["none"];
}

function same_context<out>(value: unknown): out {
  return value as out;
}
