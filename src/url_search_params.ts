import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { inspect } from "./inspect.ts";
import { Eq, Foldable, Monoid, Semigroup, Show } from "./typeclasses.ts";

/** @ignore */
export declare const url_search_params_identity: unique symbol;

/** A name-value pair stored in URL search parameters. */
export type URLSearchParamsEntry = readonly [string, string];
/** The raw parameter collection wrapped by the `URLSearchParamsT` dictionary. */
export type URLSearchParamsT = URLSearchParams;

/** Dictionary type for ordered, potentially repeated URL parameters. */
export interface AsURLSearchParams
  extends
    As<AsURLSearchParams, typeof url_search_params_identity>,
    Show<AsURLSearchParams>,
    Eq<AsURLSearchParams>,
    Monoid<AsURLSearchParams>,
    Foldable<AsURLSearchParams> {
  /** Higher-kinded slot exposed as an entry when folding. */
  readonly [type_item]: unknown;
  /** Raw `URLSearchParams` representation for this dictionary. */
  readonly [type_data]: URLSearchParamsT;
}

/** @ignore */
export type URLSearchParamsValue = Data<
  AsURLSearchParams,
  URLSearchParamsEntry
>;

/** Callable parameter dictionary that clones collections when wrapping them. */
export const URLSearchParamsT: AsURLSearchParams = data<AsURLSearchParams>(
  function (params) {
    return this.data(new URLSearchParams(params));
  },
);

/** Build wrapped parameters by appending entries in iteration order. */
export function from_entries(
  entries: Iterable<URLSearchParamsEntry>,
): URLSearchParamsValue {
  const params = new URLSearchParams();

  for (const [name, value] of entries) {
    params.append(name, value);
  }

  return URLSearchParamsT(params) as URLSearchParamsValue;
}

/** Copy wrapped parameters into an ordered array of entries. */
export function to_entries(
  params: URLSearchParamsValue,
): URLSearchParamsEntry[] {
  return [...params.value().entries()];
}

Show.instance(URLSearchParamsT)({
  show() {
    return inspect([...this.value().entries()]);
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
  fold<item, output>(
    this: Data<AsURLSearchParams, item>,
    initial: output,
    fn: (state: output, item: item) => output,
  ) {
    let state = initial;

    for (const entry of this.value().entries()) {
      state = fn(state, entry as unknown as item);
    }

    return state;
  },
});
