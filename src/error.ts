import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { Eq, Show } from "./typeclasses.ts";

export type ErrorT = Error;

export interface AsError extends As<AsError>, Show<AsError>, Eq<AsError> {
  readonly [type_item]: unknown;
  readonly [type_data]: ErrorT;
}

type ErrorValue = Data<AsError, Error>;

export const ErrorT: AsError = data<AsError>();

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
