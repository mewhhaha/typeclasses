import { type As, define, type Value } from "./trait.ts";
import { Equal, Foldable, Format, Monoid, Semigroup } from "./traits.ts";

export type URLSearchParamsEntry = readonly [string, string];
export type URLSearchParamsT = URLSearchParams;

export const url_search_params_kind = Symbol("URLSearchParamsT");

declare module "./trait.ts" {
  interface TraitTypes<dictionary, item> {
    [url_search_params_kind]: URLSearchParamsT;
  }
}

export interface AsURLSearchParams extends As<typeof url_search_params_kind> {}

type URLSearchParamsValue = Value<
  AsURLSearchParams,
  URLSearchParamsEntry
>;

export const URLSearchParamsT = define<AsURLSearchParams>(
  url_search_params_kind,
  function (params) {
    return this.as_trait(new URLSearchParams(params));
  },
);

export function from_entries(
  entries: Iterable<URLSearchParamsEntry>,
): URLSearchParamsValue {
  const params = new URLSearchParams();

  for (const [name, value] of entries) {
    params.append(name, value);
  }

  return URLSearchParamsT(params) as URLSearchParamsValue;
}

export function to_entries(
  params: URLSearchParamsValue,
): URLSearchParamsEntry[] {
  return [...params.value().entries()];
}

Format.implement(URLSearchParamsT)({
  fmt() {
    return Deno.inspect([...this.value().entries()]);
  },
});

export interface AsURLSearchParams extends Format<AsURLSearchParams> {}

Equal.implement(URLSearchParamsT)({
  eq(right) {
    const left_entries = [...this.value().entries()];
    const right_entries = [...right.value().entries()];

    if (left_entries.length !== right_entries.length) {
      return false;
    }

    for (let index = 0; index < left_entries.length; index += 1) {
      const [left_key, left_value] = left_entries[index];
      const [right_key, right_value] = right_entries[index];

      if (left_key !== right_key || left_value !== right_value) {
        return false;
      }
    }

    return true;
  },
});

export interface AsURLSearchParams extends Equal<AsURLSearchParams> {}

Semigroup.implement(URLSearchParamsT)({
  concat(right) {
    const out = new URLSearchParams(this.value());

    for (const [name, value] of right.value()) {
      out.append(name, value);
    }

    return URLSearchParamsT(out);
  },
});

export interface AsURLSearchParams extends Semigroup<AsURLSearchParams> {}

Monoid.implement(URLSearchParamsT)({
  empty() {
    return URLSearchParamsT(new URLSearchParams());
  },
});

export interface AsURLSearchParams extends Monoid<AsURLSearchParams> {}

Foldable.implement(URLSearchParamsT)({
  fold<item, out>(
    this: Value<AsURLSearchParams, item>,
    initial: out,
    fn: (state: out, item: item) => out,
  ) {
    let state = initial;

    for (const entry of this.value().entries()) {
      state = fn(state, entry as unknown as item);
    }

    return state;
  },
});

export interface AsURLSearchParams extends Foldable<AsURLSearchParams> {}
