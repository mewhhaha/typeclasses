import { selected_test_result } from "./mutation_checks.ts";
import { render_examples } from "./sync_examples.ts";
import { assert_equals, assert_true } from "../src/assert.ts";
import { summarize_pairs } from "./paired_bench.ts";
import { latency_summary, profile_workload } from "./runtime_profile.ts";
import { publish_matches } from "./package_consumer.ts";
import { direct_fold } from "../bench/experiments/round2_direct_fold.ts";

Deno.test("ABBA summary counterbalances drift and reports bootstrap uncertainty", () => {
  const summary = summarize_pairs([[10, 6, 7, 16], [20, 11, 12, 26]]);
  assert_equals(summary.speedup, 2);
  assert_equals(summary.confidence_95, [2, 2]);
  const noisy = summarize_pairs([[2, 1, 1, 2], [3, 1, 1, 3], [1, 1, 1, 1]]);
  assert_true(
    noisy.confidence_95[0] < noisy.speedup &&
      noisy.confidence_95[1] > noisy.speedup,
    "interval must reflect across-block variation",
  );
});

Deno.test("runtime latency summary exposes rare tail observations", () => {
  const samples = Array.from({ length: 100 }, () => 1);
  samples[99] = 100;
  assert_equals(latency_summary(samples), {
    samples: 100,
    p50_ms: 1,
    p95_ms: 1,
    p99_ms: 1,
    max_ms: 100,
  });
});

Deno.test("publish selection includes nested sources and excludes only matching tests", () => {
  assert_true(
    publish_matches("src/mod.ts", "src/**/*.ts"),
    "globstar must include root source files",
  );
  assert_true(
    publish_matches("src/typeclasses/functor.ts", "src/**/*.ts"),
    "globstar must include nested source files",
  );
  assert_true(
    publish_matches("src/laws.test.ts", "src/*.test.ts"),
    "test exclusion must match",
  );
  assert_equals(
    publish_matches("src/typeclasses/mod.ts", "src/*.test.ts"),
    false,
  );
  assert_equals(publish_matches("src/mod.tsx", "src/**/*.ts"), false);
});

Deno.test("rejected terminal fold retains cleanup, stage-local limits and replay", () => {
  let closed = 0;
  function* source() {
    try {
      yield* [1, 2, 3, 4];
    } finally {
      closed += 1;
    }
  }
  const stages = [
    { tag: "map" as const, fn: (item: unknown) => Number(item) * 2 },
    { tag: "take" as const, count: 3 },
    { tag: "filter" as const, fn: (item: unknown) => Number(item) > 2 },
  ];
  for (let repeat = 0; repeat < 2; repeat += 1) {
    assert_equals(
      direct_fold<number, number>(
        source(),
        stages,
        0,
        (sum, item) => sum + item,
      ),
      10,
    );
  }
  assert_equals(closed, 2);
  const error = new Error("callback failure");
  try {
    direct_fold(source(), stages, 0, () => {
      throw error;
    });
    throw new Error("expected failure");
  } catch (failure) {
    assert_equals(failure, error);
  }
  assert_equals(closed, 3);
});

Deno.test("mutation kills require a selected assertion failure", () => {
  const wrap = (body: string) =>
    '<testsuite><testcase name="guard">' + body + "</testcase></testsuite>";
  assert_equals(
    selected_test_result(
      wrap("<failure>Error: expected\n at assert_true (assert.ts:1)</failure>"),
      "guard",
    ).assertion_failed,
    true,
  );
  assert_equals(
    selected_test_result(
      wrap("<failure>NotCapable: requires env access</failure>"),
      "guard",
    ).assertion_failed,
    false,
  );
  assert_equals(
    selected_test_result(wrap("<error>module failed</error>"), "guard")
      .assertion_failed,
    false,
  );
  assert_equals(
    selected_test_result(wrap("<skipped/>"), "guard").passed,
    false,
  );
});

Deno.test("documentation snippets rewrite public imports and reject malformed markers", async () => {
  const marker =
    "<!-- example:examples/demo.ts#call -->\nstale\n<!-- /example -->";
  const source =
    '// docs:begin call\nimport { Just } from "../src/maybe.ts";\nJust(42);\n// docs:end call\n';
  const rendered = await render_examples(
    marker,
    "/repo",
    { "./maybe": "./src/maybe.ts" },
    "@scope/package",
    () => Promise.resolve(source),
  );
  assert_true(
    rendered.includes('from "@scope/package/maybe"'),
    "snippet must use the declared public export",
  );
  assert_equals(
    await render_examples(
      rendered,
      "/repo",
      { "./maybe": "./src/maybe.ts" },
      "@scope/package",
      () => Promise.resolve(source),
    ),
    rendered,
  );
  let rejected = false;
  try {
    await render_examples(
      "<!-- example:examples/demo.ts#call -->",
      "/repo",
      {},
      "@scope/package",
      () => Promise.resolve(source),
    );
  } catch {
    rejected = true;
  }
  assert_true(rejected, "an incomplete marker must fail the drift check");
});

Deno.test("runtime profiling disposes retained inputs once when execution fails", async () => {
  const disposed: number[] = [];
  let created = 0;
  const failure = new Error("execution failed");
  try {
    await profile_workload(
      {
        name: "cleanup",
        create: () => created++,
        run: (value) => {
          if (value === 1) throw failure;
          return value;
        },
        dispose: (value) => {
          disposed.push(value);
        },
      },
      3,
      0,
    );
    throw new Error("expected failure");
  } catch (error) {
    assert_equals(error, failure);
  }
  assert_equals(disposed.sort(), [0, 1, 2]);
});
