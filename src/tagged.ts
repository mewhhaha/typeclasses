export type TaggedValue = readonly [PropertyKey, ...readonly unknown[]];

export type TagOf<value extends TaggedValue> = value[0];

type VariantOf<
  value extends TaggedValue,
  tag extends TagOf<value>,
> = Extract<value, readonly [tag, ...readonly unknown[]]>;

type PayloadOf<value extends TaggedValue> = value extends readonly [
  PropertyKey,
  ...infer payload,
] ? payload
  : never;

export type MatchCases<value extends TaggedValue, out> = {
  readonly [tag in TagOf<value>]: (
    ...payload: PayloadOf<VariantOf<value, tag>>
  ) => out;
};

export function match<value extends TaggedValue, out>(
  value: value,
  cases: MatchCases<value, out>,
): out {
  const tag = value[0] as TagOf<value>;
  const payload = value.slice(1) as unknown[];
  const handler = cases[tag] as (...payload: unknown[]) => out;

  return handler(...payload);
}
