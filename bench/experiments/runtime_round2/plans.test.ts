import { assert_equals } from "../../../src/assert.ts";
import { Effect, Program, run } from "../../../src/effects.ts";
import { tell } from "../../../src/writer.ts";
import {
  adaptive_batch,
  chunk_dictionary,
  compile_effect_plan,
  flatten,
} from "./plans.ts";

Deno.test("explicit Effect plans preserve repeated execution and suspended multiresume", () => {
  const Tick = Effect.operation<number>()(["round2.tick"]);
  const compiled = compile_effect_plan([Tick, Tick, Tick]);
  const effect = compiled(0);
  function execute(value: typeof effect): number {
    return run(
      Effect.handle_operation(
        value,
        (operation): operation is typeof Tick => operation === Tick,
        () => Effect.pure(1),
      ),
    );
  }
  assert_equals(execute(effect), 3);
  assert_equals(execute(effect), 3);
  if (effect[0] !== "impure") throw new Error("Expected suspension");
  assert_equals(execute(effect[2](5)), 7);
  assert_equals(execute(effect[2](10)), 12);
  const generator = Program(function* () {
    let result = 0;
    for (let index = 0; index < 3; index += 1) {
      result += yield* Effect.send(Tick);
    }
    return result;
  });
  assert_equals(execute(generator), execute(effect));
});
Deno.test("chunk logs append linearly and preserve prior Writer values", () => {
  const Chunk = chunk_dictionary();
  const first = tell(Chunk({ tag: "leaf", items: [1] }));
  let output = first;
  for (let index = 2; index <= 10_000; index += 1) {
    output = output.bind(() => tell(Chunk({ tag: "leaf", items: [index] })));
  }
  assert_equals(flatten(first.value()[1].value()), [1]);
  assert_equals(
    flatten(output.value()[1].value()),
    Array.from({ length: 10_000 }, (_, index) => index + 1),
  );
});
Deno.test("adaptive batching stays bounded and reacts to latency", () => {
  assert_equals(adaptive_batch(1, 1, 8), 2);
  assert_equals(adaptive_batch(64, 1, 8), 64);
  assert_equals(adaptive_batch(32, 20, 8), 16);
  assert_equals(adaptive_batch(1, 20, 8), 1);
});

Deno.test("ancestor lookup cache is rejected because parent writes invalidate it", async () => {
  const { stale_cache_observation } = await import("./lookup.ts");
  assert_equals(stale_cache_observation(), { direct: 7, cached: 0 });
});
