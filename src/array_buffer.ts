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
export const array_buffer_identity: unique symbol = /* @__PURE__ */ Symbol(
  "array_buffer_identity",
);

/** The raw binary buffer wrapped by the `ArrayBufferT` dictionary. */
export type RawArrayBufferT = ArrayBuffer;

/** @ignore */
export interface AsArrayBufferLambda {
  readonly [type_item]: unknown;
  readonly [type_data]: RawArrayBufferT;
}

/** Dictionary type for byte-oriented `ArrayBuffer` values. */
export interface AsArrayBuffer
  extends
    As<AsArrayBufferLambda, typeof array_buffer_identity>,
    Show<AsArrayBuffer>,
    Eq<AsArrayBuffer>,
    Monoid<AsArrayBuffer>,
    Foldable<AsArrayBuffer> {
  /** Bytes remain numbers for every operation on this dictionary. */
  readonly [type_element]: number;
}

/** A wrapped ArrayBufferT value with its dictionary operations. */
export type ArrayBufferT = Data<AsArrayBuffer, number>;

/** Callable buffer dictionary that clones buffers when wrapping them. */
export const ArrayBufferT: AsArrayBuffer = data<AsArrayBuffer>(
  array_buffer_identity,
  function (buffer) {
    return this.data(buffer.slice(0));
  },
);

/** Copy byte-like input into a wrapped `ArrayBuffer`. */
export function from_bytes(bytes: ArrayLike<number>): ArrayBufferT {
  return as_data(ArrayBufferT, Uint8Array.from(bytes).buffer);
}

/** Copy a wrapped buffer into a new `Uint8Array`. */
export function to_bytes(buffer: ArrayBufferT): Uint8Array {
  return new Uint8Array(buffer.value().slice(0));
}

Show.instance(ArrayBufferT)({
  show() {
    return inspect(new Uint8Array(this.value()));
  },
});

Eq.instance(ArrayBufferT)({
  eq(right) {
    return bytes_equal(
      new Uint8Array(this.value()),
      new Uint8Array(right.value()),
    );
  },
});

Semigroup.instance(ArrayBufferT)({
  concat(right) {
    const left = new Uint8Array(this.value());
    const right_value = new Uint8Array(right.value());
    const out = new Uint8Array(left.length + right_value.length);

    out.set(left, 0);
    out.set(right_value, left.length);

    return as_data(ArrayBufferT, out.buffer);
  },
});

Monoid.instance(ArrayBufferT)({
  empty() {
    return as_data(ArrayBufferT, new ArrayBuffer(0));
  },
});

Foldable.instance(ArrayBufferT)({
  fold<item, output>(
    this: Data<AsArrayBuffer, item>,
    initial: output,
    fn: (state: output, item: number) => output,
  ) {
    let state = initial;

    for (const byte of new Uint8Array(this.value())) {
      state = fn(state, byte);
    }

    return state;
  },
});

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
