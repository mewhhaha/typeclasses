import { type As, define, type Trait } from "./trait.ts";
import {
  Applicative,
  Equal,
  Foldable,
  Format,
  Functor,
  Traversable,
} from "./traits.ts";

export type Validation<error, item> =
  | Valid<item>
  | Invalid<error>;

export type Valid<item> = readonly ["valid", item];
export type Invalid<error> = readonly [
  "invalid",
  error,
  ValidationSemigroup<error>,
];

export type ValidationSemigroup<error> = {
  concat(left: error, right: error): error;
};

export const validation_kind = Symbol("Validation");

declare module "./trait.ts" {
  interface TraitTypes<dictionary, item> {
    [validation_kind]: Validation<unknown, item>;
  }
}

export interface AsValidation extends As<typeof validation_kind> {}

export type ValidationValue<error, item> = Trait<
  AsValidation,
  Validation<error, item>,
  item
>;

type ValidationConstructor =
  & AsValidation
  & {
    <error, item>(
      value: Validation<error, item>,
    ): ValidationValue<error, item>;
  };

export const Validation = define<AsValidation>(
  validation_kind,
) as ValidationConstructor;

export function valid<item>(value: item): ValidationValue<never, item> {
  return Validation(validation_valid(value)) as ValidationValue<never, item>;
}

export function invalid<item = never>(
  first: string,
  ...rest: string[]
): ValidationValue<readonly string[], item> {
  return invalid_with([first, ...rest], array_semigroup<string>());
}

export function invalid_with<error, item = never>(
  error: error,
  semigroup: ValidationSemigroup<error>,
): ValidationValue<error, item> {
  return Validation(validation_invalid(error, semigroup)) as ValidationValue<
    error,
    item
  >;
}

Format.implement(Validation)({
  fmt() {
    const validation = this.value();

    if (validation[0] === "invalid") {
      return "Invalid(" + Deno.inspect(validation[1]) + ")";
    }

    return "Valid(" + Deno.inspect(validation[1]) + ")";
  },
});

export interface AsValidation extends Format<AsValidation> {}

Equal.implement(Validation)({
  eq(right) {
    const left = this.value();
    const right_value = right.value();

    if (left[0] === "valid" && right_value[0] === "valid") {
      return Object.is(left[1], right_value[1]);
    }

    if (left[0] === "invalid" && right_value[0] === "invalid") {
      return errors_equal(left[1], right_value[1]);
    }

    return false;
  },
});

export interface AsValidation extends Equal<AsValidation> {}

Functor.implement(Validation)({
  map(fn) {
    const validation = this.value();

    if (validation[0] === "invalid") {
      return same_context(this);
    }

    return valid(fn(validation[1]));
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

    if (fn[0] === "invalid" && validation[0] === "invalid") {
      return invalid_from_error(
        concat_errors(fn, validation),
        fn[2],
      );
    }

    if (fn[0] === "invalid") {
      return invalid_from_error(fn[1], fn[2]);
    }

    if (validation[0] === "invalid") {
      return invalid_from_error(validation[1], validation[2]);
    }

    return valid(fn[1](validation[1]));
  },
});

export interface AsValidation extends Applicative<AsValidation> {}

Foldable.implement(Validation)({
  fold(initial, fn) {
    const validation = this.value();

    if (validation[0] === "invalid") {
      return initial;
    }

    return fn(initial, validation[1]);
  },
});

export interface AsValidation extends Foldable<AsValidation> {}

Traversable.implement(Validation)({
  traverse(applicative, fn) {
    const validation = this.value();

    if (validation[0] === "invalid") {
      return Applicative.pure(
        applicative,
        invalid_from_error(
          validation[1],
          validation[2],
        ),
      );
    }

    return Functor.map(fn(validation[1]), (value) => valid(value));
  },
});

export interface AsValidation extends Traversable<AsValidation> {}

function validation_valid<item>(value: item): Valid<item> {
  return ["valid", value];
}

function validation_invalid<error>(
  error: error,
  semigroup: ValidationSemigroup<error>,
): Validation<error, never> {
  return ["invalid", error, semigroup];
}

function invalid_from_error<error, item = never>(
  error: error,
  semigroup: ValidationSemigroup<error>,
): ValidationValue<error, item> {
  return Validation(validation_invalid(error, semigroup)) as ValidationValue<
    error,
    item
  >;
}

function array_semigroup<item>(): ValidationSemigroup<readonly item[]> {
  return {
    concat(left, right) {
      if (left.length === 0) {
        return right;
      }

      if (right.length === 0) {
        return left;
      }

      return [...left, ...right];
    },
  };
}

function concat_errors(left: Invalid<unknown>, right: Invalid<unknown>) {
  const semigroup = left[2] as ValidationSemigroup<unknown>;
  return semigroup.concat(left[1], right[1]);
}

function errors_equal(left: unknown, right: unknown) {
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }

    return left.every((error, index) => {
      return Object.is(error, right[index]);
    });
  }

  return Object.is(left, right);
}

function same_context<out>(value: unknown): out {
  return value as out;
}
