import { ArrayT } from "../src/array.ts";
import { from_array, List, type RawList } from "../src/list.ts";
import {
  from_array as iterable_from_array,
  to_array,
} from "../src/iterable.ts";
import { Applicative, Functor } from "../src/typeclasses.ts";
import { data } from "../src/typeclass.ts";
import {
  type AsIdentity,
  Identity,
  identity_identity,
} from "../src/identity.ts";
import { traverse_items } from "../src/traversal.ts";

// Isolated alternatives, not a historical library comparison. Every benchmark
// consumes its output. Run this file by itself, with other benchmark jobs idle.
let sink: unknown;
const input = Array.from({ length: 1024 }, (_, index) => index);
const list = from_array(input);
const increment = (item: number) => item + 1;

function reversed_map(): unknown {
  let reversed: RawList<number> = ["Nil"];
  let source = list.value();
  while (source[0] === "Cons") {
    reversed = ["Cons", increment(source[1]), reversed];
    source = source[2];
  }
  let out: RawList<number> = ["Nil"];
  while (reversed[0] === "Cons") {
    out = ["Cons", reversed[1], out];
    reversed = reversed[2];
  }
  return List(out);
}
Deno.bench({
  name: "list map/reverse baseline/1024",
  group: "list-map",
  baseline: true,
}, () => {
  sink = reversed_map();
});
Deno.bench({ name: "list map/private builder/1024", group: "list-map" }, () => {
  sink = list.map(increment);
});

function retained_bind(chunks: readonly (readonly number[])[]): number[] {
  const retained: (readonly number[])[] = [];
  let length = 0;
  for (const chunk of chunks) {
    retained.push(chunk);
    length += chunk.length;
  }
  const out = new Array<number>(length);
  let index = 0;
  for (const chunk of retained) for (const item of chunk) out[index++] = item;
  return out;
}
function streaming_bind(chunks: readonly (readonly number[])[]): number[] {
  const out: number[] = [];
  for (const chunk of chunks) for (const item of chunk) out.push(item);
  return out;
}
for (const width of [1, 4, 64, 1024]) {
  const chunks = input.map((item) => Array.from({ length: width }, () => item));
  const group = "array-bind-" + width;
  Deno.bench({
    name: "array bind/retained/1024x" + width,
    group,
    baseline: true,
  }, () => {
    sink = retained_bind(chunks);
  });
  Deno.bench({ name: "array bind/streaming/1024x" + width, group }, () => {
    sink = streaming_bind(chunks);
  });
}

// Same instances, separate runtime dictionary: intentionally omit registration
// of the specialization to retain a reproducible generic counterfactual.
const generic_identity: AsIdentity = data<AsIdentity>(identity_identity);
Functor.instance(generic_identity)(Functor.instance_for(Identity));
Applicative.instance(generic_identity)(Applicative.instance_for(Identity));
Deno.bench({
  name: "identity traversal/generic tree/1024",
  group: "identity-traverse",
  baseline: true,
}, () => {
  sink = traverse_items(input, generic_identity, (item) => Identity(item + 1))
    .value();
});
Deno.bench({
  name: "identity traversal/registered specialization/1024",
  group: "identity-traverse",
}, () => {
  sink = traverse_items(input, Identity, (item) => Identity(item + 1)).value();
});
Deno.bench({
  name: "identity traversal/direct candidate/1024",
  group: "identity-traverse",
}, () => {
  const out: number[] = [];
  for (const item of input) out.push(Identity(item + 1).value());
  sink = Identity(out).value();
});

function* nested_map(source: Iterable<number>): Generator<number> {
  for (const item of source) yield item + 1;
}
let nested: () => Iterable<number> = () => input;
let fused = iterable_from_array(input);
for (let index = 0; index < 12; index += 1) {
  const previous = nested;
  nested = () => nested_map(previous());
  fused = fused.map(increment);
}
Deno.bench({
  name: "iterable maps/nested generators/depth12",
  group: "iterable-fusion",
  baseline: true,
}, () => {
  sink = [...nested()];
});
Deno.bench({
  name: "iterable maps/fused interpreter/depth12",
  group: "iterable-fusion",
}, () => {
  sink = to_array(fused);
});

const dimensions = Array.from({ length: 5 }, () => [1, 2, 3, 4]);
function rows_product(): number[] {
  let rows: number[][] = [[]];
  for (const source of dimensions) {
    const next: number[][] = [];
    for (const row of rows) {
      for (const item of source) next.push([...row, item]);
    }
    rows = next;
  }
  return rows.map((row) => row.reduce((sum, item) => sum + item, 0));
}
Deno.bench({
  name: "array product/prefix rows/5x4",
  group: "cartesian-prefix",
  baseline: true,
}, () => {
  sink = rows_product();
});
Deno.bench({
  name: "array product/scratch prefix/5x4",
  group: "cartesian-prefix",
}, () => {
  sink = Applicative.lift(
    (a: number, b: number, c: number, d: number, e: number) =>
      a + b + c + d + e,
    ArrayT(dimensions[0]),
    ArrayT(dimensions[1]),
    ArrayT(dimensions[2]),
    ArrayT(dimensions[3]),
    ArrayT(dimensions[4]),
  ).value();
});

// Consume once at module exit too, keeping the accumulator observable.
if (sink === Symbol.for("unreachable")) throw new Error("unreachable");
