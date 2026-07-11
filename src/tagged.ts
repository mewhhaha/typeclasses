import {
  is_data,
  match_tagged,
  type TaggedMatchCases,
  type TaggedValue,
  type WrappedData,
} from "./typeclass.ts";

export type { TaggedValue } from "./typeclass.ts";
export type MatchValue =
  | TaggedValue
  | WrappedData<object, TaggedValue, unknown>;

type TaggedOf<value extends MatchValue> = value extends WrappedData<
  object,
  infer tagged,
  unknown
> ? tagged extends TaggedValue ? tagged : never
  : value;

export type TagOf<value extends MatchValue> = TaggedOf<value>[0];

export type MatchCases<value extends MatchValue, out> = TaggedMatchCases<
  TaggedOf<value>,
  out
>;

export function match<value extends MatchValue, out>(
  value: value,
  cases: MatchCases<value, out>,
): out {
  const tagged = (is_data(value) ? value.value() : value) as TaggedValue;
  return match_tagged(tagged, cases as TaggedMatchCases<TaggedValue, out>);
}
