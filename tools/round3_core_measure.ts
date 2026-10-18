import ts from "typescript";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type PairedBlock, summarize_pairs } from "./paired_bench.ts";

const baseline = resolve(
  Deno.args[0] ?? "/tmp/typeclasses-round3-baseline-2068408",
);
const candidate = resolve(Deno.args[1] ?? ".");
const destination = Deno.args[2];
const module_at = (root: string, path: string) =>
  import(pathToFileURL(resolve(root, path)).href);
const before: typeof import("../src/maybe.ts") = await module_at(
  baseline,
  "src/maybe.ts",
);
const after: typeof before = await module_at(candidate, "src/maybe.ts");
const old_class: typeof import("../src/typeclass.ts") = await module_at(
  baseline,
  "src/typeclass.ts",
);
const new_class: typeof old_class = await module_at(
  candidate,
  "src/typeclass.ts",
);
const old_functor: typeof import("../src/typeclasses/functor.ts") =
  await module_at(baseline, "src/typeclasses/functor.ts");
const new_functor: typeof old_functor = await module_at(
  candidate,
  "src/typeclasses/functor.ts",
);
const old_transform: typeof import("./transform_do_program.ts") =
  await module_at(baseline, "tools/transform_do_program.ts");
const new_transform: typeof old_transform = await module_at(
  candidate,
  "tools/transform_do_program.ts",
);
const old_bindings: typeof import("./transform_bindings.ts") = await module_at(
  baseline,
  "tools/transform_bindings.ts",
);
const new_bindings: typeof old_bindings = await module_at(
  candidate,
  "tools/transform_bindings.ts",
);
const old_watch: typeof import("./dev_watch.ts") = await module_at(
  baseline,
  "tools/dev_watch.ts",
);
const new_watch: typeof old_watch = await module_at(
  candidate,
  "tools/dev_watch.ts",
);
let sink: unknown;
const results: Record<string, unknown> = {};
function pair(
  name: string,
  a: () => unknown,
  b: () => unknown,
  iterations: number,
): void {
  const observe = (fn: () => unknown) => {
    const started = performance.now();
    for (let index = 0; index < iterations; index++) sink = fn();
    return (performance.now() - started) / iterations;
  };
  for (let index = 0; index < 3; index++) {
    observe(a);
    observe(b);
  }
  const blocks: PairedBlock[] = [];
  for (let index = 0; index < 8; index++) {
    blocks.push([observe(a), observe(b), observe(b), observe(a)]);
  }
  const median = (items: number[]) =>
    items.toSorted((x, y) => x - y)[Math.floor(items.length / 2)];
  const row = {
    baseline_ms: median(blocks.flatMap((x) => [x[0], x[3]])),
    candidate_ms: median(blocks.flatMap((x) => [x[1], x[2]])),
    iterations,
    sample_blocks: blocks,
    ...summarize_pairs(blocks),
  };
  results[name] = row;
  console.log(JSON.stringify({ name, ...row, sample_blocks: undefined }));
}
const add = (n: number) => n + 1;
pair("141/Maybe map1000", () => {
  let v = before.Just(0);
  for (let i = 0; i < 1000; i++) v = v.map(add);
  return v.value();
}, () => {
  let v = after.Just(0);
  for (let i = 0; i < 1000; i++) v = v.map(add);
  return v.value();
}, 100);
const old_value = before.Just(1), new_value = after.Just(1);
pair("141/tagged guard1000", () => {
  let n = 0;
  for (let i = 0; i < 1000; i++) n += Number(before.Just.is(old_value));
  return n;
}, () => {
  let n = 0;
  for (let i = 0; i < 1000; i++) n += Number(after.Just.is(new_value));
  return n;
}, 100);
pair("142/delegation1000", () => {
  let n = 0;
  for (let i = 0; i < 1000; i++) {
    const cursor = old_value[Symbol.iterator]();
    cursor.next();
    n += Number(cursor.next(1).value);
  }
  return n;
}, () => {
  let n = 0;
  for (let i = 0; i < 1000; i++) {
    const cursor = new_value[Symbol.iterator]();
    cursor.next();
    n += Number(cursor.next(1).value);
  }
  return n;
}, 100);
const cached_map = new_functor.Functor.instance_for(new_value).map as (
  this: typeof new_value,
  fn: (n: number) => number,
) => typeof new_value;
pair("143/prepared dispatch1000", () => {
  let v = after.Just(0);
  for (let i = 0; i < 1000; i++) v = new_functor.Functor.map(v, add);
  return v;
}, () => {
  let v = after.Just(0);
  for (let i = 0; i < 1000; i++) v = cached_map.call(v, add) as typeof v;
  return v;
}, 100);
const method = Symbol("method");
const old_dictionary = old_class.data(Symbol("old")),
  new_dictionary = new_class.data(Symbol("new"));
const equality = {
  eq(this: unknown, right: unknown) {
    return this === right;
  },
};
old_class.install_instance(old_dictionary, method, equality);
new_class.install_instance(new_dictionary, method, equality);
const old_eq = (old_dictionary as unknown as typeof equality).eq,
  new_eq = (new_dictionary as unknown as typeof equality).eq;
pair("144/check wrapper1000", () => {
  let n = 0;
  for (let i = 0; i < 1000; i++) n += Number(old_eq.call(old_value, old_value));
  return n;
}, () => {
  let n = 0;
  for (let i = 0; i < 1000; i++) n += Number(new_eq.call(new_value, new_value));
  return n;
}, 100);
pair("146/registration100", () => {
  for (let i = 0; i < 100; i++) {
    old_class.install_instance(Object.create(null), method, equality);
  }
}, () => {
  for (let i = 0; i < 100; i++) {
    new_class.install_instance(Object.create(null), method, equality);
  }
}, 100);
const text =
  'import {Do} from "../src/typeclasses.ts"; import {Just,Maybe} from "../src/maybe.ts"; export const result=Do(Maybe,function*(){' +
  Array.from({ length: 100 }, (_, i) => `const item${i}=yield* Just(${i});`)
    .join("") +
  "return item99;});";
pair(
  "201-203/transform100",
  () => old_transform.transform_do_program_source(text, "bench.ts"),
  () => new_transform.transform_do_program_source(text, "bench.ts"),
  10,
);
pair(
  "205/maps opt-out",
  () => new_transform.transform_do_program_source(text, "bench.ts"),
  () =>
    new_transform.transform_do_program_source(text, "bench.ts", {
      source_map: false,
    }),
  10,
);
const old_cache = old_transform.create_transform_cache(),
  new_cache = new_transform.create_transform_cache();
pair("208/cache misses", () => {
  old_cache.clear();
  return old_cache.transform(text, "bench.ts");
}, () => {
  new_cache.clear();
  return new_cache.transform(text, "bench.ts");
}, 10);
const ast = ts.createSourceFile(
  "scope.ts",
  "const outer=1;" + "function f(){".repeat(60) + "outer;" + "}".repeat(60),
  ts.ScriptTarget.Latest,
  true,
);
const identifiers: ts.Identifier[] = [];
function visit(node: ts.Node): void {
  if (ts.isIdentifier(node)) identifiers.push(node);
  ts.forEachChild(node, visit);
}
visit(ast);
const previous = old_bindings.create_binding_analysis(ast),
  next = new_bindings.create_binding_analysis(ast);
pair("202/resolution1000", () => {
  for (let i = 0; i < 1000; i++) {
    for (const id of identifiers) sink = previous.resolve(id);
  }
}, () => {
  for (let i = 0; i < 1000; i++) {
    for (const id of identifiers) sink = next.resolve(id);
  }
}, 10);
const sources = new Map(
  Array.from({ length: 1000 }, (_, i) => {
    let source = "export const item=0";
    if (i > 0) {
      source = `import {item} from "./item${i - 1}.ts"; export {item};`;
    }
    return [`/p/item${i}.ts`, source] as const;
  }),
);
const graph = new_watch.create_dependency_graph(sources);
pair(
  "209/watch graph1000",
  () => old_watch.affected_files(sources, ["/p/item500.ts"]),
  () => {
    graph.update("/p/item500.ts", sources.get("/p/item500.ts")!);
    return graph.affected(["/p/item500.ts"]);
  },
  20,
);
const hash = async (text: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
const files = [
  "src/typeclass.ts",
  "src/data_value.ts",
  "src/maybe.ts",
  "src/either.ts",
  "src/typeclasses/monad.ts",
  "tools/transform_do_program.ts",
  "tools/transform_bindings.ts",
  "tools/dev_watch.ts",
];
const fingerprints: Record<string, Record<string, string>> = {};
for (const [name, root] of [["baseline", baseline], ["candidate", candidate]]) {
  const values: Record<string, string> = {};
  for (const file of files) {
    values[file] = await hash(await Deno.readTextFile(resolve(root, file)));
  }
  fingerprints[name] = values;
}
const report = {
  runtime: Deno.version,
  baseline,
  candidate,
  driver_sha256: await hash(await Deno.readTextFile(new URL(import.meta.url))),
  fingerprints,
  results,
  limitations:
    "Serial in-process ABBA; includes JIT effects and shared-host noise. Per-hill controls distinguish historical and same-runtime comparisons. Allocation counts are measured separately.",
};
if (destination) {
  await Deno.writeTextFile(destination, JSON.stringify(report, null, 2) + "\n");
}
void sink;
