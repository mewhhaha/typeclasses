import { build } from "esbuild";
import { Miniflare } from "miniflare";

const result = await build({
  stdin: {
    contents: `
import { Effect, from_fn, Just, run_task } from "./src/mod.ts";

export default {
  async fetch() {
    const value = await run_task(Effect.lift(
      from_fn(async () => Just(20).map((item) => item + 22).value()[1]),
    ));
    return Response.json({ value });
  },
};
`,
    loader: "ts",
    resolveDir: Deno.cwd(),
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
});
const output = result.outputFiles[0]?.text;

if (output === undefined) {
  throw new Error("workerd portability build produced no JavaScript");
}

const runtime = new Miniflare({
  compatibilityDate: "2026-08-01",
  modules: [{ type: "ESModule", path: "worker.mjs", contents: output }],
});

try {
  const response = await runtime.dispatchFetch("https://typeclasses.test/");
  const body = await response.json() as { readonly value?: unknown };

  if (response.status !== 200 || body.value !== 42) {
    throw new Error(
      `workerd portability smoke test expected 200/{ value: 42 }; received ${response.status.toString()}/${
        JSON.stringify(body)
      }`,
    );
  }
} finally {
  await runtime.dispose();
}
