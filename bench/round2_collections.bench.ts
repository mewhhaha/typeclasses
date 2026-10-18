// Serial counterfactual workloads. Pin source/workload hashes with
// tools/capture_measurement.ts; each group compares current algorithms only.
// Serial counterfactual workloads. Pin source/workload hashes with
// tools/capture_measurement.ts; each group compares current algorithms only.
import { from_array, from_factory, to_array } from "../src/iterable.ts";
import * as Async from "../src/async_iterable.ts";
import { direct_fold, type Stage } from "./experiments/round2_direct_fold.ts";
import { from_bytes as buffer } from "../src/array_buffer.ts";
import { DataViewT } from "../src/data_view.ts";
import { from_iterable, SetT } from "../src/set.ts";
import { from_record, MapT } from "../src/map.ts";
import { RecordT } from "../src/record.ts";
import { Identity } from "../src/identity.ts";
import { Functor } from "../src/typeclasses.ts";
import { as_data } from "../src/typeclass.ts";
import { from_array as list, to_array as list_to_array } from "../src/list.ts";
import { inspect } from "../src/inspect.ts";
import { traverse_items } from "../src/traversal.ts";
let sink: unknown;
const source = Array.from({ length: 100_000 }, (_, index) => index);
const terminal_source = from_array(source);
const terminal_stages: readonly Stage[] = [
  { tag: "map", fn: (item) => Number(item) + 1 },
  { tag: "filter", fn: (item) => Number(item) % 2 === 0 },
  { tag: "take", count: 25_000 },
];
const fused = terminal_source.map((item) => item + 1).filter((item) =>
  item % 2 === 0
).take(25_000);
Deno.bench(
  { name: "manual fold", group: "terminal100k", baseline: true },
  () => {
    let sum = 0;
    let remaining = 25_000;
    for (const item of source) {
      const mapped = item + 1;
      if (mapped % 2 !== 0) continue;
      sum += mapped;
      remaining -= 1;
      if (remaining === 0) break;
    }
    sink = sum;
  },
);
Deno.bench({ name: "fused direct fold", group: "terminal100k" }, () => {
  sink = direct_fold<number, number>(
    terminal_source.value()(),
    terminal_stages,
    0,
    (sum, item) => sum + item,
  );
});
Deno.bench({ name: "fused generator fold", group: "terminal100k" }, () => {
  let sum = 0;
  for (const item of fused.value()()) sum += item;
  sink = sum;
});
const small = Array.from({ length: 16 }, (_, index) => index);
const maps = Array.from({ length: 12 }, () => (item: number) => item + 1);
let plan = from_array(small);
for (const fn of maps) plan = plan.map(fn);
type Link = { readonly stage: Stage; readonly previous?: Link };
const stage_links = maps.reduce<Link | undefined>(
  (previous, fn) => ({
    stage: { tag: "map", fn: fn as (item: unknown) => unknown },
    previous,
  }),
  undefined,
);
function* uncached_replay(): Generator<unknown> {
  const ordered: Stage[] = [];
  let link = stage_links;
  while (link !== undefined) {
    ordered.push(link.stage);
    link = link.previous;
  }
  ordered.reverse();
  const remaining = ordered.map((stage) => {
    if (stage.tag === "take") return stage.count;
    return Infinity;
  });
  if (remaining.includes(0)) return;
  for (const input of small) {
    let item: unknown = input;
    let keep = true;
    let stop = false;
    for (let index = 0; index < ordered.length; index += 1) {
      const operation = ordered[index];
      switch (operation.tag) {
        case "map":
          item = operation.fn(item);
          break;
        case "filter":
          keep = operation.fn(item);
          break;
        case "take":
          remaining[index] -= 1;
          if (remaining[index] === 0) stop = true;
          break;
      }
      if (!keep) break;
    }
    if (keep) yield item;
    if (stop) return;
  }
}
const uncached_plan = from_factory(uncached_replay);
Deno.bench({
  name: "uncached flattened plan replay",
  group: "plans16x12",
  baseline: true,
}, () => {
  for (let repeat = 0; repeat < 100; repeat += 1) {
    sink = to_array(uncached_plan);
  }
});
Deno.bench({ name: "cached plan replay", group: "plans16x12" }, () => {
  for (let repeat = 0; repeat < 100; repeat += 1) sink = to_array(plan);
});
const async_items = Array.from({ length: 5_000 }, (_, index) => index);
const async_source = Async.from_factory(async function* () {
  yield* async_items;
});
const async_fused = async_source.map((item) => item + 1).filter((item) =>
  item % 2 === 0
).take(1_000);
const nested_map = Async.from_factory(async function* () {
  for await (const item of async_source.value()()) yield item + 1;
});
const nested_filter = Async.from_factory(async function* () {
  for await (const item of nested_map.value()()) {
    if (await Promise.resolve(item % 2 === 0)) yield item;
  }
});
const async_nested = Async.from_factory(async function* () {
  let remaining = 1_000;
  for await (const item of nested_filter.value()()) {
    yield item;
    remaining -= 1;
    if (remaining === 0) return;
  }
});
Deno.bench({
  name: "nested async map/filter/take",
  group: "async5000",
  baseline: true,
}, async () => {
  sink = await Async.to_array(async_nested);
});
Deno.bench(
  { name: "fused async map/filter/take", group: "async5000" },
  async () => {
    sink = await Async.to_array(async_fused);
  },
);
const bytes = new Uint8Array(65_536).fill(17);
Deno.bench({
  name: "double copied buffer construction",
  group: "buffer64k",
  baseline: true,
}, () => {
  sink = buffer(Uint8Array.from(bytes));
});
Deno.bench({ name: "owned buffer construction", group: "buffer64k" }, () => {
  sink = buffer(bytes);
});
const large_buffer = new Uint8Array(1024 * 1024).fill(4);
const view = DataViewT(new DataView(large_buffer.buffer, 500_000, 1_024));
const other_view = DataViewT(new DataView(large_buffer.buffer, 500_000, 1_024));
Deno.bench(
  { name: "copied view equality", group: "view1k", baseline: true },
  () => {
    const left = new Uint8Array(view.value().buffer.slice(0));
    const right = new Uint8Array(other_view.value().buffer.slice(0));
    let equal = true;
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) {
        equal = false;
        break;
      }
    }
    sink = equal;
  },
);
Deno.bench({ name: "view equality", group: "view1k" }, () => {
  sink = view.eq(other_view);
});
const set_items = Array.from({ length: 1_000 }, (_, index) => index);
Deno.bench(
  { name: "double copied Set", group: "set1k", baseline: true },
  () => {
    sink = SetT(new Set(set_items));
  },
);
Deno.bench({ name: "owned Set", group: "set1k" }, () => {
  sink = from_iterable(set_items);
});
const record = Object.fromEntries(
  Array.from({ length: 1_000 }, (_, index) => [String(index), index]),
);
Deno.bench(
  { name: "Map from entries", group: "map-record1k", baseline: true },
  () => {
    sink = as_data(MapT, new Map(Object.entries(record)));
  },
);
Deno.bench({ name: "Map from keys", group: "map-record1k" }, () => {
  sink = from_record(record);
});
const wrapped_record = RecordT(record);
Deno.bench({
  name: "Record mapped entries",
  group: "record-map1k",
  baseline: true,
}, () => {
  const out: Record<string, number> = Object.create(null);
  for (const [key, value] of Object.entries(record)) out[key] = value + 1;
  sink = RecordT(out);
});
Deno.bench({ name: "Record mapped keys", group: "record-map1k" }, () => {
  sink = wrapped_record.map((item) => item + 1);
});
const equal_record = RecordT({ ...record });
Deno.bench({
  name: "Record sorted entries equality",
  group: "record-ord1k",
  baseline: true,
}, () => {
  const left = Object.entries(record).sort(([a], [b]) => compare_keys(a, b));
  const right = Object.entries(equal_record.value()).sort(([a], [b]) =>
    compare_keys(a, b)
  );
  sink = left.every(([key, value], index) =>
    key === right[index][0] && value === right[index][1]
  );
});
Deno.bench(
  { name: "Record equality before sorting", group: "record-ord1k" },
  () => {
    sink = wrapped_record.compare(equal_record);
  },
);
const wrapped_map = from_record(record);
Deno.bench({
  name: "Map traverse pairs",
  group: "map-traverse1k",
  baseline: true,
}, () => {
  sink = Functor.map(
    traverse_items(
      wrapped_map.value(),
      Identity,
      ([key, value]) =>
        Functor.map(Identity(value + 1), (item) => [key, item] as const),
    ),
    (items) => as_data(MapT, new Map(items)),
  );
});
Deno.bench({ name: "Map traverse values", group: "map-traverse1k" }, () => {
  sink = wrapped_map.traverse(Identity, (item) => Identity(item + 1));
});
Deno.bench({
  name: "Record traverse pairs",
  group: "record-traverse1k",
  baseline: true,
}, () => {
  sink = Functor.map(
    traverse_items(
      Object.entries(record),
      Identity,
      ([key, value]) =>
        Functor.map(Identity(value + 1), (item) => [key, item] as const),
    ),
    (items) => as_data(RecordT, Object.fromEntries(items)),
  );
});
Deno.bench(
  { name: "Record traverse values", group: "record-traverse1k" },
  () => {
    sink = wrapped_record.traverse(Identity, (item) => Identity(item + 1));
  },
);
// Keep values observable without console output in measured closures.
void sink;
function compare_keys(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
const wrapped_list = list(set_items);
Deno.bench({
  name: "List show value array",
  group: "list-show1k",
  baseline: true,
}, () => {
  sink = "[" + list_to_array(wrapped_list).map((item) =>
    inspect(item)
  ).join(", ") + "]";
});
Deno.bench({ name: "List show strings only", group: "list-show1k" }, () => {
  sink = wrapped_list.show();
});
