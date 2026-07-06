import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { Eq, Foldable, Monoid, Semigroup, Show } from "./typeclasses.ts";

export type FormDataEntry = readonly [string, FormDataEntryValue];
export type FormDataT = FormData;

export interface AsFormData
  extends
    As<AsFormData>,
    Show<AsFormData>,
    Eq<AsFormData>,
    Semigroup<AsFormData>,
    Monoid<AsFormData>,
    Foldable<AsFormData> {
  readonly [type_item]: unknown;
  readonly [type_data]: FormDataT;
}

type FormDataValue = Data<AsFormData, FormDataEntry>;

export const FormDataT: AsFormData = data<AsFormData>(
  function (form_data) {
    return this.data(clone_form_data(form_data));
  },
);

export function from_entries(
  entries: Iterable<FormDataEntry>,
): FormDataValue {
  return FormDataT(form_data_from_entries(entries)) as FormDataValue;
}

export function to_entries(form_data: FormDataValue): FormDataEntry[] {
  return [...form_data.value().entries()];
}

Show.instance(FormDataT)({
  show() {
    return Deno.inspect([...this.value().entries()]);
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
  fold<item, out>(
    this: Data<AsFormData, item>,
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
