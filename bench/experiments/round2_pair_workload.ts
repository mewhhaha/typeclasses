import * as Async from "../../src/async_iterable.ts";
const items = Array.from({ length: 5_000 }, (_, index) => index);
const source = Async.from_factory(async function* () {
  yield* items;
});
const fused = source.map((item) => item + 1).filter((item) => item % 2 === 0)
  .take(1_000);
const mapped = Async.from_factory(async function* () {
  for await (const item of source.value()()) yield item + 1;
});
const filtered = Async.from_factory(async function* () {
  for await (const item of mapped.value()()) {
    if (await Promise.resolve(item % 2 === 0)) yield item;
  }
});
const nested = Async.from_factory(async function* () {
  let remaining = 1_000;
  for await (const item of filtered.value()()) {
    yield item;
    remaining -= 1;
    if (remaining === 0) return;
  }
});
let selected = nested;
if (Deno.args[0] === "fused") selected = fused;
else if (Deno.args[0] !== "nested") throw new Error("expected nested or fused");
for (let index = 0; index < 20; index += 1) await Async.to_array(selected);
let checksum = 0;
const start = performance.now();
for (let index = 0; index < 100; index += 1) {
  const result = await Async.to_array(selected);
  if (result.length !== 1_000 || result[0] !== 2 || result[999] !== 2_000) {
    throw new Error("incorrect output");
  }
  checksum += result[999];
}
console.log(
  JSON.stringify({ elapsed_ms: performance.now() - start, checksum }),
);
