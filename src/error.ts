import { type As, define, type Value } from "./trait.ts";
import { Equal, Format } from "./traits.ts";

export type ErrorT = Error;

export const error_kind = Symbol("ErrorT");

declare module "./trait.ts" {
  interface TraitTypes<dictionary, item> {
    [error_kind]: ErrorT;
  }
}

export interface AsError extends As<typeof error_kind> {}

type ErrorValue = Value<AsError, Error>;

export const ErrorT = define<AsError>(
  error_kind,
);

export function from_error(error: Error): ErrorValue {
  return ErrorT(error) as ErrorValue;
}

Format.implement(ErrorT)({
  fmt() {
    return this.value().name + ": " + this.value().message;
  },
});

export interface AsError extends Format<AsError> {}

Equal.implement(ErrorT)({
  eq(right) {
    const left = this.value();
    const right_value = right.value();

    return left.name === right_value.name &&
      left.message === right_value.message &&
      Object.is(left.cause, right_value.cause);
  },
});

export interface AsError extends Equal<AsError> {}
