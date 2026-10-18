import { assert_equals } from "../src/assert.ts";
import { affected_files } from "./dev_watch.ts";

Deno.test("affected checks retain transitive runtime and type consumers", () => {
  const sources = new Map([
    ["/project/src/task.ts", "export const task = 1;"],
    ["/project/src/middle.ts", 'export { task } from "./task.ts";'],
    ["/project/src/test.test.ts", 'import type { task } from "./middle.ts";'],
    ["/project/src/unrelated.ts", "export const other = 1;"],
  ]);
  assert_equals(affected_files(sources, ["/project/src/task.ts"]), [
    "/project/src/middle.ts",
    "/project/src/task.ts",
    "/project/src/test.test.ts",
  ]);
});

Deno.test("nonliteral dynamic imports conservatively check the full graph", () => {
  const sources = new Map([
    [
      "/project/src/dynamic.ts",
      "export const load = (path: string) => import(path);",
    ],
    ["/project/src/entry.ts", "export const entry = 1;"],
  ]);
  assert_equals(affected_files(sources, ["/project/src/entry.ts"]), [
    ...sources.keys(),
  ]);
});
