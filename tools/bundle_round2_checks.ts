import * as esbuild from "esbuild";
import { assert_equals, assert_true } from "../src/assert.ts";

Deno.test("tree shaking keeps complete used dictionaries and removes unused ones", async () => {
  try {
    const result = await esbuild.build({
      stdin: {
        contents: `import { Just } from "./src/maybe.ts";
export const result = Just(1).map(n => n+1).bind(n => Just(n+1));
export const methods = ["show","eq","compare","map","pure","ap","empty","alt","concat","bind","tail_rec_m","fold","traverse"].every(key => typeof result[key] === "function");
export const matched = result.match({Just: n => n, Nothing: () => 0});`,
        resolveDir: Deno.cwd(),
        loader: "ts",
      },
      bundle: true,
      write: false,
      minify: true,
      format: "esm",
      platform: "neutral",
      metafile: true,
    });
    const code = result.outputFiles[0].text;
    const evaluated = await import("data:text/javascript;base64," + btoa(code));
    assert_equals(evaluated.result.value(), ["Just", 3]);
    assert_equals(evaluated.matched, 3);
    assert_true(
      evaluated.methods,
      "used dictionary instances survive bundling",
    );
    const retainedEither = Object.values(result.metafile.outputs).flatMap(
      (output) => Object.entries(output.inputs),
    ).filter(([path]) => path.endsWith("src/either.ts")).reduce(
      (bytes, [, input]) => bytes + input.bytesInOutput,
      0,
    );
    assert_equals(retainedEither, 0);
  } finally {
    esbuild.stop();
  }
});
