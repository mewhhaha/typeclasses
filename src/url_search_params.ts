import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { Eq, Foldable, Monoid, Semigroup, Show } from "./typeclasses.ts";

export type URLSearchParamsEntry = readonly [string, string];
export type URLSearchParamsT = URLSearchParams;

export interface AsURLSearchParams
  extends
    As<AsURLSearchParams>,
    Show<AsURLSearchParams>,
    Eq<AsURLSearchParams>,
    Monoid<AsURLSearchParams>,
    Foldable<AsURLSearchParams> {
  readonly [type_item]: unknown;
  readonly [type_data]: URLSearchParamsT;
}

type URLSearchParamsValue = Data<
  AsURLSearchParams,
  URLSearchParamsEntry
>;

export const URLSearchParamsT: AsURLSearchParams = data<AsURLSearchParams>(
  function (params) {
    return this.data(new URLSearchParams(params));
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

Show.instance(URLSearchParamsT)({
  show() {
    return Deno.inspect([...this.value().entries()]);
  },
});

Eq.instance(URLSearchParamsT)({
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

Semigroup.instance(URLSearchParamsT)({
  concat(right) {
    const out = new URLSearchParams(this.value());

    for (const [name, value] of right.value()) {
      out.append(name, value);
    }

    return URLSearchParamsT(out);
  },
});

Monoid.instance(URLSearchParamsT)({
  empty() {
    return URLSearchParamsT(new URLSearchParams());
  },
});

Foldable.instance(URLSearchParamsT)({
  fold<item, out>(
    this: Data<AsURLSearchParams, item>,
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
