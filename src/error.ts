import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { Eq, Show } from "./typeclasses.ts";

/** @ignore */
export const error_identity: unique symbol = /* @__PURE__ */ Symbol(
  "error_identity",
);

/** The JavaScript error wrapped by the `ErrorT` dictionary. */
export type RawErrorT = Error;

/** @ignore */
export interface AsErrorLambda {
  readonly [type_item]: unknown;
  readonly [type_data]: RawErrorT;
}

/** Dictionary type for errors compared by name, message, and cause. */
export interface AsError
  extends As<AsErrorLambda, typeof error_identity>, Show<AsError>, Eq<AsError> {
}

/** A wrapped ErrorT value with its dictionary operations. */
export type ErrorT = Data<AsError, Error>;

/** Callable dictionary for wrapping JavaScript errors by reference. */
export const ErrorT: AsError = data<AsError>(error_identity);

/** Wrap a JavaScript error without cloning it. */
export function from_error(error: Error): ErrorT {
  return ErrorT(error) as ErrorT;
}

Show.instance(ErrorT)({
  show() {
    return this.value().name + ": " + this.value().message;
  },
});

Eq.instance(ErrorT)({
  eq(right) {
    const left = this.value();
    const right_value = right.value();

    return left.name === right_value.name &&
      left.message === right_value.message &&
      Object.is(left.cause, right_value.cause);
  },
});
