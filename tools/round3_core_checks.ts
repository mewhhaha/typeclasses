import { assert_equals, assert_true } from "../src/assert.ts";
import { $slot, define_union, kind } from "../src/typeclass.ts";
import { Just, Maybe } from "../src/maybe.ts";
import {
  create_transform_cache,
  transform_do_program_source,
} from "./transform_do_program.ts";
import { create_dependency_graph } from "./dev_watch.ts";
import {
  type AllocationProfile,
  profile_budget_failures,
} from "./allocation_profile.ts";

function assert_throws(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error("Expected an exception");
}

Deno.test("tagged raw boundaries remain fresh and honor overridden conversions", () => {
  const token = Symbol("tagged");
  const Box = define_union(token, ["Box", $slot]);
  const value = Box.Box(7);
  assert_equals(value.value(), ["Box", 7]);
  assert_true(value.value() !== value.value(), "raw tuples remain fresh");
  let conversions = 0;
  Object.defineProperty(value, "value", {
    value() {
      conversions++;
      return ["Box", 9] as const;
    },
  });
  assert_equals(value.value(), ["Box", 9]);
  assert_equals(conversions, 1);
  assert_true(Box.Box.is(value), "custom conversion guards remain valid");
  assert_equals(conversions, 2);
  const present = Just(1);
  Object.defineProperty(present, "value", {
    value() {
      conversions++;
      return ["Just", 8] as const;
    },
  });
  const before = conversions;
  assert_equals(present.map((n) => n + 1).value(), ["Just", 9]);
  assert_equals(conversions, before + 1);
});

Deno.test("wrapped single-yield iterators preserve delegation, closing, throw and helpers", () => {
  const value = Just(7);
  const cursor = value[Symbol.iterator]();
  assert_equals(cursor.next(99), { done: false, value });
  assert_equals(cursor.next(42), { done: true, value: 42 });
  assert_equals<unknown>(cursor.next(8), { done: true, value: undefined });
  assert_equals(value[Symbol.iterator]().return(12), { done: true, value: 12 });
  const error = new Error("delegated");
  const thrown = value[Symbol.iterator]();
  assert_throws(() => thrown.throw(error));
  assert_equals<unknown>(thrown.next(), { done: true, value: undefined });
  const disposed = value[Symbol.iterator]();
  disposed[Symbol.dispose]();
  assert_equals<unknown>(disposed.next(), { done: true, value: undefined });
  const frozen = Object.freeze(value[Symbol.iterator]());
  assert_equals(frozen.next(), { done: false, value });
  assert_equals(frozen.next(9), { done: true, value: 9 });
  assert_equals(Object.freeze(value[Symbol.iterator]()).return(12), {
    done: true,
    value: 12,
  });
  assert_throws(() => Object.freeze(value[Symbol.iterator]()).throw(error));
  assert_equals([...value[Symbol.iterator]().map((v) => v.value()[0])], [
    "Just",
  ]);
});

Deno.test("dictionary checks preserve live diagnostic identities for weak and primitive kinds", () => {
  const left = Just(1);
  const other = { [kind]: Symbol("other") };
  const first = assert_throws(() => left.eq(other as typeof left)).message;
  assert_equals(
    assert_throws(() => left.eq(other as typeof left)).message,
    first,
  );
  const registered = { [kind]: Symbol.for("round3-diagnostic") };
  const registered_message =
    assert_throws(() => left.eq(registered as typeof left)).message;
  for (let index = 0; index < 1_000; index++) {
    assert_throws(() =>
      left.eq({ [kind]: "primitive-" + index } as unknown as typeof left)
    );
  }
  assert_equals(
    assert_throws(() => left.eq(other as typeof left)).message,
    first,
  );
  assert_equals(
    assert_throws(() => left.eq(registered as typeof left)).message,
    registered_message,
  );
  assert_true(Maybe.Just.is(left), "ordinary guards still work");
});

Deno.test("source-map opt-out is isolated in transform caches", () => {
  const source =
    'import { Do } from "../src/typeclasses.ts"; import { Just } from "../src/maybe.ts"; export const x = Do(function*(){return yield* Just(1);});';
  const cache = create_transform_cache();
  const mapped = cache.transform(source, "example.ts");
  const plain = cache.transform(source, "example.ts", { source_map: false });
  assert_true(mapped.transformed > 0, "source transforms");
  assert_true(mapped.map !== null, "default retains maps");
  assert_equals(plain.map, null);
  assert_equals(cache.stats().misses, 2);
  assert_equals(
    cache.transform(source, "example.ts", { source_map: false }).code,
    plain.code,
  );
  assert_equals(cache.stats().hits, 1);
  assert_equals(
    transform_do_program_source("export const untouched = 1", "plain.ts", {
      source_map: false,
    }).transformed,
    0,
  );
});

Deno.test("incremental watch graph replaces edges and retains deletion and dynamic fallbacks", () => {
  const graph = create_dependency_graph(
    new Map([
      ["/p/a.ts", "export const a = 1"],
      ["/p/b.ts", 'import {a} from "./a.ts"'],
      ["/p/c.ts", 'import {a} from "./a.ts"'],
    ]),
  );
  assert_equals(graph.affected(["/p/a.ts"]), ["/p/a.ts", "/p/b.ts", "/p/c.ts"]);
  graph.update("/p/b.ts", "export const b = 2");
  assert_equals(graph.affected(["/p/a.ts"]), ["/p/a.ts", "/p/c.ts"]);
  graph.update("/p/a.ts");
  assert_equals(graph.affected(["/p/a.ts"]), ["/p/c.ts"]);
  graph.update("/p/d.ts", "export const load = (path: string) => import(path)");
  assert_equals(graph.affected(["/p/b.ts"]), ["/p/b.ts", "/p/c.ts", "/p/d.ts"]);
  graph.update("/p/d.ts");
  assert_equals(graph.affected(["/p/b.ts"]), ["/p/b.ts"]);
});

Deno.test("allocation budgets reject regressions and incomparable workloads", () => {
  const profile: AllocationProfile = {
    name: "same",
    runtime: "test",
    samples: 1000,
    sampling_interval: 16384,
    allocated_bytes: 100000,
    allocated_bytes_per_run: 100,
    cpu_ms: 1,
    latency: { p50_ms: 1, p99_ms: 2, max_ms: 3 },
    gc: { collections: 1, pause_ms: 4, max_pause_ms: 4 },
  };
  const limits = { allocation_ratio: 1.2, p99_ratio: 1.2, gc_pause_ratio: 1.2 };
  assert_equals(profile_budget_failures(profile, profile, limits), []);
  assert_equals(
    profile_budget_failures(profile, {
      ...profile,
      allocated_bytes_per_run: 150,
    }, limits).length,
    1,
  );
  assert_throws(() =>
    profile_budget_failures(profile, { ...profile, name: "different" }, limits)
  );
});
