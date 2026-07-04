import { type As, define, type Value } from "./trait.ts";
import { Equal, Format } from "./traits.ts";

export type DateT = Date;

export const date_kind = Symbol("DateT");

declare module "./trait.ts" {
  interface TraitTypes<dictionary, item> {
    [date_kind]: DateT;
  }
}

export interface AsDate extends As<typeof date_kind> {}

type DateValue = Value<AsDate, Date>;

export const DateT = define<AsDate>(
  date_kind,
  function (date) {
    return this.as_trait(new Date(date.getTime()));
  },
);

export function from_date(date: Date): DateValue {
  return DateT(date) as DateValue;
}

Format.implement(DateT)({
  fmt() {
    return this.value().toISOString();
  },
});

export interface AsDate extends Format<AsDate> {}

Equal.implement(DateT)({
  eq(right) {
    return Object.is(this.value().getTime(), right.value().getTime());
  },
});

export interface AsDate extends Equal<AsDate> {}
