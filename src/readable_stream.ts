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
export const readable_stream_identity: unique symbol = /* @__PURE__ */ Symbol(
  "readable_stream_identity",
);

/** The web stream wrapped by the `ReadableStreamT` dictionary. */
export type RawReadableStreamT<item> = ReadableStream<item>;

/** @ignore */
export interface AsReadableStreamLambda {
  readonly [type_item]: unknown;
  readonly [type_data]: RawReadableStreamT<this[typeof type_item]>;
}

/** Dictionary type for web `ReadableStream` values. */
export interface AsReadableStream
  extends
    As<AsReadableStreamLambda, typeof readable_stream_identity>,
    Show<AsReadableStream>,
    Eq<AsReadableStream> {
}

/** A wrapped ReadableStreamT value with its dictionary operations. */
export type ReadableStreamT<item> = Data<AsReadableStream, item>;

/** Callable dictionary for wrapping web streams by reference. */
export const ReadableStreamT: AsReadableStream = data<AsReadableStream>(
  readable_stream_identity,
);

/** Wrap a web stream without reading or cloning it. */
export function from_readable_stream<item>(
  stream: ReadableStream<item>,
): ReadableStreamT<item> {
  return ReadableStreamT(stream);
}

/**
 * Adapt a one-shot stream. Early iterator exit cancels by default. Set
 * preventCancel to release the reader while preserving unread chunks.
 */
export function to_async_iterable<item>(
  stream: ReadableStreamT<item>,
  options: { readonly preventCancel?: boolean } = {},
): Data<AsAsyncIterable, item> {
  const source = stream.value();
  const prevent_cancel = options.preventCancel === true;

  return AsyncIterableT(async function* () {
    const reader = source.getReader();
    let done = false;
    try {
      while (true) {
        const next = await reader.read();

        if (next.done === true) {
          done = true;
          return;
        }

        yield next.value;
      }
    } finally {
      try {
        if (!done && !prevent_cancel) await reader.cancel();
      } finally {
        reader.releaseLock();
      }
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
