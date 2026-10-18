import * as esbuild from "esbuild";
import { assert_equals, assert_true } from "../src/assert.ts";
const contents = `
import { ArrayT, array_concat_method } from "./src/array.ts";
import { List, Cons, Nil } from "./src/list.ts";
import { IterableT } from "./src/iterable.ts";
import { MapT } from "./src/map.ts";
import { SetT } from "./src/set.ts";
import { typeclass } from "./src/typeclass.ts";
const array = ArrayT([1, 2]);
const list = Cons(1, Nil().value());
const iterable = IterableT(() => [1, 2]);
const map = MapT(new Map([["a", 1]]));
const set = SetT(new Set([1]));
const common = ["show", "eq", "map", "concat", "empty", "fold"];
const sequence = ["pure", "ap", "alt", "bind", "traverse"];
const methods = [array, list, iterable, map, set].every(value => common.every(key => typeof value[key] === "function"));
const sequenced = [array, list, iterable].every(value => sequence.every(key => typeof value[key] === "function"));
const complete = methods && sequenced && [array, list].every(value => ["compare", "tail_rec_m"].every(key => typeof value[key] === "function"));
const extra = typeclass(Symbol("AfterInit"), {});
extra.instance(ArrayT)({ after_init() { return this.value().length; } });
export const result = { complete, alias: array_concat_method === ArrayT.concat, dynamic: array.after_init(), array: array.map(x => x + 1).value(), list: list.match({ Cons: x => x, Nil: () => 0 }), iterable: [...iterable.map(x => x + 1).value()()], map: map.map(x => x + 1).value().get("a"), set: [...set.map(x => x + 1).value()] };
`;
try {
  const built = await esbuild.build({
    stdin: { contents, loader: "ts", resolveDir: Deno.cwd() },
    bundle: true,
    write: false,
    minify: true,
    format: "esm",
    platform: "neutral",
    metafile: true,
  });
  const code = built.outputFiles[0].text;
  const evaluated = await import("data:text/javascript;base64," + btoa(code));
  const result = evaluated.result;
  assert_true(
    result.complete,
    "every used dictionary retains its complete method set",
  );
  assert_true(
    result.alias,
    "canonical concat alias retains its exact implementation identity",
  );
  assert_equals(result.dynamic, 2);
  assert_equals(result.array, [2, 3]);
  assert_equals(result.list, 1);
  assert_equals(result.iterable, [2, 3]);
  assert_equals(result.map, 2);
  assert_equals(result.set, [2]);
  console.log(
    JSON.stringify({ result, bytes: code.length, esbuild: esbuild.version }),
  );
} finally {
  esbuild.stop();
}
