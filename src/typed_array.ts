import {
  type As,
  type Data,
  data,
  type type_data,
  type type_element,
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

/** @ignore */
export type TypedArrayElement<item> = item extends number ? number
  : item extends bigint ? bigint
  : number | bigint;

/** The typed-array representation wrapped by the `TypedArrayT` dictionary. */
export type TypedArrayT<item = number | bigint> = unknown extends item
  ? AnyTypedArray
  : [item] extends [never] ? never
  : [item] extends [number] ? NumericTypedArray
  : [item] extends [bigint] ? BigIntTypedArray
  : [item] extends [number | bigint] ? AnyTypedArray
  : never;

/** Dictionary type shared by numeric and big-integer typed arrays. */
export interface AsTypedArray<element extends number | bigint = number | bigint>
  extends
    As<AsTypedArray<element>, typeof typed_array_identity>,
    Show<AsTypedArray<element>>,
    Eq<AsTypedArray<element>>,
    Foldable<AsTypedArray<element>> {
  /** Higher-kinded slot for the typed-array element type. */
  readonly [type_item]: TypedArrayElement<element>;
  /** Typed-array representation at the selected element type. */
  readonly [type_data]: TypedArrayT<element>;
  /** Numeric arrays expose numbers; big-integer arrays expose bigints. */
  readonly [type_element]: TypedArrayElement<element>;
}

/** @ignore */
export type TypedArrayValue<item> = Data<
  AsTypedArray<TypedArrayElement<item>>,
  TypedArrayElement<item>
>;

/** Callable dictionary that infers numeric and big-integer elements from input. */
export type TypedArrayConstructor =
  & {
    <array extends AnyTypedArray>(array: array): TypedArrayValue<
      TypedArrayItem<array>
    >;
    <item extends number | bigint>(array: TypedArrayT<item>): TypedArrayValue<
      item
    >;
  }
  & { readonly [key in keyof AsTypedArray]: AsTypedArray[key] };

/** Callable typed-array dictionary that preserves and clones the input kind. */
export const TypedArrayT: TypedArrayConstructor = data<AsTypedArray>(
  function (array) {
    return this.data(clone_typed_array(array));
  },
) as TypedArrayConstructor;

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
    fn: (state: output, item: number | bigint) => output,
  ) {
    let state = initial;

    for (const item of this.value()) {
      state = fn(state, item);
    }

    return state;
  },
});

function clone_typed_array<array extends AnyTypedArray>(array: array): array {
  const out = same_constructor(array, array.length);
  copy_into(out, array, 0);

  return out as array;
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
