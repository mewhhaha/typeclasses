import { type As, define, type Value } from "./trait.ts";
import {
  Applicative,
  Equal,
  Foldable,
  Format,
  Functor,
  Traversable,
} from "./traits.ts";

export type Validation<item> =
  | { tag: "valid"; value: item }
  | { tag: "invalid"; errors: string[] };

type Valid<item> = { tag: "valid"; value: item };

export const validation_kind = Symbol("Validation");

declare module "./trait.ts" {
  interface TraitTypes<item> {
    [validation_kind]: Validation<item>;
  }
}

export interface AsValidation extends As<typeof validation_kind> {}

type ValidationValue<item> = Value<AsValidation, item>;

export const Validation = define<AsValidation>(
  validation_kind,
);

export function valid<item>(value: item) {
  return Validation(validation_valid(value));
}

export function invalid<item = never>(
  first: string,
  ...rest: string[]
): ValidationValue<item> {
  return Validation(validation_invalid([first, ...rest]));
}

Format.implement(Validation)({
  fmt() {
    const validation = this.value();

    if (validation.tag === "invalid") {
      return "Invalid(" + Deno.inspect(validation.errors) + ")";
    }

    return "Valid(" + Deno.inspect(validation.value) + ")";
  },
});

export interface AsValidation extends Format<AsValidation> {}

Equal.implement(Validation)({
  eq(right) {
    const left = this.value();
    const right_value = right.value();

    if (left.tag === "valid" && right_value.tag === "valid") {
      return Object.is(left.value, right_value.value);
    }

    if (left.tag === "invalid" && right_value.tag === "invalid") {
      if (left.errors.length !== right_value.errors.length) {
        return false;
      }

      return left.errors.every((error, index) => {
        return Object.is(error, right_value.errors[index]);
      });
    }

    return false;
  },
});

export interface AsValidation extends Equal<AsValidation> {}

Functor.implement(Validation)({
  map(fn) {
    const validation = this.value();

    if (validation.tag === "invalid") {
      return same_context(this);
    }

    return valid(fn(validation.value));
  },
});

export interface AsValidation extends Functor<AsValidation> {}

Applicative.implement(Validation)({
  pure(value) {
    return valid(value);
  },

  ap(value) {
    const fn = this.value();
    const validation = value.value();

    if (fn.tag === "invalid" && validation.tag === "invalid") {
      return invalid_from_errors([...fn.errors, ...validation.errors]);
    }

    if (fn.tag === "invalid") {
      return invalid_from_errors(fn.errors);
    }

    if (validation.tag === "invalid") {
      return invalid_from_errors(validation.errors);
    }

    return valid(fn.value(validation.value));
  },
});

export interface AsValidation extends Applicative<AsValidation> {}

Foldable.implement(Validation)({
  fold(initial, fn) {
    const validation = this.value();

    if (validation.tag === "invalid") {
      return initial;
    }

    return fn(initial, validation.value);
  },
});

export interface AsValidation extends Foldable<AsValidation> {}

Traversable.implement(Validation)({
  traverse(applicative, fn) {
    const validation = this.value();

    if (validation.tag === "invalid") {
      return Applicative.pure(
        applicative,
        invalid_from_errors(
          validation.errors,
        ),
      );
    }

    return Functor.map(fn(validation.value), (value) => valid(value));
  },
});

export interface AsValidation extends Traversable<AsValidation> {}

function validation_valid<item>(value: item): Valid<item> {
  return { tag: "valid", value };
}

function validation_invalid<item = never>(errors: string[]): Validation<item> {
  return { tag: "invalid", errors };
}

function invalid_from_errors<item = never>(
  errors: readonly string[],
): ValidationValue<item> {
  return Validation(validation_invalid([...errors]));
}

function same_context<out>(value: unknown): out {
  return value as out;
}
