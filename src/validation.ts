import {
  $slot,
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
  union,
  type UnionDictionary,
  type WrappedData,
} from "./typeclass.ts";
import {
  Applicative,
  applicative_lift_method,
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

// deno-lint-ignore no-explicit-any -- a bare Valid is polymorphic in its error type
type AnyError = any;

export interface AsValidation<error = AnyError>
  extends
    As<AsValidation<error>>,
    Show<AsValidation<error>>,
    Eq<AsValidation<error>>,
    Applicative<AsValidation<error>>,
    Traversable<AsValidation<error>> {
  readonly [type_item]: unknown;
  readonly [type_data]: Validation<error, this[typeof type_item]>;
}

export type ValidationValue<error, item> = [error] extends [never]
  ? WrappedData<AsValidation<AnyError>, Valid<item>, item>
  : Data<AsValidation<error>, item>;

export type ValidationDictionary<error> = UnionDictionary<
  AsValidation<error>
>;

type ValidationError<value> = value extends Invalid<infer error> ? error
  : never;
type ValidationItem<value> = value extends Valid<infer item> ? item : never;

type ValidationConstructor =
  & {
    <value extends Validation<AnyError, AnyError>>(
      value: value,
    ): ValidationValue<ValidationError<value>, ValidationItem<value>>;
    <error, item>(
      value: Validation<error, item>,
    ): ValidationValue<error, item>;
    withError<error>(): ValidationDictionary<error>;
  }
  & {
    readonly [key in keyof UnionDictionary<AsValidation<unknown>>]:
      UnionDictionary<AsValidation<unknown>>[key];
  };

export type ValidGuard = {
  <error, item>(value: Validation<error, item>): value is Valid<item>;
  (value: unknown): value is Valid<unknown>;
};

export type InvalidGuard = {
  <error, item>(value: Validation<error, item>): value is Invalid<error>;
  (value: unknown): value is Invalid<unknown>;
};

export type ValidConstructor = {
  <item>(value: item): ValidationValue<never, item>;
  readonly is: ValidGuard;
};

export type InvalidConstructor = {
  <error, item = never>(
    error: error,
    semigroup: ValidationSemigroup<error>,
  ): ValidationValue<error, item>;
  readonly is: InvalidGuard;
};

export const Validation = data<AsValidation<unknown>>(
  union(["valid", $slot], ["invalid", $slot, $slot]),
) as ValidationConstructor;

Object.defineProperty(Validation, "withError", {
  value: validation_with_error,
});

export const Valid: ValidConstructor = Object.assign(construct_valid, {
  is: is_valid,
});
export const Invalid: InvalidConstructor = Object.assign(construct_invalid, {
  is: is_invalid,
});

function validation_with_error<error>(): ValidationDictionary<error> {
  return Validation as unknown as ValidationDictionary<error>;
}

export function InvalidMessages<item = never>(
  first: string,
  ...rest: string[]
): ValidationValue<readonly string[], item> {
  return Invalid([first, ...rest], array_semigroup<string>());
}

function is_valid<error, item>(
  value: Validation<error, item>,
): value is Valid<item>;
function is_valid(value: unknown): value is Valid<unknown>;
function is_valid<error, item>(
  value: Validation<error, item> | unknown,
): value is Valid<item> {
  if (!Array.isArray(value)) {
    return false;
  }

  const [tag] = value;

  return tag === "valid";
}

function is_invalid<error, item>(
  value: Validation<error, item>,
): value is Invalid<error>;
function is_invalid(value: unknown): value is Invalid<unknown>;
function is_invalid<error, item>(
  value: Validation<error, item> | unknown,
): value is Invalid<error> {
  if (!Array.isArray(value)) {
    return false;
  }

  const [tag] = value;

  return tag === "invalid";
}

function construct_valid<item>(value: item): ValidationValue<never, item> {
  return Validation<never, item>([
    "valid",
    value,
  ]) as ValidationValue<never, item>;
}

function construct_invalid<error, item = never>(
  error: error,
  semigroup: ValidationSemigroup<error>,
): ValidationValue<error, item> {
  return Validation<error, item>([
    "invalid",
    error,
    semigroup,
  ]);
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
        if (right_tag === "valid") {
          return Object.is(left_payload, right_payload);
        }

        return false;
      case "invalid":
        if (right_tag === "valid") {
          return false;
        }

        return errors_equal(left_payload, right_payload);
    }
  },
});

Functor.instance(Validation)({
  map(fn) {
    const [tag, payload] = this.value();

    switch (tag) {
      case "invalid":
        return same_context(this);
      case "valid":
        return Valid(fn(payload));
    }
  },
});

Applicative.instance(Validation)({
  pure(value) {
    return Valid(value);
  },

  [applicative_lift_method](fn, rest) {
    const validation = this.value();
    const [tag, payload, semigroup] = validation;

    switch (tag) {
      case "invalid":
        return lift_validation_invalid(payload, semigroup, rest);
      case "valid":
        return lift_validation_valid(fn, payload, rest);
    }
  },

  ap(value) {
    const fn = this.value();
    const validation = value.value();
    const [fn_tag, fn_payload, fn_semigroup] = fn;
    const [validation_tag, validation_payload, validation_semigroup] =
      validation;

    switch (fn_tag) {
      case "invalid":
        if (validation_tag === "invalid") {
          return invalid_from_error(
            concat_errors(fn, validation),
            fn_semigroup,
          );
        }

        return invalid_from_error(fn_payload, fn_semigroup);
      case "valid":
        if (validation_tag === "invalid") {
          return invalid_from_error(
            validation_payload,
            validation_semigroup,
          );
        }

        return Valid(fn_payload(validation_payload));
    }
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
        return Functor.map(fn(payload), (value) => Valid(value));
    }
  },
});

function invalid_from_error<error, item = never>(
  error: error,
  semigroup: ValidationSemigroup<error>,
): ValidationValue<error, item> {
  return Invalid(error, semigroup);
}

function lift_validation_valid<out>(
  fn: (...values: unknown[]) => out,
  first: unknown,
  rest: readonly ValidationValue<unknown, unknown>[],
): ValidationValue<unknown, out> {
  switch (rest.length) {
    case 0:
      return Valid(fn(first));
    case 1: {
      const [tag, payload, semigroup] = rest[0].value();

      switch (tag) {
        case "invalid":
          return invalid_from_error(payload, semigroup);
        case "valid":
          return Valid(fn(first, payload));
      }
    }
  }

  const values = [first];
  let error: unknown;
  let semigroup: ValidationSemigroup<unknown> | undefined;

  for (const current of rest) {
    const [tag, payload, current_semigroup] = current.value();

    switch (tag) {
      case "invalid":
        if (semigroup === undefined) {
          semigroup = current_semigroup;
          error = payload;
        } else {
          error = semigroup.concat(error, payload);
        }
        break;
      case "valid":
        values.push(payload);
        break;
    }
  }

  if (semigroup !== undefined) {
    return invalid_from_error(error, semigroup);
  }

  return Valid(fn(...values));
}

function lift_validation_invalid<out>(
  first: unknown,
  semigroup: ValidationSemigroup<unknown>,
  rest: readonly ValidationValue<unknown, unknown>[],
): ValidationValue<unknown, out> {
  let error = first;

  for (const current of rest) {
    const [tag, payload] = current.value();

    switch (tag) {
      case "invalid":
        error = semigroup.concat(error, payload);
        break;
      case "valid":
        break;
    }
  }

  return invalid_from_error(error, semigroup);
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
  const semigroup = left[2];
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
