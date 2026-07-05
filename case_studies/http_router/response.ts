import {
  type AsAsyncIterable,
  from_factory as async_iterable,
} from "../../src/async_iterable.ts";
import {
  Effect,
  type Effect as EffectValue,
  Program,
  type Uses,
} from "../../src/effects.ts";
import { type AsWriter, run_writer, tell } from "../../src/writer.ts";

export type HttpBody = Uses<AsWriter<AsAsyncIterable, string>>;

export type HttpMetadata = {
  readonly status: number;
  readonly content_type: string;
};

export type HttpProgram = EffectValue<HttpBody, HttpMetadata>;

const empty_body = async_iterable<string>(async function* () {});

export function to_response(program: HttpProgram): Response {
  const [metadata, chunks] = Effect.run(run_writer(program, empty_body));

  return new Response(
    readable_from_async_iterable(encode_body(chunks.run())),
    {
      status: metadata.status,
      headers: {
        "content-type": metadata.content_type,
      },
    },
  );
}

export function html(status: number): HttpMetadata {
  return {
    status,
    content_type: "text/html; charset=utf-8",
  };
}

export function json(value: unknown, status = 200): HttpProgram {
  return Program(function* () {
    yield* emit_body(JSON.stringify(value));

    return {
      status,
      content_type: "application/json; charset=utf-8",
    };
  });
}

export function page_start(title: string) {
  return emit_body(
    "<!doctype html><html><head><title>" +
      escape_html(title) +
      "</title></head><body>",
  );
}

export function page_end() {
  return emit_body("</body></html>");
}

export function emit_body(chunk: string) {
  return tell(async_iterable(async function* () {
    yield chunk;
  }));
}

export function escape_html(value: string) {
  return value.replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function* encode_body(chunks: AsyncIterable<string>) {
  const encoder = new TextEncoder();

  for await (const chunk of chunks) {
    yield encoder.encode(chunk);
  }
}

function readable_from_async_iterable<item>(
  items: AsyncIterable<item>,
): ReadableStream<item> {
  const iterator = items[Symbol.asyncIterator]();

  return new ReadableStream({
    async pull(controller) {
      const next = await iterator.next();

      if (next.done === true) {
        controller.close();
        return;
      }

      controller.enqueue(next.value);
    },

    async cancel() {
      await iterator.return?.();
    },
  });
}
