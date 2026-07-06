import { ArrayT } from "../src/array.ts";
import { from_bytes as array_buffer_from_bytes } from "../src/array_buffer.ts";
import {
  from_factory as async_iterable_from_factory,
  to_array as async_iterable_to_array,
} from "../src/async_iterable.ts";
import { from_bytes as data_view_from_bytes } from "../src/data_view.ts";
import { from_date } from "../src/date.ts";
import { from_error } from "../src/error.ts";
import {
  from_entries as form_data_from_entries,
  to_entries as form_data_to_entries,
} from "../src/form_data.ts";
import {
  from_factory as iterable_from_factory,
  to_array as iterable_to_array,
} from "../src/iterable.ts";
import {
  from_entries as map_from_entries,
  to_record as map_to_record,
} from "../src/map.ts";
import { right } from "../src/either.ts";
import {
  from_entries as record_from_entries,
  to_record as record_to_record,
} from "../src/record.ts";
import {
  from_readable_stream,
  to_async_iterable as readable_stream_to_async_iterable,
} from "../src/readable_stream.ts";
import { from_regexp } from "../src/regexp.ts";
import {
  from_iterable as set_from_iterable,
  to_set as set_to_set,
} from "../src/set.ts";
import { from_typed_array } from "../src/typed_array.ts";
import {
  from_entries as url_params_from_entries,
  to_entries as url_params_to_entries,
} from "../src/url_search_params.ts";
import { from_entries as weak_map_from_entries } from "../src/weak_map.ts";
import { from_iterable as weak_set_from_iterable } from "../src/weak_set.ts";
import { Alternative, Show, Traversable } from "../src/typeclasses.ts";

export async function run_builtin_shape_examples() {
  const array_monad = ArrayT([1, 2, 3])
    .bind((value) => ArrayT([value, value * 10]));
  const array_alternative = Alternative.alt(
    ArrayT([1]),
    ArrayT([2, 3]),
  );
  const mapped_map = map_from_entries<number>([["left", 1], ["right", 2]])
    .map((value) => "value:" + value.toString());
  const mapped_record = record_from_entries<number>([["x", 4], ["y", 5]])
    .map((value) => value * 2);
  const mapped_set = set_from_iterable([1, 2, 2, 3])
    .map((value) => value * 10);
  const replayable_iterable = iterable_from_factory(function* () {
    yield 1;
    yield 2;
    yield 3;
  }).bind((value) => {
    return iterable_from_factory(function* () {
      yield value;
      yield value * 10;
    });
  });
  const replayable_async_iterable = async_iterable_from_factory(
    async function* () {
      yield "a";
      yield "b";
    },
  ).map((value) => value.toUpperCase());
  const readable_numbers = from_readable_stream(
    new ReadableStream<number>({
      start(controller) {
        controller.enqueue(1);
        controller.enqueue(2);
        controller.close();
      },
    }),
  );
  const readable_as_iterable = readable_stream_to_async_iterable(
    readable_numbers,
  )
    .map((value) => value * 10);
  const byte_buffer = array_buffer_from_bytes([1, 2])
    .concat(array_buffer_from_bytes([3]));
  const byte_view = data_view_from_bytes([4, 5, 6]);
  const typed_numbers = from_typed_array(new Uint8Array([7, 8, 9]));
  const query_params = url_params_from_entries([
    ["tag", "traits"],
    ["tag", "typescript"],
  ]);
  const form_fields = form_data_from_entries([
    ["name", "Ada"],
    ["email", "ada@example.test"],
  ]);
  const weak_key = {};
  const weak_map = weak_map_from_entries([[weak_key, "cached"]]);
  const weak_set = weak_set_from_iterable([weak_key]);
  const date_value = from_date(new Date("2024-01-02T03:04:05.000Z"));
  const regexp_value = from_regexp(/^traits$/iu);
  const error_value = from_error(new TypeError("expected value"));
  const traversed_record = Traversable.traverse(
    record_from_entries<number>([["id", 42], ["limit", 10]]),
    right(undefined),
    (value) => right(value.toString()),
  ).map((record) => record_to_record(record));

  console.log("array monad", array_monad.show());
  console.log("array alternative", Show.show(array_alternative));
  console.log("map functor", Deno.inspect(map_to_record(mapped_map)));
  console.log("record functor", Deno.inspect(record_to_record(mapped_record)));
  console.log("set functor", Deno.inspect([...set_to_set(mapped_set)]));
  console.log(
    "iterable monad",
    Deno.inspect(iterable_to_array(replayable_iterable)),
  );
  console.log(
    "async iterable functor",
    Deno.inspect(await async_iterable_to_array(replayable_async_iterable)),
  );
  console.log(
    "readable stream adapter",
    Deno.inspect(await async_iterable_to_array(readable_as_iterable)),
  );
  console.log("array buffer concat", byte_buffer.show());
  console.log("data view bytes", byte_view.show());
  console.log(
    "typed array fold",
    typed_numbers.fold(0, (sum, byte) => sum + Number(byte)),
  );
  console.log("url params", Deno.inspect(url_params_to_entries(query_params)));
  console.log("form data", Deno.inspect(form_data_to_entries(form_fields)));
  console.log("weak map", weak_map.show());
  console.log("weak set", weak_set.show());
  console.log("date", date_value.show());
  console.log("regexp", regexp_value.show());
  console.log("error", error_value.show());
  console.log("record traverse result", traversed_record.show());
}
