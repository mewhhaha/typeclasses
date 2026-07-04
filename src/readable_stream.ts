import { type AsAsyncIterable, AsyncIterableT } from "./async_iterable.ts";
import { type As, define, type Value } from "./trait.ts";
import { Equal, Format } from "./traits.ts";

export type ReadableStreamT<item> = ReadableStream<item>;

export const readable_stream_kind = Symbol("ReadableStreamT");

declare module "./trait.ts" {
  interface TraitTypes<dictionary, item> {
    [readable_stream_kind]: ReadableStreamT<item>;
  }
}

export interface AsReadableStream extends As<typeof readable_stream_kind> {}

type ReadableStreamValue<item> = Value<AsReadableStream, item>;

export const ReadableStreamT = define<AsReadableStream>(
  readable_stream_kind,
);

export function from_readable_stream<item>(
  stream: ReadableStream<item>,
): ReadableStreamValue<item> {
  return ReadableStreamT(stream);
}

export function to_async_iterable<item>(
  stream: ReadableStreamValue<item>,
): Value<AsAsyncIterable, item> {
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

Format.implement(ReadableStreamT)({
  fmt() {
    return "ReadableStream(?)";
  },
});

export interface AsReadableStream extends Format<AsReadableStream> {}

Equal.implement(ReadableStreamT)({
  eq(right) {
    return Object.is(this.value(), right.value());
  },
});

export interface AsReadableStream extends Equal<AsReadableStream> {}
