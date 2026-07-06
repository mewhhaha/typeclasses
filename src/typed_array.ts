import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { Eq, Foldable, Show } from "./typeclasses.ts";

export type NumericTypedArray =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array;

export type BigIntTypedArray = BigInt64Array | BigUint64Array;

type AnyTypedArray = NumericTypedArray | BigIntTypedArray;
type TypedArrayItem<array> = array extends BigIntTypedArray ? bigint : number;

export type TypedArrayT<item = number | bigint> = AnyTypedArray;

export interface AsTypedArray
  extends
    As<AsTypedArray>,
    Show<AsTypedArray>,
    Eq<AsTypedArray>,
    Foldable<AsTypedArray> {
  readonly [type_item]: unknown;
  readonly [type_data]: TypedArrayT<this[typeof type_item]>;
}

type TypedArrayValue<item> = Data<AsTypedArray, item>;

export const TypedArrayT: AsTypedArray = data<AsTypedArray>(
  function (array) {
    return this.data(clone_typed_array(array));
  },
);

export function from_typed_array<array extends AnyTypedArray>(
  array: array,
): TypedArrayValue<TypedArrayItem<array>> {
  return TypedArrayT(array);
}

export function to_typed_array<item>(
  array: TypedArrayValue<item>,
): TypedArrayT<item> {
  return clone_typed_array(array.value()) as TypedArrayT<item>;
}

Show.instance(TypedArrayT)({
  show() {
    return Deno.inspect(this.value());
  },
});

Eq.instance(TypedArrayT)({
  eq(right) {
    const left = this.value();
    const right_value = right.value();

    if (left.constructor !== right_value.constructor) {
      return false;
    }

    if (left.length !== right_value.length) {
      return false;
    }

    for (let index = 0; index < left.length; index += 1) {
      if (!Object.is(left[index], right_value[index])) {
        return false;
      }
    }

    return true;
  },
});

Foldable.instance(TypedArrayT)({
  fold<item, out>(
    this: Data<AsTypedArray, item>,
    initial: out,
    fn: (state: out, item: item) => out,
  ) {
    let state = initial;

    for (const item of this.value()) {
      state = fn(state, item as unknown as item);
    }

    return state;
  },
});

function clone_typed_array(array: AnyTypedArray): AnyTypedArray {
  const out = same_constructor(array, array.length);
  copy_into(out, array, 0);

  return out;
}

function same_constructor(array: AnyTypedArray, length: number): AnyTypedArray {
  const constructor = array.constructor as new (
    length: number,
  ) => AnyTypedArray;
  return new constructor(length);
}

function copy_into(
  out: AnyTypedArray,
  input: AnyTypedArray,
  offset: number,
) {
  const target = out as {
    set(items: ArrayLike<number | bigint>, offset?: number): void;
  };

  target.set(input as ArrayLike<number | bigint>, offset);
}
