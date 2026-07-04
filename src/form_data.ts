import { type As, define, type Value } from "./trait.ts";
import { Equal, Foldable, Format, Monoid, Semigroup } from "./traits.ts";

export type FormDataEntry = readonly [string, FormDataEntryValue];
export type FormDataT = FormData;

export const form_data_kind = Symbol("FormDataT");

declare module "./trait.ts" {
  interface TraitTypes<dictionary, item> {
    [form_data_kind]: FormDataT;
  }
}

export interface AsFormData extends As<typeof form_data_kind> {}

type FormDataValue = Value<AsFormData, FormDataEntry>;

export const FormDataT = define<AsFormData>(
  form_data_kind,
  function (form_data) {
    return this.as_trait(clone_form_data(form_data));
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

Format.implement(FormDataT)({
  fmt() {
    return Deno.inspect([...this.value().entries()]);
  },
});

export interface AsFormData extends Format<AsFormData> {}

Equal.implement(FormDataT)({
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

export interface AsFormData extends Equal<AsFormData> {}

Semigroup.implement(FormDataT)({
  concat(right) {
    const out = clone_form_data(this.value());

    for (const [name, value] of right.value().entries()) {
      out.append(name, value);
    }

    return FormDataT(out);
  },
});

export interface AsFormData extends Semigroup<AsFormData> {}

Monoid.implement(FormDataT)({
  empty() {
    return FormDataT(new FormData());
  },
});

export interface AsFormData extends Monoid<AsFormData> {}

Foldable.implement(FormDataT)({
  fold<item, out>(
    this: Value<AsFormData, item>,
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

export interface AsFormData extends Foldable<AsFormData> {}

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
