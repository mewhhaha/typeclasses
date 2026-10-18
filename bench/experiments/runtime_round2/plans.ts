// Explicit finite Effect plan experiment: instructions and reducer are reusable;
// each suspension captures its own position/state for replay and multiresume.
// Explicit finite Effect plan experiment: instructions and reducer are reusable;
// each suspension captures its own position/state for replay and multiresume.
import {
  Effect,
  type Operation,
  type TaggedOperation,
} from "../../../src/effects.ts";

export function compile_effect_plan<
  requirement extends TaggedOperation & Operation<number>,
>(
  instructions: readonly requirement[],
): (initial: number) => Effect<requirement, number> {
  const plan = [...instructions];
  return (initial) => step(0, initial);
  function step(index: number, state: number): Effect<requirement, number> {
    if (index === plan.length) return Effect.pure(state);
    return Effect.suspend(
      plan[index],
      (value) => step(index + 1, state + value),
    );
  }
}

// Explicit persistent log experiment. Existing Writer remains eager; consumers
// choose the append-friendly monoid and flatten once at the boundary.
// Explicit persistent log experiment. Existing Writer remains eager; consumers
// choose the append-friendly monoid and flatten once at the boundary.
import {
  type As,
  data,
  type type_data,
  type type_item,
} from "../../../src/typeclass.ts";
import { Monoid, Semigroup } from "../../../src/typeclasses.ts";

const chunk_identity: unique symbol = Symbol("chunk_identity");
export type Chunk<item> =
  | { readonly tag: "empty" }
  | { readonly tag: "leaf"; readonly items: readonly item[] }
  | {
    readonly tag: "concat";
    readonly left: Chunk<item>;
    readonly right: Chunk<item>;
  };
export interface AsChunk
  extends As<AsChunk, typeof chunk_identity>, Monoid<AsChunk> {
  readonly [type_item]: unknown;
  readonly [type_data]: Chunk<this[typeof type_item]>;
}
export function chunk_dictionary(
  runtime = { data, Monoid, Semigroup },
): AsChunk {
  // The pinned 0.14.0 comparator predates the explicit identity argument.
  // Its data implementation has one parameter; the current API has two.
  let Chunk: AsChunk;
  if (runtime.data.length === 1) {
    Chunk = (runtime.data as unknown as () => AsChunk)();
  } else Chunk = runtime.data<AsChunk>(chunk_identity);
  runtime.Semigroup.instance(Chunk)({
    concat(right) {
      const left = this.value();
      if (left.tag === "empty") return right;
      const other = right.value();
      if (other.tag === "empty") return this;
      return Chunk({ tag: "concat", left, right: other });
    },
  });
  runtime.Monoid.instance(Chunk)({
    empty() {
      return Chunk({ tag: "empty" });
    },
  });
  return Chunk;
}
export function flatten<item>(chunk: Chunk<item>): item[] {
  const pending = [chunk];
  const output: item[] = [];
  while (pending.length > 0) {
    const current = pending.pop()!;
    switch (current.tag) {
      case "empty":
        break;
      case "leaf":
        for (const item of current.items) output.push(item);
        break;
      case "concat":
        pending.push(current.right, current.left);
        break;
    }
  }
  return output;
}

// Measured, deliberately experimental batching controller: increasing batch
// size trades queue delay and responsiveness for throughput.
export function adaptive_batch(
  previous: number,
  elapsed_ms: number,
  target_ms: number,
): number {
  if (elapsed_ms > target_ms * 1.5) return Math.max(1, previous >>> 1);
  if (elapsed_ms < target_ms * 0.5) return Math.min(64, previous * 2);
  return previous;
}
