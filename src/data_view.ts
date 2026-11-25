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
export const data_view_identity: unique symbol = /* @__PURE__ */ Symbol(
  "data_view_identity",
);

/** The raw byte view wrapped by the `DataViewT` dictionary. */
export type RawDataViewT = DataView;

/** @ignore */
export interface AsDataViewLambda {
  readonly [type_item]: unknown;
  readonly [type_data]: RawDataViewT;
}

/** Dictionary type for byte-oriented `DataView` values. */
export interface AsDataView
  extends
    As<AsDataViewLambda, typeof data_view_identity>,
    Show<AsDataView>,
    Eq<AsDataView>,
    Monoid<AsDataView>,
    Foldable<AsDataView> {
  /** Bytes remain numbers for every operation on this dictionary. */
  readonly [type_element]: number;
}

/** A wrapped DataViewT value with its dictionary operations. */
export type DataViewT = Data<AsDataView, number>;

/** Callable data-view dictionary that clones views when wrapping them. */
export const DataViewT: AsDataView = data<AsDataView>(
  data_view_identity,
  function (view) {
    return this.data(clone_data_view(view));
  },
);

/** Copy byte-like input into a wrapped `DataView`. */
export function from_bytes(bytes: ArrayLike<number>): DataViewT {
  const copy = bytes instanceof Uint8Array
    ? new Uint8Array(bytes)
    : Uint8Array.from(bytes);
  return as_data(DataViewT, new DataView(copy.buffer));
}

/** Copy the visible bytes of a wrapped view into a new `Uint8Array`. */
export function to_bytes(view: DataViewT): Uint8Array {
  return new Uint8Array(clone_view_buffer(view.value()));
}

Show.instance(DataViewT)({
  show() {
    return inspect(to_view_bytes(this.value()));
  },
});

Eq.instance(DataViewT)({
  eq(right) {
    const left_view = this.value();
    const right_view = right.value();
    if (left_view === right_view) return true;
    const len = left_view.byteLength;
    if (len !== right_view.byteLength) return false;
    if (len === 0) return true;
    const left_off = left_view.byteOffset;
    const right_off = right_view.byteOffset;
    if (left_view.buffer === right_view.buffer && left_off === right_off) {
      return true;
    }
    return views_equal(
      left_view.buffer,
      left_off,
      right_view.buffer,
      right_off,
      len,
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

    return as_data(DataViewT, new DataView(out.buffer));
  },
});

Monoid.instance(DataViewT)({
  empty() {
    return as_data(DataViewT, new DataView(new ArrayBuffer(0)));
  },
});

Foldable.instance(DataViewT)({
  [some_method](predicate) {
    const bytes = to_view_bytes(this.value());
    for (let i = 0; i < bytes.length; i += 1) {
      if (predicate(bytes[i])) return true;
    }
    return false;
  },
  [find_method](predicate) {
    const bytes = to_view_bytes(this.value());
    for (let i = 0; i < bytes.length; i += 1) {
      const byte = bytes[i];
      if (predicate(byte)) return byte;
    }
    return undefined;
  },
  [fold_while_method](initial, fn) {
    const bytes = to_view_bytes(this.value());
    let state = initial;
    for (let i = 0; i < bytes.length; i += 1) {
      const step = fn(state, bytes[i]);
      state = step[1];
      if (step[0] === "Done") return state;
    }
    return state;
  },
  fold<item, output>(
    this: Data<AsDataView, item>,
    initial: output,
    fn: (state: output, item: number) => output,
  ) {
    const bytes = to_view_bytes(this.value());
    let state = initial;

    for (let i = 0; i < bytes.length; i += 1) {
      state = fn(state, bytes[i]);
    }

    return state;
  },
});

function clone_view_buffer(view: DataView): ArrayBuffer {
  if (view.buffer instanceof ArrayBuffer) {
    return view.buffer.slice(
      view.byteOffset,
      view.byteOffset + view.byteLength,
    );
  }
  const copy = new Uint8Array(view.byteLength);
  copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  return copy.buffer;
}

function clone_data_view(view: DataView): DataView {
  return new DataView(clone_view_buffer(view));
}

function to_view_bytes(view: DataView): Uint8Array {
  return new Uint8Array(
    view.buffer,
    view.byteOffset,
    view.byteLength,
  );
}

function views_equal(
  left_buf: ArrayBufferLike,
  left_off: number,
  right_buf: ArrayBufferLike,
  right_off: number,
  len: number,
): boolean {
  const left_rem = left_off & 3;
  if (
    left_rem === (right_off & 3) &&
    (left_rem === 0 ? len >= 4 : len >= 8)
  ) {
    let pos = 0;
    if (left_rem !== 0) {
      const prefix = 4 - left_rem;
      const lu = new Uint8Array(left_buf, left_off, prefix);
      const ru = new Uint8Array(right_buf, right_off, prefix);
      for (let i = 0; i < prefix; i += 1) {
        if (lu[i] !== ru[i]) return false;
      }
      pos = prefix;
    }
    const words = (len - pos) >>> 2;
    if (words > 0) {
      const lu32 = new Uint32Array(left_buf, left_off + pos, words);
      const ru32 = new Uint32Array(right_buf, right_off + pos, words);
      for (let i = 0; i < words; i += 1) {
        if (lu32[i] !== ru32[i]) return false;
      }
      pos += words << 2;
    }
    if (pos < len) {
      const rem = len - pos;
      const lu = new Uint8Array(left_buf, left_off + pos, rem);
      const ru = new Uint8Array(right_buf, right_off + pos, rem);
      for (let i = 0; i < rem; i += 1) {
        if (lu[i] !== ru[i]) return false;
      }
    }
    return true;
  }
  const left = new Uint8Array(left_buf, left_off, len);
  const right = new Uint8Array(right_buf, right_off, len);
  for (let index = 0; index < len; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}
