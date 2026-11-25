import {
  find_method,
  fold_while_method,
  some_method,
} from "./typeclasses/foldable.ts";
import {
  type As,
  as_data,
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

  return as_data(URLSearchParamsT, params) as URLSearchParamsT;
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
    const left_params = this.value();
    const right_params = right.value();
    if (left_params.size !== right_params.size) return false;
    const left_iter = left_params.entries();
    const right_iter = right_params.entries();
    while (true) {
      const l = left_iter.next();
      const r = right_iter.next();
      if (l.done) return r.done === true;
      if (r.done) return false;
      if (l.value[0] !== r.value[0] || l.value[1] !== r.value[1]) return false;
    }
  },
});

Semigroup.instance(URLSearchParamsT)({
  concat(right) {
    const out = new URLSearchParams(this.value());

    for (const [name, value] of right.value()) {
      out.append(name, value);
    }

    return as_data(URLSearchParamsT, out);
  },
});

Monoid.instance(URLSearchParamsT)({
  empty() {
    return as_data(URLSearchParamsT, new URLSearchParams());
  },
});

Foldable.instance(URLSearchParamsT)({
  [some_method](predicate) {
    for (const entry of this.value().entries()) {
      if (predicate(entry)) return true;
    }
    return false;
  },
  [find_method](predicate) {
    for (const entry of this.value().entries()) {
      if (predicate(entry)) return entry;
    }
    return undefined;
  },
  [fold_while_method](initial, fn) {
    let state = initial;
    for (const entry of this.value().entries()) {
      const step = fn(state, entry);
      state = step[1];
      if (step[0] === "Done") return state;
    }
    return state;
  },
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
