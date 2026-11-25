import type { Matchable } from "./data_value.ts";
import {
  $slot,
  type As,
  type Data,
  data,
  is_data,
  kind,
  type type_data,
  type type_item,
  union,
  type UnionDictionary,
  type WrappedData,
} from "./typeclass.ts";
import { type Either, Left, Right } from "./either.ts";
import { same_context } from "./internal.ts";
import { inspect } from "./inspect.ts";
import { register_traversal } from "./traversal.ts";
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
export const validation_identity: unique symbol = /* @__PURE__ */ Symbol(
  "validation_identity",
);

/** An accumulating validation represented by a valid or invalid tagged tuple. */
export type RawValidation<error, item> =
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
  concat: (left, right) =>
    left.length === 0 ? right : right.length === 0 ? left : [...left, ...right],
};
const validation_semigroup_ids = new WeakMap<object, number>();
let next_validation_semigroup_id = 1;

/** @ignore */
// deno-lint-ignore no-explicit-any -- a bare Valid is polymorphic in its error type
export type AnyError = any;

/** @ignore */
export interface AsValidationLambda<error = AnyError> {
  readonly [type_item]: unknown;
  readonly [type_data]: RawValidation<error, this[typeof type_item]>;
}

/** Dictionary type for Validation with a fixed error payload type. */
export interface AsValidation<error = AnyError>
  extends
    As<AsValidationLambda<error>, typeof validation_identity>,
    Show<AsValidation<error>>,
    Eq<AsValidation<error>>,
    Applicative<AsValidation<error>>,
    Traversable<AsValidation<error>>,
    Ord<AsValidation<error>>,
    Matchable {
}

/** A Validation tuple wrapped with fluent typeclass methods. */
export type Validation<error, item> = [error] extends [never]
  ? WrappedData<AsValidation<AnyError>, Valid<item>, item>
  : Data<AsValidation<error>, item>;

/** Callable Validation dictionary fixed to one error payload type. */
export type ValidationDictionary<error> = UnionDictionary<
  AsValidation<error>
>;

/** A Validation dictionary whose failure constructor carries one semigroup. */
export type ConfiguredValidationDictionary<error> = AsValidation<error> & {
  readonly Invalid: {
    <item = never>(error: error): Validation<error, item>;
    readonly is: InvalidGuard;
  };
  readonly Valid: {
    <item>(value: item): Validation<error, item>;
    readonly is: ValidGuard;
  };
  /** Convert an Either into this configured Validation. */
  from_either<item>(value: Either<error, item>): Validation<error, item>;
  /** Convert a nullable value into Valid or lazily create an Invalid value. */
  from_nullable<item>(
    value: item | null | undefined,
    on_null: () => error,
  ): Validation<error, NonNullable<item>>;
};

type ValidationError<value> = value extends Invalid<infer error> ? error
  : never;
type ValidationItem<value> = value extends Valid<infer item> ? item : never;

/** @ignore */
export type ValidationConstructor =
  & {
    <value extends RawValidation<AnyError, AnyError>>(
      value: value,
    ): Validation<ValidationError<value>, ValidationItem<value>>;
    <error, item>(
      value: RawValidation<error, item>,
    ): Validation<error, item>;
    with_error<error>(): ValidationDictionary<error>;
    with_semigroup<error>(
      semigroup: ValidationSemigroup<error>,
    ): ConfiguredValidationDictionary<error>;
    readonly Valid: ValidConstructor;
    readonly Invalid: InvalidConstructor;
  }
  & {
    readonly [key in keyof AsValidation<unknown>]: AsValidation<unknown>[key];
  };

/** Runtime predicate for correctly shaped valid tuples. */
export type ValidGuard = {
  <error, item>(
    value: Validation<error, item>,
  ): value is { value(): Valid<item> } & Validation<error, item>;
  <error, item>(value: RawValidation<error, item>): value is Valid<item>;
  (
    value: unknown,
  ): value is
    | Valid<unknown>
    | WrappedData<AsValidation<unknown>, Valid<unknown>, unknown>;
};

/** Runtime predicate for invalid tuples with a usable semigroup. */
export type InvalidGuard = {
  <error, item>(
    value: Validation<error, item>,
  ): value is { value(): Invalid<error> } & Validation<error, item>;
  <error, item>(value: RawValidation<error, item>): value is Invalid<error>;
  (
    value: unknown,
  ): value is
    | Invalid<unknown>
    | WrappedData<AsValidation<unknown>, Invalid<unknown>, unknown>;
};

/** Constructor and guard for successful Validation values. */
export type ValidConstructor = {
  <item>(value: item): Validation<never, item>;
  readonly is: ValidGuard;
};

/** Constructor and guard for failed Validation values. */
export type InvalidConstructor = {
  <error, item = never>(
    error: error,
    semigroup: ValidationSemigroup<error>,
  ): Validation<error, item>;
  readonly is: InvalidGuard;
};

/** Callable Validation dictionary with configurable error accumulation. */
export const Validation: ValidationConstructor =
  /* @__PURE__ */ create_validation();

/** Construct or match a successful Validation value. */
export const Valid: ValidConstructor =
  /* @__PURE__ */ (() => Validation.Valid)();
/** Construct or match a failed Validation value with an explicit semigroup. */
export const Invalid: InvalidConstructor =
  /* @__PURE__ */ (() => Validation.Invalid)();

function validation_with_error<error>(): ValidationDictionary<error> {
  return Validation as unknown as ValidationDictionary<error>;
}

function validation_with_semigroup<error>(
  semigroup: ValidationSemigroup<error>,
): ConfiguredValidationDictionary<error> {
  const dictionary = data<AsValidation<error>>(
    validation_identity,
  ) as ConfiguredValidationDictionary<error>;

  Object.setPrototypeOf(dictionary, Validation);
  const configured_invalid = Object.assign(
    <item = never>(error: error): Validation<error, item> =>
      dictionary<item>(["invalid", error, semigroup]) as Validation<
        error,
        item
      >,
    { is: Invalid.is },
  );
  const configured_valid = Object.assign(
    <item>(item: item): Validation<error, item> =>
      dictionary<item>(["valid", item]) as Validation<error, item>,
    { is: Valid.is },
  );
  Object.defineProperties(dictionary, {
    Invalid: { value: configured_invalid },
    Valid: { value: configured_valid },
    from_either: {
      value<item>(value: Either<error, item>): Validation<error, item> {
        const [tag, payload] = value.value();
        return tag === "Left"
          ? configured_invalid<item>(payload)
          : configured_valid(payload);
      },
    },
    from_nullable: {
      value<item>(
        value: item | null | undefined,
        on_null: () => error,
      ): Validation<error, NonNullable<item>> {
        return value == null
          ? configured_invalid<NonNullable<item>>(on_null())
          : configured_valid(value as NonNullable<item>);
      },
    },
  });
  register_traversal(
    dictionary as unknown as AsValidation<unknown>,
    traverse_validation,
  );

  return dictionary;
}

/** Convert a Validation into an Either, discarding its accumulation semigroup. */
export function validation_to_either<error, item>(
  validation: Validation<error, item>,
): Either<error, item> {
  const [tag, payload] = validation.value();
  return tag === "invalid"
    ? Left<error, item>(payload)
    : Right<error, item>(payload);
}

/** Construct a failed Validation that accumulates string message arrays. */
export function InvalidMessages<item = never>(
  first: string,
  ...rest: string[]
): Validation<readonly string[], item>;
export function InvalidMessages<item = never>(
  first: string,
): Validation<readonly string[], item> {
  return Invalid<readonly string[], item>(
    arguments.length === 1 ? [first] : Array.from(arguments),
    array_validation_semigroup as ValidationSemigroup<readonly string[]>,
  );
}

/** Map a validation error while explicitly selecting the target semigroup. */
export function map_error<error, next_error, item>(
  validation: Validation<error, item>,
  fn: (error: error) => next_error,
  semigroup: ValidationSemigroup<next_error>,
): Validation<next_error, item> {
  const [tag, payload] = validation.value();
  return tag === "invalid"
    ? Invalid<next_error, item>(fn(payload), semigroup)
    : same_context(validation);
}

function is_invalid<error, item>(
  value: Validation<error, item>,
): value is { value(): Invalid<error> } & Validation<error, item>;
function is_invalid<error, item>(
  value: RawValidation<error, item>,
): value is Invalid<error>;
function is_invalid(
  value: unknown,
): value is
  | Invalid<unknown>
  | WrappedData<AsValidation<unknown>, Invalid<unknown>, unknown>;
function is_invalid<error, item>(
  value: RawValidation<error, item> | unknown,
): value is
  | Invalid<error>
  | WrappedData<AsValidation<unknown>, Invalid<unknown>, unknown> {
  if (!Array.isArray(value)) {
    if (
      !is_data(value) ||
      (value as unknown as AsValidation<unknown>)[kind] !== Validation[kind] ||
      !Array.isArray(value = value.value())
    ) return false;
  }
  const sg = value[2];
  return value[0] === "invalid" && value.length === 3 &&
    typeof sg === "object" && sg !== null &&
    typeof (sg as ValidationSemigroup<unknown>).concat === "function";
}

function construct_invalid<error, item = never>(
  error: error,
  semigroup: ValidationSemigroup<error>,
): Validation<error, item> {
  return Validation<error, item>([
    "invalid",
    error,
    semigroup,
  ]);
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
  let id = validation_semigroup_ids.get(semigroup);
  if (id === undefined) {
    validation_semigroup_ids.set(
      semigroup,
      id = next_validation_semigroup_id++,
    );
  }
  return id;
}

function errors_equal(left: unknown, right: unknown) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    const len = left.length;
    if (len !== right.length) return false;
    for (let i = 0; i < len; i += 1) {
      if (!Object.is(left[i], right[i])) return false;
    }
    return true;
  }
  return false;
}

function compare_errors(left: unknown, right: unknown) {
  if (Array.isArray(left) && Array.isArray(right)) {
    const l = left.length, r = right.length;
    const length = l < r ? l : r;
    for (let index = 0; index < length; index += 1) {
      const order = compare_unknown(left[index], right[index]);
      if (order !== "eq") return order;
    }
    return l < r ? "lt" : l > r ? "gt" : "eq";
  }

  return compare_unknown(left, right);
}

type ValidationErrAcc = {
  sg?: ValidationSemigroup<unknown>;
  err?: unknown;
  buf?: unknown[];
};

function push_invalid_error(
  acc: ValidationErrAcc,
  raw: Invalid<unknown>,
): void {
  if (acc.sg === undefined) {
    acc.sg = raw[2];
    acc.err = raw[1];
    return;
  }
  assert_same_semigroup(acc.sg, raw[2]);
  if (acc.sg === array_validation_semigroup) {
    acc.buf ??= (acc.err as readonly unknown[]).slice();
    const errs = raw[1] as readonly unknown[];
    if (errs.length === 1) acc.buf.push(errs[0]);
    else for (let i = 0; i < errs.length; i += 1) acc.buf.push(errs[i]);
  } else acc.err = acc.sg.concat(acc.err, raw[1]);
}

const wrap_valid = <item>(value: item): Validation<never, item> => Valid(value);

function traverse_validation<from, to, result>(
  items: Iterable<from>,
  fn: (item: from) => Data<AsValidation<unknown>, to>,
  build: (items: Iterable<to>) => result,
): Data<AsValidation<unknown>, result> {
  const acc: ValidationErrAcc = {};
  let out: to[];
  if (Array.isArray(items)) {
    const len = items.length;
    out = new Array<to>(len);
    for (let i = 0; i < len; i += 1) {
      const raw = fn(items[i]).value();
      if (raw[0] === "invalid") push_invalid_error(acc, raw);
      else if (acc.sg === undefined) out[i] = raw[1];
    }
  } else {
    out = [];
    for (const item of items) {
      const raw = fn(item).value();
      if (raw[0] === "invalid") push_invalid_error(acc, raw);
      else if (acc.sg === undefined) out.push(raw[1]);
    }
  }
  return (acc.sg !== undefined
    ? Invalid(acc.buf ?? acc.err, acc.sg)
    : Valid(build(out))) as Data<AsValidation<unknown>, result>;
}

function create_validation(): ValidationConstructor {
  const Validation = data<AsValidation<unknown>>(
    validation_identity,
    union(["valid", $slot], ["invalid", $slot, $slot]),
  ) as unknown as ValidationConstructor;

  const Invalid: InvalidConstructor = Object.assign(construct_invalid, {
    is: is_invalid,
  });
  Object.defineProperties(Validation, {
    with_error: { value: validation_with_error },
    with_semigroup: { value: validation_with_semigroup },
    Invalid: { value: Invalid },
  });
  Show.instance(Validation)({
    show() {
      const [tag, payload] = this.value();
      return (tag === "valid" ? "Valid(" : "Invalid(") + inspect(payload) + ")";
    },
  });

  Eq.instance(Validation)({
    eq(right) {
      if (this === right) return true;
      const [left_tag, left_payload] = this.value();
      const [right_tag, right_payload] = right.value();
      if (left_tag !== right_tag) return false;
      return left_tag === "valid"
        ? Object.is(left_payload, right_payload)
        : errors_equal(left_payload, right_payload);
    },
  });

  Ord.instance(Validation)({
    compare(right) {
      if (this === right) return "eq";
      const [left_tag, left_payload] = this.value();
      const [right_tag, right_payload] = right.value();
      if (left_tag !== right_tag) return left_tag === "invalid" ? "lt" : "gt";
      return left_tag === "invalid"
        ? compare_errors(left_payload, right_payload)
        : compare_unknown(left_payload, right_payload);
    },
  });

  Functor.instance(Validation)({
    map(fn) {
      const [tag, payload] = this.value();
      return tag === "invalid" ? same_context(this) : Valid(fn(payload));
    },
  });

  Applicative.instance(Validation)({
    pure(value) {
      return Valid(value);
    },

    // The specialized ladder avoids the generic applicative_lift fallback's intermediates.
    [applicative_lift_method](fn, rest) {
      const first = this.value();
      const len = rest.length;
      if (len === 0) {
        return (first[0] === "invalid"
          ? this
          : Valid(fn(first[1]))) as Validation<unknown, ReturnType<typeof fn>>;
      }
      if (len === 1) {
        const right = rest[0].value();
        if (first[0] === "valid") {
          return (right[0] === "valid"
            ? Valid(fn(first[1], right[1]))
            : rest[0]) as Validation<unknown, ReturnType<typeof fn>>;
        }
        return (right[0] === "invalid"
          ? Invalid(concat_errors(first, right), first[2])
          : this) as Validation<unknown, ReturnType<typeof fn>>;
      }
      const acc: ValidationErrAcc = {};
      const values = new Array<unknown>(len + 1);
      if (first[0] === "invalid") push_invalid_error(acc, first);
      else values[0] = first[1];
      for (let i = 0; i < len; i += 1) {
        const raw = rest[i].value();
        if (raw[0] === "invalid") push_invalid_error(acc, raw);
        else if (acc.sg === undefined) values[i + 1] = raw[1];
      }
      return (acc.sg !== undefined
        ? Invalid(acc.buf ?? acc.err, acc.sg)
        : Valid(fn(...values))) as Validation<unknown, ReturnType<typeof fn>>;
    },

    ap(value) {
      const fn = this.value();
      const validation = value.value();

      if (fn[0] === "invalid") {
        return validation[0] === "invalid"
          ? Invalid(concat_errors(fn, validation), fn[2])
          : same_context(this);
      }
      return validation[0] === "invalid"
        ? same_context(value)
        : Valid(fn[1](validation[1]));
    },
  });

  Foldable.instance(Validation)({
    fold(initial, fn) {
      const [tag, payload] = this.value();
      return tag === "invalid" ? initial : fn(initial, payload);
    },
  });

  Traversable.instance(Validation)({
    traverse(applicative, fn) {
      const [tag, payload] = this.value();
      return tag === "invalid"
        ? Applicative.pure(applicative, same_context(this))
        : Functor.map(fn(payload), wrap_valid);
    },
  });

  register_traversal(Validation, traverse_validation);
  return Validation;
}
