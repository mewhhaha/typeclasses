import {
  type As,
  type Data,
  data,
  type type_data,
  type type_element,
  type type_item,
} from "./typeclass.ts";
import { inspect } from "./inspect.ts";
import { Eq, Foldable, Monoid, Semigroup, Show } from "./typeclasses.ts";

/** @ignore */
export const url_search_params_identity: unique symbol = /* @__PURE__ */ Symbol(
  "url_search_params_identity",
);

/** A name-value pair stored in URL search parameters. */
export type URLSearchParamsEntry = readonly [string, string];
/** The raw parameter collection wrapped by the `URLSearchParamsT` dictionary. */
export type RawURLSearchParamsT = URLSearchParams;

/** @ignore */
export interface AsURLSearchParamsLambda {
  readonly [type_item]: unknown;
  readonly [type_data]: RawURLSearchParamsT;
}

/** Dictionary type for ordered, potentially repeated URL parameters. */
export interface AsURLSearchParams
  extends
    As<AsURLSearchParamsLambda, typeof url_search_params_identity>,
    Show<AsURLSearchParams>,
    Eq<AsURLSearchParams>,
    Monoid<AsURLSearchParams>,
    Foldable<AsURLSearchParams> {
  /** Folding always exposes a name-value pair. */
  readonly [type_element]: URLSearchParamsEntry;
}

/** A wrapped URLSearchParamsT value with its dictionary operations. */
export type URLSearchParamsT = Data<
  AsURLSearchParams,
  URLSearchParamsEntry
>;

/** Callable parameter dictionary that clones collections when wrapping them. */
export const URLSearchParamsT: AsURLSearchParams = data<AsURLSearchParams>(
  url_search_params_identity,
  function (params) {
    return this.data(new URLSearchParams(params));
  },
);

/** Build wrapped parameters by appending entries in iteration order. */
export function from_entries(
  entries: Iterable<URLSearchParamsEntry>,
): URLSearchParamsT {
  const params = new URLSearchParams();

  for (const [name, value] of entries) {
    params.append(name, value);
  }

  return URLSearchParamsT(params) as URLSearchParamsT;
}

/** Copy wrapped parameters into an ordered array of entries. */
export function to_entries(
  params: URLSearchParamsT,
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
    fn: (state: output, item: URLSearchParamsEntry) => output,
  ) {
    let state = initial;

    for (const entry of this.value().entries()) {
      state = fn(state, entry);
    }

    return state;
  },
});
