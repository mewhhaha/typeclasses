import { type As, define, type Value } from "./trait.ts";
import { Equal, Foldable, Format, Monoid, Semigroup } from "./traits.ts";

export type ArrayBufferT = ArrayBuffer;

export const array_buffer_kind = Symbol("ArrayBufferT");

declare module "./trait.ts" {
  interface TraitTypes<dictionary, item> {
    [array_buffer_kind]: ArrayBufferT;
  }
}

export interface AsArrayBuffer extends As<typeof array_buffer_kind> {}

type ArrayBufferValue = Value<AsArrayBuffer, number>;

export const ArrayBufferT = define<AsArrayBuffer>(
  array_buffer_kind,
  function (buffer) {
    return this.as_trait(buffer.slice(0));
  },
);

export function from_bytes(bytes: ArrayLike<number>): ArrayBufferValue {
  return ArrayBufferT(Uint8Array.from(bytes).buffer);
}

export function to_bytes(buffer: ArrayBufferValue): Uint8Array {
  return new Uint8Array(buffer.value().slice(0));
}

Format.implement(ArrayBufferT)({
  fmt() {
    return Deno.inspect(new Uint8Array(this.value()));
  },
});

export interface AsArrayBuffer extends Format<AsArrayBuffer> {}

Equal.implement(ArrayBufferT)({
  eq(right) {
    return bytes_equal(
      new Uint8Array(this.value()),
      new Uint8Array(right.value()),
    );
  },
});

export interface AsArrayBuffer extends Equal<AsArrayBuffer> {}

Semigroup.implement(ArrayBufferT)({
  concat(right) {
    const left = new Uint8Array(this.value());
    const right_value = new Uint8Array(right.value());
    const out = new Uint8Array(left.length + right_value.length);

    out.set(left, 0);
    out.set(right_value, left.length);

    return ArrayBufferT(out.buffer);
  },
});

export interface AsArrayBuffer extends Semigroup<AsArrayBuffer> {}

Monoid.implement(ArrayBufferT)({
  empty() {
    return ArrayBufferT(new ArrayBuffer(0));
  },
});

export interface AsArrayBuffer extends Monoid<AsArrayBuffer> {}

Foldable.implement(ArrayBufferT)({
  fold<item, out>(
    this: Value<AsArrayBuffer, item>,
    initial: out,
    fn: (state: out, item: item) => out,
  ) {
    let state = initial;

    for (const byte of new Uint8Array(this.value())) {
      state = fn(state, byte as unknown as item);
    }

    return state;
  },
});

export interface AsArrayBuffer extends Foldable<AsArrayBuffer> {}

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
