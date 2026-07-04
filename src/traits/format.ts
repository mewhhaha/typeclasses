import {
  call_trait_method,
  define_trait,
  type Dictionary,
  type TraitDictionary,
  type Value,
} from "../trait.ts";

export const format_trait = Symbol("Format");

export interface Format<dictionary extends Dictionary> extends
  TraitDictionary<
    dictionary,
    typeof format_trait,
    {
      fmt: (this: Value<dictionary, unknown>) => string;
    }
  > {}

export const Format = define_trait(format_trait, {
  fmt<dictionary extends Format<dictionary>>(
    value: Value<dictionary, unknown>,
  ): string {
    return call_trait_method(this.implementation(value).fmt, value);
  },
});
