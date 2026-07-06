import {
  type As,
  data,
  type type_data,
  type type_item,
  type WrappedData,
} from "./typeclass.ts";
import {
  Applicative,
  Eq,
  Foldable,
  Functor,
  Show,
  Traversable,
} from "./typeclasses.ts";

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

export interface AsValidation
  extends
    As<AsValidation>,
    Show<AsValidation>,
    Eq<AsValidation>,
    Functor<AsValidation>,
    Applicative<AsValidation>,
    Foldable<AsValidation>,
    Traversable<AsValidation> {
  readonly [type_item]: unknown;
  readonly [type_data]: Validation<unknown, this[typeof type_item]>;
}

export type ValidationValue<error, item> = WrappedData<
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

export const Validation = data<AsValidation>() as ValidationConstructor;

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

Show.instance(Validation)({
  show() {
    const [tag, payload] = this.value();

    switch (tag) {
      case "valid":
        return "Valid(" + Deno.inspect(payload) + ")";
      case "invalid":
        return "Invalid(" + Deno.inspect(payload) + ")";
    }
  },
});

Eq.instance(Validation)({
  eq(right) {
    const [left_tag, left_payload] = this.value();
    const [right_tag, right_payload] = right.value();

    switch (left_tag) {
      case "valid":
        switch (right_tag) {
          case "valid":
            return Object.is(left_payload, right_payload);
          case "invalid":
            return false;
        }
        break;
      case "invalid":
        switch (right_tag) {
          case "valid":
            return false;
          case "invalid":
            return errors_equal(left_payload, right_payload);
        }
        break;
    }

    return false;
  },
});

Functor.instance(Validation)({
  map(fn) {
    const [tag, payload] = this.value();

    switch (tag) {
      case "invalid":
        return same_context(this);
      case "valid":
        return valid(fn(payload));
    }
  },
});

Applicative.instance(Validation)({
  pure(value) {
    return valid(value);
  },

  ap(value) {
    const fn = this.value();
    const validation = value.value();
    const [fn_tag, fn_payload, fn_semigroup] = fn;
    const [validation_tag, validation_payload, validation_semigroup] =
      validation;

    switch (fn_tag) {
      case "invalid":
        switch (validation_tag) {
          case "invalid":
            return invalid_from_error(
              concat_errors(fn, validation),
              fn_semigroup,
            );
          case "valid":
            return invalid_from_error(fn_payload, fn_semigroup);
        }
        break;
      case "valid":
        switch (validation_tag) {
          case "invalid":
            return invalid_from_error(
              validation_payload,
              validation_semigroup,
            );
          case "valid":
            return valid(fn_payload(validation_payload));
        }
        break;
    }

    throw new Error("unreachable validation variant");
  },
});

Foldable.instance(Validation)({
  fold(initial, fn) {
    const [tag, payload] = this.value();

    switch (tag) {
      case "invalid":
        return initial;
      case "valid":
        return fn(initial, payload);
    }
  },
});

Traversable.instance(Validation)({
  traverse(applicative, fn) {
    const [tag, payload, semigroup] = this.value();

    switch (tag) {
      case "invalid":
        return Applicative.pure(
          applicative,
          invalid_from_error(
            payload,
            semigroup,
          ),
        );
      case "valid":
        return Functor.map(fn(payload), (value) => valid(value));
    }
  },
});

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
