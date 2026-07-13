import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { Eq, Show } from "./typeclasses.ts";

/** @ignore */
export declare const date_identity: unique symbol;

/** The JavaScript date wrapped by the `DateT` dictionary. */
export type DateT = Date;

/** Dictionary type for dates with instant-based equality. */
export interface AsDate
  extends As<AsDate, typeof date_identity>, Show<AsDate>, Eq<AsDate> {
  /** Higher-kinded item slot retained for dictionary compatibility. */
  readonly [type_item]: unknown;
  /** Raw `Date` representation for this dictionary. */
  readonly [type_data]: DateT;
}

/** @ignore */
export type DateValue = Data<AsDate, Date>;

/** Callable date dictionary that clones dates when wrapping them. */
export const DateT: AsDate = data<AsDate>(
  function (date) {
    return this.data(new Date(date.getTime()));
  },
);

/** Wrap a defensive copy of a JavaScript date. */
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
