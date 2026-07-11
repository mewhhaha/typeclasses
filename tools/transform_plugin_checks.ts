import { assert_equals, assert_true } from "../src/assert.ts";
import { build } from "esbuild";
import { rolldown } from "rolldown";
import {
  typeclasses_esbuild_plugin,
  typeclasses_rolldown_plugin,
  typeclasses_rollup_plugin,
} from "./transform_plugin.ts";

Deno.test("transform plugin lowers TypeScript through bundler-shaped adapters", () => {
  const source = `
import { Do } from "../src/typeclasses.ts";
const value = Do(Maybe, function* () { return 42; });
`;
  const warnings: string[] = [];
  const rollup = typeclasses_rollup_plugin();
  const transformed = rollup.transform.call(
    { warn: (message) => warnings.push(message) },
    source,
    "fixture.ts",
  );
  assert_true(
    transformed !== null,
    "expected Rollup adapter to handle TypeScript",
  );
  if (transformed === null) {
    throw new Error("expected Rollup adapter to handle TypeScript");
  }
  assert_true(
    !transformed.code.includes("function*"),
    "expected generator to lower\n\n" + transformed.code,
  );
  assert_equals(warnings, []);

  const rolldown_plugin = typeclasses_rolldown_plugin();
  const rolldown_transformed = rolldown_plugin.transform.handler.call(
    { warn: (message) => warnings.push(message) },
    source,
    "fixture.ts",
  );
  assert_true(
    rolldown_transformed !== null,
    "expected Rolldown adapter to handle TypeScript",
  );
  if (rolldown_transformed === null) {
    throw new Error("expected Rolldown adapter to handle TypeScript");
  }
  assert_true(
    !rolldown_transformed.code.includes("function*"),
    "expected Rolldown generator to lower\n\n" + rolldown_transformed.code,
  );
  assert_equals(warnings, []);

  let on_load:
    | ((args: { readonly path: string }) => Promise<unknown>)
    | undefined;
  typeclasses_esbuild_plugin().setup({
    onLoad(_options, callback) {
      on_load = callback;
    },
  });
  assert_true(
    on_load !== undefined,
    "expected esbuild adapter to register an onLoad hook",
  );
});

Deno.test({
  name: "esbuild bundles examples/monads.ts through the typeclasses plugin",
  permissions: { env: true, read: true, run: true },
  async fn() {
    const result = await build({
      entryPoints: [new URL("../examples/monads.ts", import.meta.url).pathname],
      bundle: true,
      format: "esm",
      platform: "neutral",
      write: false,
      // The library currently uses TypeScript's `out` type-parameter spelling,
      // which esbuild's parser rejects in transitive source modules. Keeping
      // those imports external still exercises the actual entry bundle and
      // plugin lowering path without changing library source for this smoke.
      external: ["../src/*"],
      plugins: [typeclasses_esbuild_plugin()],
    });
    const output = result.outputFiles[0]?.text;
    assert_true(output !== undefined, "expected esbuild output");
    if (output === undefined) throw new Error("expected esbuild output");
    assert_true(
      !output.includes("function*"),
      "expected transformed entry output to contain no generators\n\n" + output,
    );
  },
});

Deno.test({
  name: "Rolldown bundles examples/monads.ts through the typeclasses plugin",
  permissions: { env: true, ffi: true, read: true, run: true },
  async fn() {
    const bundle = await rolldown({
      input: new URL("../examples/monads.ts", import.meta.url).pathname,
      external: (id) => id.startsWith("../src/"),
      plugins: [typeclasses_rolldown_plugin()],
    });
    try {
      const result = await bundle.generate({ format: "esm" });
      const output = result.output.map((item) => {
        return "code" in item ? item.code : "";
      }).join("\n");
      assert_true(output.length > 0, "expected Rolldown output");
      assert_true(
        !output.includes("function*"),
        "expected transformed entry output to contain no generators\n\n" +
          output,
      );
    } finally {
      await bundle.close();
    }
  },
});
