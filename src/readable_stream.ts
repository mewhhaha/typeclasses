import { type AsAsyncIterable, AsyncIterableT } from "./async_iterable.ts";
import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { Eq, Show } from "./typeclasses.ts";

/** @ignore */
export declare const readable_stream_identity: unique symbol;

/** The web stream wrapped by the `ReadableStreamT` dictionary. */
export type ReadableStreamT<item> = ReadableStream<item>;

/** Dictionary type for web `ReadableStream` values. */
export interface AsReadableStream
  extends
    As<AsReadableStream, typeof readable_stream_identity>,
    Show<AsReadableStream>,
    Eq<AsReadableStream> {
  /** Higher-kinded slot for the stream chunk type. */
  readonly [type_item]: unknown;
  /** Web stream representation at the selected chunk type. */
  readonly [type_data]: ReadableStreamT<this[typeof type_item]>;
}

/** @ignore */
export type ReadableStreamValue<item> = Data<AsReadableStream, item>;

/** Callable dictionary for wrapping web streams by reference. */
export const ReadableStreamT: AsReadableStream = data<AsReadableStream>();

/** Wrap a web stream without reading or cloning it. */
export function from_readable_stream<item>(
  stream: ReadableStream<item>,
): ReadableStreamValue<item> {
  return ReadableStreamT(stream);
}

/** Adapt a wrapped stream to an async iterable that releases its reader. */
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
