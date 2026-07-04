import { type As, define, type Value } from "./trait.ts";
import { Equal, Format } from "./traits.ts";

export type RegExpT = RegExp;

export const regexp_kind = Symbol("RegExpT");

declare module "./trait.ts" {
  interface TraitTypes<dictionary, item> {
    [regexp_kind]: RegExpT;
  }
}

export interface AsRegExp extends As<typeof regexp_kind> {}

type RegExpValue = Value<AsRegExp, RegExp>;

export const RegExpT = define<AsRegExp>(
  regexp_kind,
  function (regexp) {
    return this.as_trait(new RegExp(regexp.source, regexp.flags));
  },
);

export function from_regexp(regexp: RegExp): RegExpValue {
  return RegExpT(regexp) as RegExpValue;
}

Format.implement(RegExpT)({
  fmt() {
    return this.value().toString();
  },
});

export interface AsRegExp extends Format<AsRegExp> {}

Equal.implement(RegExpT)({
  eq(right) {
    const left = this.value();
    const right_value = right.value();

    return left.source === right_value.source &&
      left.flags === right_value.flags;
  },
});

export interface AsRegExp extends Equal<AsRegExp> {}
