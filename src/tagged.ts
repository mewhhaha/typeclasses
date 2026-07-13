import {
  is_data,
  match_tagged,
  type TaggedMatchCases,
  type TaggedValue,
  type WrappedData,
} from "./typeclass.ts";

export type { TaggedValue } from "./typeclass.ts";
/** A raw tagged tuple or a wrapped tagged value accepted by match. */
export type MatchValue =
  | TaggedValue
  | WrappedData<object, TaggedValue, unknown>;

/** @ignore */
export type TaggedOf<value extends MatchValue> = value extends WrappedData<
  object,
  infer tagged,
  unknown
> ? tagged extends TaggedValue ? tagged : never
  : value;

/** Extract the discriminant type from a raw or wrapped tagged value. */
export type TagOf<value extends MatchValue> = TaggedOf<value>[0];

/** Exhaustive handler functions for a raw or wrapped tagged value. */
export type MatchCases<value extends MatchValue, output> = TaggedMatchCases<
  TaggedOf<value>,
  output
>;

/** Select and run a handler using a tagged tuple's discriminant. */
export function match<value extends MatchValue, output>(
  value: value,
  cases: MatchCases<value, output>,
): output {
  const tagged = (is_data(value) ? value.value() : value) as TaggedValue;
  return match_tagged(tagged, cases as TaggedMatchCases<TaggedValue, output>);
}
