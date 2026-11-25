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
export const form_data_identity: unique symbol = /* @__PURE__ */ Symbol(
  "form_data_identity",
);

/** A name-value pair stored in `FormData`. */
export type FormDataEntry = readonly [string, FormDataEntryValue];
/** The raw form payload wrapped by the `FormDataT` dictionary. */
export type RawFormDataT = FormData;

/** @ignore */
export interface AsFormDataLambda {
  readonly [type_item]: unknown;
  readonly [type_data]: RawFormDataT;
}

/** Dictionary type for ordered, potentially repeated form entries. */
export interface AsFormData
  extends
    As<AsFormDataLambda, typeof form_data_identity>,
    Show<AsFormData>,
    Eq<AsFormData>,
    Monoid<AsFormData>,
    Foldable<AsFormData> {
  /** Folding always exposes a form entry. */
  readonly [type_element]: FormDataEntry;
}

/** A wrapped FormDataT value with its dictionary operations. */
export type FormDataT = Data<AsFormData, FormDataEntry>;

/** Callable form-data dictionary that clones forms when wrapping them. */
export const FormDataT: AsFormData = data<AsFormData>(
  form_data_identity,
  function (form_data) {
    return this.data(clone_form_data(form_data));
  },
);

/** Build wrapped form data by appending entries in iteration order. */
export function from_entries(
  entries: Iterable<FormDataEntry>,
): FormDataT {
  return as_data(FormDataT, form_data_from_entries(entries)) as FormDataT;
}

/** Copy a wrapped form into an ordered array of entries. */
export function to_entries(form_data: FormDataT): FormDataEntry[] {
  return [...form_data.value().entries()];
}

Show.instance(FormDataT)({
  show() {
    return inspect([...this.value().entries()]);
  },
});

Eq.instance(FormDataT)({
  eq(right) {
    const left_iter = this.value().entries();
    const right_iter = right.value().entries();
    while (true) {
      const l = left_iter.next();
      const r = right_iter.next();
      if (l.done) return r.done === true;
      if (r.done) return false;
      if (l.value[0] !== r.value[0] || !Object.is(l.value[1], r.value[1])) {
        return false;
      }
    }
  },
});

Semigroup.instance(FormDataT)({
  concat(right) {
    const out = clone_form_data(this.value());

    for (const [name, value] of right.value().entries()) {
      out.append(name, value);
    }

    return as_data(FormDataT, out);
  },
});

Monoid.instance(FormDataT)({
  empty() {
    return as_data(FormDataT, new FormData());
  },
});

Foldable.instance(FormDataT)({
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
    this: Data<AsFormData, item>,
    initial: output,
    fn: (state: output, item: FormDataEntry) => output,
  ) {
    let state = initial;

    for (const entry of this.value().entries()) {
      state = fn(state, entry);
    }

    return state;
  },
});

function clone_form_data(form_data: FormData): FormData {
  return form_data_from_entries(form_data.entries());
}

function form_data_from_entries(entries: Iterable<FormDataEntry>): FormData {
  const out = new FormData();

  for (const [name, value] of entries) {
    out.append(name, value);
  }

  return out;
}
