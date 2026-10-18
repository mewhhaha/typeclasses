import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(Deno.args[0] ?? ".");
const count = Number(Deno.args[1] ?? "20000");
const { Just }: typeof import("../src/maybe.ts") = await import(
  pathToFileURL(resolve(root, "src/maybe.ts")).href
);
const { kind }: typeof import("../src/typeclass.ts") = await import(
  pathToFileURL(resolve(root, "src/typeclass.ts")).href
);
const gc = (globalThis as { gc?: () => void }).gc;
if (gc === undefined) throw new Error("Run with --v8-flags=--expose-gc");
const left = Just(1);
let last = "";
function churn(count: number): void {
  for (let index = 0; index < count; index++) {
    try {
      left.eq({ [kind]: Symbol("temporary") } as unknown as typeof left);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      last = error.message;
    }
  }
}
async function collect(): Promise<void> {
  gc!();
  await new Promise((resolve) => setTimeout(resolve, 0));
  gc!();
}
churn(100);
await collect();
const before = Deno.memoryUsage().heapUsed;
const started = performance.now();
churn(count);
const elapsed_ms = performance.now() - started;
await collect();
const after = Deno.memoryUsage().heapUsed;
console.log(JSON.stringify({
  root,
  count,
  runtime: Deno.version,
  before,
  after,
  retained_bytes: after - before,
  elapsed_ms,
  last,
  limitations:
    "Fresh-process retained-heap difference after explicit collections, not allocation traffic; includes runtime/harness noise.",
}));
