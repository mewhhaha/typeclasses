import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { Eq, Show } from "./typeclasses.ts";

export type RegExpT = RegExp;

export interface AsRegExp extends As<AsRegExp>, Show<AsRegExp>, Eq<AsRegExp> {
  readonly [type_item]: unknown;
  readonly [type_data]: RegExpT;
}

type RegExpValue = Data<AsRegExp, RegExp>;

export const RegExpT = data<AsRegExp>(
  function (regexp) {
    return this.data(new RegExp(regexp.source, regexp.flags));
  },
);

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
