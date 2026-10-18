import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { Eq, Show } from "./typeclasses.ts";

/** @ignore */
export const date_identity: unique symbol = /* @__PURE__ */ Symbol(
  "date_identity",
);

/** The JavaScript date wrapped by the `DateT` dictionary. */
export type RawDateT = Date;

/** @ignore */
export interface AsDateLambda {
  readonly [type_item]: unknown;
  readonly [type_data]: RawDateT;
}

/** Dictionary type for dates with instant-based equality. */
export interface AsDate
  extends As<AsDateLambda, typeof date_identity>, Show<AsDate>, Eq<AsDate> {
}

/** A wrapped DateT value with its dictionary operations. */
export type DateT = Data<AsDate, Date>;

/** Callable date dictionary that clones dates when wrapping them. */
export const DateT: AsDate = data<AsDate>(date_identity, function (date) {
  return this.data(new Date(date.getTime()));
});

/** Wrap a defensive copy of a JavaScript date. */
export function from_date(date: Date): DateT {
  return DateT(date) as DateT;
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
