import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { inspect } from "./inspect.ts";
import { Eq, Foldable, Show } from "./typeclasses.ts";

/** @ignore */
export declare const typed_array_identity: unique symbol;

/** Any JavaScript typed array whose elements are numbers. */
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

/** Any JavaScript typed array whose elements are big integers. */
export type BigIntTypedArray = BigInt64Array | BigUint64Array;

/** @ignore */
export type AnyTypedArray = NumericTypedArray | BigIntTypedArray;
/** @ignore */
export type TypedArrayItem<array> = array extends BigIntTypedArray ? bigint
  : number;

/** The typed-array representation wrapped by the `TypedArrayT` dictionary. */
export type TypedArrayT<item = number | bigint> = AnyTypedArray;

/** Dictionary type shared by numeric and big-integer typed arrays. */
export interface AsTypedArray
  extends
    As<AsTypedArray, typeof typed_array_identity>,
    Show<AsTypedArray>,
    Eq<AsTypedArray>,
    Foldable<AsTypedArray> {
  /** Higher-kinded slot for the typed-array element type. */
  readonly [type_item]: unknown;
  /** Typed-array representation at the selected element type. */
  readonly [type_data]: TypedArrayT<this[typeof type_item]>;
}

/** @ignore */
export type TypedArrayValue<item> = Data<AsTypedArray, item>;

/** Callable typed-array dictionary that preserves and clones the input kind. */
export const TypedArrayT: AsTypedArray = data<AsTypedArray>(
  function (array) {
    return this.data(clone_typed_array(array));
  },
);

/** Wrap a defensive copy of a JavaScript typed array. */
export function from_typed_array<array extends AnyTypedArray>(
  array: array,
): TypedArrayValue<TypedArrayItem<array>> {
  return TypedArrayT(array);
}

/** Copy a wrapped value into a typed array of the same concrete kind. */
export function to_typed_array<item>(
  array: TypedArrayValue<item>,
): TypedArrayT<item> {
  return clone_typed_array(array.value()) as TypedArrayT<item>;
}

Show.instance(TypedArrayT)({
  show() {
    return inspect(this.value());
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
  fold<item, output>(
    this: Data<AsTypedArray, item>,
    initial: output,
    fn: (state: output, item: item) => output,
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
