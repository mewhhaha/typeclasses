import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { Eq, Show } from "./typeclasses.ts";

/** @ignore */
export declare const regexp_identity: unique symbol;

/** The JavaScript regular expression wrapped by the `RegExpT` dictionary. */
export type RegExpT = RegExp;

/** Dictionary type for regular expressions compared by source and flags. */
export interface AsRegExp
  extends As<AsRegExp, typeof regexp_identity>, Show<AsRegExp>, Eq<AsRegExp> {
  /** Higher-kinded item slot retained for dictionary compatibility. */
  readonly [type_item]: unknown;
  /** Raw `RegExp` representation for this dictionary. */
  readonly [type_data]: RegExpT;
}

/** @ignore */
export type RegExpValue = Data<AsRegExp, RegExp>;

/** Callable regular-expression dictionary that clones source and flags. */
export const RegExpT: AsRegExp = data<AsRegExp>(
  function (regexp) {
    return this.data(new RegExp(regexp.source, regexp.flags));
  },
);

/** Wrap a copy of a regular expression's source and flags. */
export function from_regexp(regexp: RegExp): RegExpValue {
  return RegExpT(regexp) as RegExpValue;
}

Show.instance(RegExpT)({
  show() {
    return this.value().toString();
  },
});

Eq.instance(RegExpT)({
  eq(right) {
    const left = this.value();
    const right_value = right.value();

    return left.source === right_value.source &&
      left.flags === right_value.flags;
  },
});
