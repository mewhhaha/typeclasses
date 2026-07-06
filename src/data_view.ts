import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { Eq, Foldable, Monoid, Semigroup, Show } from "./typeclasses.ts";

export type DataViewT = DataView;

export interface AsDataView
  extends
    As<AsDataView>,
    Show<AsDataView>,
    Eq<AsDataView>,
    Semigroup<AsDataView>,
    Monoid<AsDataView>,
    Foldable<AsDataView> {
  readonly [type_item]: unknown;
  readonly [type_data]: DataViewT;
}

type DataViewValue = Data<AsDataView, number>;

export const DataViewT: AsDataView = data<AsDataView>(
  function (view) {
    return this.data(clone_data_view(view));
  },
);

export function from_bytes(bytes: ArrayLike<number>): DataViewValue {
  return DataViewT(new DataView(Uint8Array.from(bytes).buffer));
}

export function to_bytes(view: DataViewValue): Uint8Array {
  return new Uint8Array(clone_data_view(view.value()).buffer);
}

Show.instance(DataViewT)({
  show() {
    return Deno.inspect(to_view_bytes(this.value()));
  },
});

Eq.instance(DataViewT)({
  eq(right) {
    return bytes_equal(
      to_view_bytes(this.value()),
      to_view_bytes(right.value()),
    );
  },
});

Semigroup.instance(DataViewT)({
  concat(right) {
    const left = to_view_bytes(this.value());
    const right_value = to_view_bytes(right.value());
    const out = new Uint8Array(left.length + right_value.length);

    out.set(left, 0);
    out.set(right_value, left.length);

    return DataViewT(new DataView(out.buffer));
  },
});

Monoid.instance(DataViewT)({
  empty() {
    return DataViewT(new DataView(new ArrayBuffer(0)));
  },
});

Foldable.instance(DataViewT)({
  fold<item, out>(
    this: Data<AsDataView, item>,
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
