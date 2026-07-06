import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { Eq, Show } from "./typeclasses.ts";

export type DateT = Date;

export interface AsDate extends As<AsDate>, Show<AsDate>, Eq<AsDate> {
  readonly [type_item]: unknown;
  readonly [type_data]: DateT;
}

type DateValue = Data<AsDate, Date>;

export const DateT: AsDate = data<AsDate>(
  function (date) {
    return this.data(new Date(date.getTime()));
  },
);

export function from_date(date: Date): DateValue {
  return DateT(date) as DateValue;
}

Show.instance(DateT)({
  show() {
    return this.value().toISOString();
  },
});

Eq.instance(DateT)({
  eq(right) {
    return Object.is(this.value().getTime(), right.value().getTime());
  },
});
