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
export declare const form_data_identity: unique symbol;

/** A name-value pair stored in `FormData`. */
export type FormDataEntry = readonly [string, FormDataEntryValue];
/** The raw form payload wrapped by the `FormDataT` dictionary. */
export type FormDataT = FormData;

/** Dictionary type for ordered, potentially repeated form entries. */
export interface AsFormData
  extends
    As<AsFormData, typeof form_data_identity>,
    Show<AsFormData>,
    Eq<AsFormData>,
    Monoid<AsFormData>,
    Foldable<AsFormData> {
  /** Higher-kinded slot exposed as a form entry when folding. */
  readonly [type_item]: unknown;
  /** Raw `FormData` representation for this dictionary. */
  readonly [type_data]: FormDataT;
}

/** @ignore */
export type FormDataValue = Data<AsFormData, FormDataEntry>;

/** Callable form-data dictionary that clones forms when wrapping them. */
export const FormDataT: AsFormData = data<AsFormData>(
  function (form_data) {
    return this.data(clone_form_data(form_data));
  },
);

/** Build wrapped form data by appending entries in iteration order. */
export function from_entries(
  entries: Iterable<FormDataEntry>,
): FormDataValue {
  return FormDataT(form_data_from_entries(entries)) as FormDataValue;
}

/** Copy a wrapped form into an ordered array of entries. */
export function to_entries(form_data: FormDataValue): FormDataEntry[] {
  return [...form_data.value().entries()];
}

Show.instance(FormDataT)({
  show() {
    return inspect([...this.value().entries()]);
  },
});

Eq.instance(FormDataT)({
  eq(right) {
    const left_entries = [...this.value().entries()];
    const right_entries = [...right.value().entries()];

    if (left_entries.length !== right_entries.length) {
      return false;
    }

    for (let index = 0; index < left_entries.length; index += 1) {
      const [left_key, left_value] = left_entries[index];
      const [right_key, right_value] = right_entries[index];

      if (left_key !== right_key || !Object.is(left_value, right_value)) {
        return false;
      }
    }

    return true;
  },
});

Semigroup.instance(FormDataT)({
  concat(right) {
    const out = clone_form_data(this.value());

    for (const [name, value] of right.value().entries()) {
      out.append(name, value);
    }

    return FormDataT(out);
  },
});

Monoid.instance(FormDataT)({
  empty() {
    return FormDataT(new FormData());
  },
});

Foldable.instance(FormDataT)({
  fold<item, output>(
    this: Data<AsFormData, item>,
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
