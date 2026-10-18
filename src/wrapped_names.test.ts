import { assert_equals } from "./assert.ts";
import { Identity, type RawIdentity } from "./identity.ts";
import type { List } from "./list.ts";
import type { Fn } from "./fn.ts";
import type { Tuple } from "./tuple.ts";
import type { Predicate } from "./predicate.ts";
import type { Gen } from "./quickcheck.ts";
import { ArrayT, type RawArrayT } from "./array.ts";
import type { MapT } from "./map.ts";
import type { RecordT } from "./record.ts";
import type { SetT } from "./set.ts";
import type { IterableT } from "./iterable.ts";
import type { AsyncIterableT } from "./async_iterable.ts";
import type { TypedArrayT } from "./typed_array.ts";
import type { ArrayBufferT } from "./array_buffer.ts";
import type { DataViewT } from "./data_view.ts";
import type { DateT } from "./date.ts";
import type { ErrorT } from "./error.ts";
import type { FormDataT } from "./form_data.ts";
import type { RegExpT } from "./regexp.ts";
import type { URLSearchParamsT } from "./url_search_params.ts";
import type { WeakMapT } from "./weak_map.ts";
import type { WeakSetT } from "./weak_set.ts";
import type { ReadableStreamT } from "./readable_stream.ts";
import { type ParallelTask, type RawTask, succeed, type Task } from "./task.ts";
import type { Reader } from "./reader.ts";
import type { State } from "./state.ts";
import type { Stm } from "./stm.ts";
import type { Writer } from "./writer.ts";
import type { AsArray } from "./array.ts";
import type { Maybe } from "./maybe.ts";
import type { Either } from "./either.ts";
import type { Validation } from "./validation.ts";

type Wrapped<value extends { value(): unknown }> = value;
type PublicValues = Wrapped<
  | Identity<number>
  | List<number>
  | Fn<string, number>
  | Tuple<string, number>
  | Predicate<number>
  | Gen<number>
  | ArrayT<number>
  | MapT<number, object>
  | RecordT<number>
  | SetT<number>
  | IterableT<number>
  | AsyncIterableT<number>
  | TypedArrayT<number>
  | ArrayBufferT
  | DataViewT
  | DateT
  | ErrorT
  | FormDataT
  | RegExpT
  | URLSearchParamsT
  | WeakMapT<number>
  | WeakSetT<object>
  | ReadableStreamT<number>
  | Task<number>
  | ParallelTask<number>
  | Reader<string, number>
  | State<string, number>
  | Stm<number>
  | Writer<AsArray, string, number>
  | Maybe<number>
  | Either<string, number>
  | Validation<string, number>
>;
Deno.test("public type names carry methods and Raw names expose boundary representations", async () => {
  const identity: PublicValues = Identity(1);
  const raw_identity: RawIdentity<number> = identity.value();
  const array: ArrayT<number> = ArrayT([1, 2]);
  const raw_array: RawArrayT<number> = array.value();
  const task: Task<number> = succeed(3);
  const raw_task: RawTask<number> = task.value();
  assert_equals(raw_identity, 1);
  assert_equals(raw_array, [1, 2]);
  assert_equals(await raw_task(), 3);
});
