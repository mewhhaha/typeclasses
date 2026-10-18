import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { Eq, Show } from "./typeclasses.ts";

/** @ignore */
export const regexp_identity: unique symbol = /* @__PURE__ */ Symbol(
  "regexp_identity",
);

/** The JavaScript regular expression wrapped by the `RegExpT` dictionary. */
export type RawRegExpT = RegExp;

/** @ignore */
export interface AsRegExpLambda {
  readonly [type_item]: unknown;
  readonly [type_data]: RawRegExpT;
}

/** Dictionary type for regular expressions compared by source and flags. */
export interface AsRegExp
  extends
    As<AsRegExpLambda, typeof regexp_identity>,
    Show<AsRegExp>,
    Eq<AsRegExp> {
}

/** A wrapped RegExpT value with its dictionary operations. */
export type RegExpT = Data<AsRegExp, RegExp>;

/** Callable regular-expression dictionary that clones source and flags. */
export const RegExpT: AsRegExp = data<AsRegExp>(
  regexp_identity,
  function (regexp) {
    return this.data(new RegExp(regexp.source, regexp.flags));
  },
);

/** Wrap a copy of a regular expression's source and flags. */
export function from_regexp(regexp: RegExp): RegExpT {
  return RegExpT(regexp) as RegExpT;
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
