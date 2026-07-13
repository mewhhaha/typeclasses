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
import { configured_dictionary, same_context } from "./internal.ts";
import { inspect } from "./inspect.ts";
import {
  Applicative,
  applicative_lift_method,
  compare_unknown,
  Eq,
  Foldable,
  Functor,
  Ord,
  Show,
  Traversable,
} from "./typeclasses.ts";

/** @ignore */
export declare const validation_identity: unique symbol;

/** An accumulating validation represented by a valid or invalid tagged tuple. */
export type Validation<error, item> =
  | Valid<item>
  | Invalid<error>;

/** The successful branch of Validation. */
export type Valid<item> = readonly ["valid", item];
/** The failed branch of Validation, including its accumulation rule. */
export type Invalid<error> = readonly [
  "invalid",
  error,
  ValidationSemigroup<error>,
];

/** An associative operation used to accumulate independent validation errors. */
export type ValidationSemigroup<error> = {
  concat(left: error, right: error): error;
};

const array_validation_semigroup: ValidationSemigroup<readonly unknown[]> = {
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
const validation_semigroup_ids = new WeakMap<object, number>();
let next_validation_semigroup_id = 1;

/** @ignore */
// deno-lint-ignore no-explicit-any -- a bare Valid is polymorphic in its error type
export type AnyError = any;

/** Dictionary type for Validation with a fixed error payload type. */
export interface AsValidation<error = AnyError>
  extends
    As<AsValidation<error>, typeof validation_identity>,
    Show<AsValidation<error>>,
    Eq<AsValidation<error>>,
    Applicative<AsValidation<error>>,
    Traversable<AsValidation<error>>,
    Ord<AsValidation<error>> {
  /** Higher-kinded slot for the successful value type. */
  readonly [type_item]: unknown;
  /** Validation representation at the selected successful value type. */
  readonly [type_data]: Validation<error, this[typeof type_item]>;
}

/** A Validation tuple wrapped with fluent typeclass methods. */
export type ValidationValue<error, item> = [error] extends [never]
  ? WrappedData<AsValidation<AnyError>, Valid<item>, item>
  : Data<AsValidation<error>, item>;

/** Callable Validation dictionary fixed to one error payload type. */
export type ValidationDictionary<error> = UnionDictionary<
  AsValidation<error>
>;

/** A Validation dictionary whose failure constructor carries one semigroup. */
export type ConfiguredValidationDictionary<error> = AsValidation<error> & {
  readonly Invalid: <item = never>(
    error: error,
  ) => ValidationValue<error, item>;
  readonly Valid: <item>(value: item) => ValidationValue<error, item>;
};

type ValidationError<value> = value extends Invalid<infer error> ? error
  : never;
type ValidationItem<value> = value extends Valid<infer item> ? item : never;

/** @ignore */
export type ValidationConstructor =
  & {
    <value extends Validation<AnyError, AnyError>>(
      value: value,
    ): ValidationValue<ValidationError<value>, ValidationItem<value>>;
    <error, item>(
      value: Validation<error, item>,
    ): ValidationValue<error, item>;
    with_error<error>(): ValidationDictionary<error>;
    with_semigroup<error>(
      semigroup: ValidationSemigroup<error>,
    ): ConfiguredValidationDictionary<error>;
    /** @deprecated Use with_error. */
    withError<error>(): ValidationDictionary<error>;
  }
  & {
    readonly [key in keyof UnionDictionary<AsValidation<unknown>>]:
      UnionDictionary<AsValidation<unknown>>[key];
  };

/** Runtime predicate for correctly shaped valid tuples. */
export type ValidGuard = {
  <error, item>(value: Validation<error, item>): value is Valid<item>;
  (value: unknown): value is Valid<unknown>;
};

/** Runtime predicate for invalid tuples with a usable semigroup. */
export type InvalidGuard = {
  <error, item>(value: Validation<error, item>): value is Invalid<error>;
  (value: unknown): value is Invalid<unknown>;
};

/** Constructor and guard for successful Validation values. */
export type ValidConstructor = {
  <item>(value: item): ValidationValue<never, item>;
  readonly is: ValidGuard;
};

/** Constructor and guard for failed Validation values. */
export type InvalidConstructor = {
  <error, item = never>(
    error: error,
    semigroup: ValidationSemigroup<error>,
  ): ValidationValue<error, item>;
  readonly is: InvalidGuard;
};

/** Callable Validation dictionary with configurable error accumulation. */
export const Validation = data<AsValidation<unknown>>(
  union(["valid", $slot], ["invalid", $slot, $slot]),
) as ValidationConstructor;

Object.defineProperty(Validation, "with_error", {
  value: validation_with_error,
});

Object.defineProperty(Validation, "withError", {
  value: validation_with_error,
});

Object.defineProperty(Validation, "with_semigroup", {
  value: validation_with_semigroup,
});

/** Construct or match a successful Validation value. */
export const Valid: ValidConstructor = Object.assign(construct_valid, {
  is: is_valid,
});
/** Construct or match a failed Validation value with an explicit semigroup. */
export const Invalid: InvalidConstructor = Object.assign(construct_invalid, {
  is: is_invalid,
});

function validation_with_error<error>(): ValidationDictionary<error> {
  return Validation as unknown as ValidationDictionary<error>;
}

function validation_with_semigroup<error>(
  semigroup: ValidationSemigroup<error>,
): ConfiguredValidationDictionary<error> {
  const dictionary = configured_dictionary(
    Validation,
    data<AsValidation<error>>(),
  ) as ConfiguredValidationDictionary<error>;

  Object.setPrototypeOf(dictionary, Validation);
  Object.defineProperties(dictionary, {
    Invalid: {
      value<item = never>(error: error): ValidationValue<error, item> {
        return dictionary<item>([
          "invalid",
          error,
          semigroup,
        ]) as ValidationValue<error, item>;
      },
    },
    Valid: {
      value<item>(item: item): ValidationValue<error, item> {
        return dictionary<item>([
          "valid",
          item,
        ]) as ValidationValue<error, item>;
      },
    },
  });

  return dictionary;
}

/** Construct a failed Validation that accumulates string message arrays. */
export function InvalidMessages<item = never>(
  first: string,
  ...rest: string[]
): ValidationValue<readonly string[], item> {
  return Messages.Invalid([first, ...rest]);
}

const Messages = validation_with_semigroup(array_semigroup<string>());

/** Map a validation error while explicitly selecting the target semigroup. */
export function map_error<error, next_error, item>(
  validation: ValidationValue<error, item>,
  fn: (error: error) => next_error,
  semigroup: ValidationSemigroup<next_error>,
): ValidationValue<next_error, item> {
  const [tag, payload] = validation.value();
  const configured = validation_with_semigroup(semigroup);

  switch (tag) {
    case "invalid":
      return configured.Invalid(fn(payload));
    case "valid":
      return configured.Valid(payload);
  }
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

  return tag === "valid" && value.length === 2;
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

  const [tag, , semigroup] = value;

  if (tag !== "invalid" || value.length !== 3) {
    return false;
  }

  if (typeof semigroup !== "object" || semigroup === null) {
    return false;
  }

  return typeof (semigroup as ValidationSemigroup<unknown>).concat ===
    "function";
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
        return "Valid(" + inspect(payload) + ")";
      case "invalid":
        return "Invalid(" + inspect(payload) + ")";
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

Ord.instance(Validation)({
  compare(right) {
    const [left_tag, left_payload] = this.value();
    const [right_tag, right_payload] = right.value();

    switch (left_tag) {
      case "invalid":
        if (right_tag === "valid") {
          return "lt";
        }

        return compare_errors(left_payload, right_payload);
      case "valid":
        if (right_tag === "invalid") {
          return "gt";
        }

        return compare_unknown(left_payload, right_payload);
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

  // The specialized ladder avoids the generic applicative_lift fallback's intermediates.
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

function lift_validation_valid<result>(
  fn: (...values: unknown[]) => result,
  first: unknown,
  rest: readonly ValidationValue<unknown, unknown>[],
): ValidationValue<unknown, result> {
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
          assert_same_semigroup(semigroup, current_semigroup);
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

function lift_validation_invalid<result>(
  first: unknown,
  semigroup: ValidationSemigroup<unknown>,
  rest: readonly ValidationValue<unknown, unknown>[],
): ValidationValue<unknown, result> {
  let error = first;

  for (const current of rest) {
    const [tag, payload, current_semigroup] = current.value();

    switch (tag) {
      case "invalid":
        assert_same_semigroup(semigroup, current_semigroup);
        error = semigroup.concat(error, payload);
        break;
      case "valid":
        break;
    }
  }

  return invalid_from_error(error, semigroup);
}

function array_semigroup<item>(): ValidationSemigroup<readonly item[]> {
  return array_validation_semigroup as ValidationSemigroup<readonly item[]>;
}

function concat_errors(left: Invalid<unknown>, right: Invalid<unknown>) {
  const semigroup = left[2];
  assert_same_semigroup(semigroup, right[2]);
  return semigroup.concat(left[1], right[1]);
}

function assert_same_semigroup(
  left: ValidationSemigroup<unknown>,
  right: ValidationSemigroup<unknown>,
): void {
  if (left !== right) {
    throw new TypeError(
      "Cannot combine Validation errors created with different semigroups " +
        `(left #${validation_semigroup_id(left)}, ` +
        `right #${validation_semigroup_id(right)})`,
    );
  }
}

function validation_semigroup_id(
  semigroup: ValidationSemigroup<unknown>,
): number {
  const existing = validation_semigroup_ids.get(semigroup);

  if (existing !== undefined) {
    return existing;
  }

  const id = next_validation_semigroup_id;
  next_validation_semigroup_id += 1;
  validation_semigroup_ids.set(semigroup, id);
  return id;
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

function compare_errors(left: unknown, right: unknown) {
  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.min(left.length, right.length);

    for (let index = 0; index < length; index += 1) {
      const order = compare_unknown(left[index], right[index]);

      if (order !== "eq") {
        return order;
      }
    }

    return compare_unknown(left.length, right.length);
  }

  return compare_unknown(left, right);
}
