import { ArrayBufferT, type AsArrayBuffer } from "./array_buffer.ts";
import { assert_equals, assert_true } from "./assert.ts";
import { DataViewT } from "./data_view.ts";
import { Right } from "./either.ts";
import { sum_values } from "./examples.ts";
import { type FormDataEntry, FormDataT } from "./form_data.ts";
import { Just, Maybe, type MaybeValue } from "./maybe.ts";
import { elem, foldl, product, sum, to_array } from "./prelude.ts";
import {
  $slot,
  type As,
  as_data,
  as_data_cached,
  data,
  install_instance,
  type type_data,
  type type_item,
  union,
} from "./typeclass.ts";
import { Applicative, Foldable, Monoid } from "./typeclasses.ts";
import { type AsTypedArray, TypedArrayT } from "./typed_array.ts";
import { URLSearchParamsT } from "./url_search_params.ts";

const symbol_tag = Symbol("SymbolVariant");
declare const numeric_identity: unique symbol;

interface AsNumeric extends As<AsNumeric, typeof numeric_identity> {
  readonly [type_item]: unknown;
  readonly [type_data]:
    | readonly [0]
    | readonly [1, this[typeof type_item]]
    | readonly [typeof symbol_tag, this[typeof type_item]];
}

Deno.test("union constructors preserve numeric and symbol tags", () => {
  const Numeric = data<AsNumeric>(
    union([0], [1, $slot], [symbol_tag, $slot]),
  );

  assert_equals(Numeric[0]().value(), [0]);
  assert_equals(Numeric[1](42).value(), [1, 42]);
  assert_equals(Numeric[symbol_tag](42).value(), [symbol_tag, 42]);
  assert_equals(Numeric[0].is([0]), true);
  assert_equals(Numeric[0].is(["0"]), false);
  assert_equals(Numeric[1].is([1, 42]), true);
  assert_equals(Numeric[symbol_tag].is([symbol_tag, 42]), true);
  assert_equals(Object.is(Numeric[0](), Numeric([0])), true);
});

Deno.test("failed instance validation does not claim uninstalled methods", () => {
  const dictionary = { taken: () => "existing" };
  const rejected = Symbol("Rejected");
  const accepted = Symbol("Accepted");

  assert_type_error(
    () =>
      install_instance(dictionary, rejected, {
        free: () => 1,
        taken: () => 2,
      }),
    "already defines",
  );
  assert_equals("free" in dictionary, false);
  assert_equals(rejected in dictionary, false);

  const installed = install_instance(dictionary, accepted, { free: () => 3 });

  assert_equals(installed.free(), 3);
  assert_equals(Reflect.get(dictionary, "free")(), 3);
});

Deno.test("optimized applicative lifting rejects mixed dictionary values", () => {
  let calls = 0;

  assert_type_error(
    () =>
      Applicative.lift(
        (left: number, right: number) => {
          calls += 1;
          return left + right;
        },
        Just(1),
        Right(2) as unknown as MaybeValue<number>,
      ),
    "same dictionary",
  );
  assert_equals(calls, 0);
});

Deno.test("instance installation preflights read-only aliases and token slots", () => {
  const method = () => 1;
  const alias_locked = Object.defineProperty({}, "taken", { value: method });
  const first_token = Symbol("First");
  assert_type_error(
    () =>
      install_instance(alias_locked, first_token, {
        free: method,
        taken: method,
      }),
    "read-only",
  );
  assert_equals(Object.hasOwn(alias_locked, "free"), false);
  assert_equals(first_token in alias_locked, false);

  const second_token = Symbol("Second");
  const token_locked = Object.defineProperty({}, second_token, { value: {} });
  assert_type_error(
    () => install_instance(token_locked, second_token, { free: method }),
    "read-only",
  );
  assert_equals(Object.hasOwn(token_locked, "free"), false);
});

Deno.test("fixed-element wrappers infer bytes and entries when folding", () => {
  const buffer = ArrayBufferT(new Uint8Array([2, 3]).buffer);
  const view = DataViewT(new DataView(new Uint8Array([2, 3]).buffer));
  const params = URLSearchParamsT(new URLSearchParams("a=1&a=2"));
  const raw_form = new FormData();
  raw_form.append("name", "Ada");
  const form = FormDataT(raw_form);

  assert_equals(
    buffer.fold(0, (total, byte) => {
      expect_type<number>(byte);
      return total + byte;
    }),
    5,
  );
  assert_equals(view.fold(0, (total, byte) => total + byte), 5);
  assert_equals(Foldable.fold(buffer, 0, (total, byte) => total + byte), 5);
  assert_equals(foldl((total, byte) => total + byte, 0, buffer), 5);
  assert_equals(sum(buffer), 5);
  assert_equals(product(buffer), 6);
  assert_equals(sum_values(buffer), 5);
  assert_equals(
    params.fold("", (text, [name, value]) => text + name + value),
    "a1a2",
  );
  assert_equals(
    form.fold("", (text, entry) => {
      expect_type<FormDataEntry>(entry);
      return text + entry[0] + ":" + entry[1];
    }),
    "name:Ada",
  );

  expect_type<number[]>(to_array(buffer));
  expect_type<FormDataEntry[]>(to_array(form));
  assert_equals(elem(2, buffer), true);

  // Selecting a phantom item cannot change the bytes exposed by an empty buffer.
  const empty = Monoid.empty<AsArrayBuffer, string>(ArrayBufferT);
  expect_type<number[]>(to_array(empty));
  empty.fold(0, (total, byte) => {
    expect_type<number>(byte);
    return total + byte;
  });
});

Deno.test("typed-array constructors infer numeric and big-integer elements", () => {
  const numeric = TypedArrayT(new Uint8Array([2, 3]));
  const big = TypedArrayT(new BigInt64Array([2n, 3n]));

  assert_equals(
    numeric.fold(0, (total, item) => {
      expect_type<number>(item);
      return total + item;
    }),
    5,
  );
  assert_equals(
    big.fold(0n, (total, item) => {
      expect_type<bigint>(item);
      return total + item;
    }),
    5n,
  );

  const mixed = TypedArrayT<number | bigint>(new BigInt64Array([2n]));
  mixed.fold(0, (total, item) => {
    expect_type<number | bigint>(item);
    return total + Number(item);
  });

  const narrow = TypedArrayT<1>(new Uint8Array([2]));
  assert_equals(
    narrow.fold(0, (total, item) => {
      expect_type<number>(item);
      // @ts-expect-error numeric arrays do not guarantee a particular literal
      expect_type<1>(item);
      return total + item;
    }),
    2,
  );

  const raw_narrow = as_data<AsTypedArray, 1>(
    TypedArrayT,
    new Uint8Array([2]),
  );
  raw_narrow.fold(0, (total, item) => {
    expect_type<number | bigint>(item);
    // @ts-expect-error a phantom selection cannot narrow actual array elements
    expect_type<1>(item);
    return total + Number(item);
  });
});

Deno.test("raw wrappers retain fixed element types and arbitrary object support", () => {
  const raw = new Uint8Array([2, 3]).buffer;
  const wrapped = as_data(ArrayBufferT, raw);
  const cached = as_data_cached(ArrayBufferT)(raw);
  const dictionary = {
    twice(this: { value(): number }) {
      return this.value() * 2;
    },
  };

  assert_equals(wrapped.fold(0, (total, item) => total + item), 5);
  assert_equals(cached.fold(0, (total, item) => total + item), 5);
  assert_equals(as_data(dictionary, 21).twice(), 42);
  assert_equals(as_data_cached(dictionary)(21).twice(), 42);
});

function check_element_types(): void {
  const buffer = new Uint8Array([1]).buffer;

  // @ts-expect-error buffers fold bytes, not strings
  ArrayBufferT<string>(buffer);
  // @ts-expect-error data views fold bytes, not strings
  DataViewT<string>(new DataView(buffer));
  // @ts-expect-error forms fold entries, not strings
  FormDataT<string>(new FormData());
  // @ts-expect-error URL parameters fold entries, not numbers
  URLSearchParamsT<number>(new URLSearchParams());
  // @ts-expect-error numeric element types require numeric typed arrays
  TypedArrayT<number>(new BigInt64Array([1n]));
  // @ts-expect-error bigint element types require bigint typed arrays
  TypedArrayT<bigint>(new Uint8Array([1]));
  // @ts-expect-error typed arrays contain only numbers or bigints
  TypedArrayT<string>(new Uint8Array([1]));
  // @ts-expect-error a nonempty typed array cannot claim it contains no elements
  TypedArrayT<never>(new Uint8Array([1]));
  const literal_dictionary = TypedArrayT as unknown as AsTypedArray<1>;
  literal_dictionary(new Uint8Array([2])).fold(0, (total, item) => {
    expect_type<number>(item);
    // @ts-expect-error even a dictionary view cannot guarantee a numeric literal
    expect_type<1>(item);
    return total + item;
  });
  const numeric_witness = TypedArrayT(new Uint8Array([1]));
  // @ts-expect-error raw wrapping preserves the typed-array element family
  as_data<typeof numeric_witness, number>(
    numeric_witness,
    new BigInt64Array([1n]),
  );
  // @ts-expect-error raw wrapping cannot select a false buffer element type
  as_data<AsArrayBuffer, string>(ArrayBufferT, buffer);
  // @ts-expect-error cached raw wrapping cannot select a false element type
  as_data_cached(ArrayBufferT)<string>(buffer);
  // @ts-expect-error typed dictionaries cannot use the arbitrary-object fallback
  as_data(Maybe, "invalid");
  // @ts-expect-error typed dictionaries reject unknown tags through raw wrapping
  as_data(Maybe, ["Other"]);
  // @ts-expect-error cached typed dictionaries reject unknown tags
  as_data_cached(Maybe)(["Other"]);
  // @ts-expect-error forms contain entries rather than numeric summands
  sum(FormDataT(new FormData()));
  // @ts-expect-error URL parameters contain entries rather than numeric factors
  product(URLSearchParamsT(new URLSearchParams()));
  // @ts-expect-error the generic numeric example also checks actual elements
  sum_values(FormDataT(new FormData()));
  foldl(
    // @ts-expect-error a fold callback cannot claim bytes are strings
    (state: string, value: string) => state + value.toUpperCase(),
    "",
    ArrayBufferT(buffer),
  );
}

void check_element_types;

function expect_type<expected>(_value: expected): void {}

function assert_type_error(run: () => unknown, expected: string): void {
  let caught: unknown;

  try {
    run();
  } catch (error) {
    caught = error;
  }

  assert_true(
    caught instanceof TypeError && caught.message.includes(expected),
    "expected TypeError containing " + expected,
  );
}
