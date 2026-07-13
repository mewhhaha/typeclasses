import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { Eq, Show } from "./typeclasses.ts";

/** @ignore */
export declare const error_identity: unique symbol;

/** The JavaScript error wrapped by the `ErrorT` dictionary. */
export type ErrorT = Error;

/** Dictionary type for errors compared by name, message, and cause. */
export interface AsError
  extends As<AsError, typeof error_identity>, Show<AsError>, Eq<AsError> {
  /** Higher-kinded item slot retained for dictionary compatibility. */
  readonly [type_item]: unknown;
  /** Raw `Error` representation for this dictionary. */
  readonly [type_data]: ErrorT;
}

/** @ignore */
export type ErrorValue = Data<AsError, Error>;

/** Callable dictionary for wrapping JavaScript errors by reference. */
export const ErrorT: AsError = data<AsError>();

/** Wrap a JavaScript error without cloning it. */
export function from_error(error: Error): ErrorValue {
  return ErrorT(error) as ErrorValue;
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
