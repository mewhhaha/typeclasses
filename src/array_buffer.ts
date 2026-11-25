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
  const copy = bytes instanceof Uint8Array
    ? new Uint8Array(bytes)
    : Uint8Array.from(bytes);
  return as_data(ArrayBufferT, copy.buffer);
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
    const left_buf = this.value();
    const right_buf = right.value();
    if (left_buf === right_buf) return true;
    const len = left_buf.byteLength;
    if (len !== right_buf.byteLength) return false;
    if (len === 0) return true;
    return buffers_equal(left_buf, right_buf, len);
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
  [some_method](predicate) {
    const bytes = new Uint8Array(this.value());
    const len = bytes.length;
    for (let i = 0; i < len; i += 1) {
      if (bytes.length !== len) {
        throw new TypeError("ArrayBuffer was detached during fold");
      }
      if (predicate(bytes[i])) return true;
    }
    return false;
  },
  [find_method](predicate) {
    const bytes = new Uint8Array(this.value());
    const len = bytes.length;
    for (let i = 0; i < len; i += 1) {
      if (bytes.length !== len) {
        throw new TypeError("ArrayBuffer was detached during fold");
      }
      const byte = bytes[i];
      if (predicate(byte)) return byte;
    }
    return undefined;
  },
  [fold_while_method](initial, fn) {
    const bytes = new Uint8Array(this.value());
    const len = bytes.length;
    let state = initial;
    for (let i = 0; i < len; i += 1) {
      if (bytes.length !== len) {
        throw new TypeError("ArrayBuffer was detached during fold");
      }
      const step = fn(state, bytes[i]);
      state = step[1];
      if (step[0] === "Done") return state;
    }
    return state;
  },
  fold<item, output>(
    this: Data<AsArrayBuffer, item>,
    initial: output,
    fn: (state: output, item: number) => output,
  ) {
    const bytes = new Uint8Array(this.value());
    const len = bytes.length;
    let state = initial;

    for (let i = 0; i < len; i += 1) {
      if (bytes.length !== len) {
        throw new TypeError("ArrayBuffer was detached during fold");
      }
      state = fn(state, bytes[i]);
    }

    return state;
  },
});

function buffers_equal(
  left_buf: ArrayBuffer,
  right_buf: ArrayBuffer,
  len: number,
): boolean {
  const words = len >>> 2;
  if (words > 0) {
    const left_u32 = new Uint32Array(left_buf, 0, words);
    const right_u32 = new Uint32Array(right_buf, 0, words);
    for (let i = 0; i < words; i += 1) {
      if (left_u32[i] !== right_u32[i]) return false;
    }
  }
  const tail_start = words << 2;
  if (tail_start < len) {
    const left_u8 = new Uint8Array(left_buf);
    const right_u8 = new Uint8Array(right_buf);
    for (let i = tail_start; i < len; i += 1) {
      if (left_u8[i] !== right_u8[i]) return false;
    }
  }
  return true;
}
