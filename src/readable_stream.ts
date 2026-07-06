import { type AsAsyncIterable, AsyncIterableT } from "./async_iterable.ts";
import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { Eq, Show } from "./typeclasses.ts";

export type ReadableStreamT<item> = ReadableStream<item>;

export interface AsReadableStream
  extends As<AsReadableStream>, Show<AsReadableStream>, Eq<AsReadableStream> {
  readonly [type_item]: unknown;
  readonly [type_data]: ReadableStreamT<this[typeof type_item]>;
}

type ReadableStreamValue<item> = Data<AsReadableStream, item>;

export const ReadableStreamT: AsReadableStream = data<AsReadableStream>();

export function from_readable_stream<item>(
  stream: ReadableStream<item>,
): ReadableStreamValue<item> {
  return ReadableStreamT(stream);
}

export function to_async_iterable<item>(
  stream: ReadableStreamValue<item>,
): Data<AsAsyncIterable, item> {
  const source = stream.value();

  return AsyncIterableT(async function* () {
    const reader = source.getReader();

    try {
      while (true) {
        const next = await reader.read();

        if (next.done === true) {
          return;
        }

        yield next.value;
      }
    } finally {
      reader.releaseLock();
    }
  });
}

Show.instance(ReadableStreamT)({
  show() {
    return "ReadableStream(?)";
  },
});

Eq.instance(ReadableStreamT)({
  eq(right) {
    return Object.is(this.value(), right.value());
  },
});
