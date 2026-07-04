import { type As, define, type Value } from "./trait.ts";
import { Equal, Foldable, Format, Monoid, Semigroup } from "./traits.ts";

export type DataViewT = DataView;

export const data_view_kind = Symbol("DataViewT");

declare module "./trait.ts" {
  interface TraitTypes<dictionary, item> {
    [data_view_kind]: DataViewT;
  }
}

export interface AsDataView extends As<typeof data_view_kind> {}

type DataViewValue = Value<AsDataView, number>;

export const DataViewT = define<AsDataView>(
  data_view_kind,
  function (view) {
    return this.as_trait(clone_data_view(view));
  },
);

export function from_bytes(bytes: ArrayLike<number>): DataViewValue {
  return DataViewT(new DataView(Uint8Array.from(bytes).buffer));
}

export function to_bytes(view: DataViewValue): Uint8Array {
  return new Uint8Array(clone_data_view(view.value()).buffer);
}

Format.implement(DataViewT)({
  fmt() {
    return Deno.inspect(to_view_bytes(this.value()));
  },
});

export interface AsDataView extends Format<AsDataView> {}

Equal.implement(DataViewT)({
  eq(right) {
    return bytes_equal(
      to_view_bytes(this.value()),
      to_view_bytes(right.value()),
    );
  },
});

export interface AsDataView extends Equal<AsDataView> {}

Semigroup.implement(DataViewT)({
  concat(right) {
    const left = to_view_bytes(this.value());
    const right_value = to_view_bytes(right.value());
    const out = new Uint8Array(left.length + right_value.length);

    out.set(left, 0);
    out.set(right_value, left.length);

    return DataViewT(new DataView(out.buffer));
  },
});

export interface AsDataView extends Semigroup<AsDataView> {}

Monoid.implement(DataViewT)({
  empty() {
    return DataViewT(new DataView(new ArrayBuffer(0)));
  },
});

export interface AsDataView extends Monoid<AsDataView> {}

Foldable.implement(DataViewT)({
  fold<item, out>(
    this: Value<AsDataView, item>,
    initial: out,
    fn: (state: out, item: item) => out,
  ) {
    let state = initial;

    for (const byte of to_view_bytes(this.value())) {
      state = fn(state, byte as unknown as item);
    }

    return state;
  },
});

export interface AsDataView extends Foldable<AsDataView> {}

function clone_data_view(view: DataView): DataView {
  const bytes = to_view_bytes(view);
  return new DataView(bytes.buffer);
}

function to_view_bytes(view: DataView): Uint8Array {
  return new Uint8Array(
    view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength),
  );
}

function bytes_equal(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}
