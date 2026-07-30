import { Effect, type TaggedOperation } from "../../src/effects.ts";

const Clock = Effect.operation<string>()(["clock.now"]);

export type Clock = typeof Clock;

type WithoutClock<requirements> = requirements extends Clock ? never
  : requirements;

export function now() {
  return Effect.send(Clock);
}

export function run_clock<requirements, item>(
  effect: Effect<requirements, item>,
  read_now: () => string,
): Effect<WithoutClock<requirements>, item> {
  if (effect[0] === "pure") {
    return Effect.pure(effect[1]);
  }

  const operation = effect[1] as TaggedOperation;

  if (operation[0] === "clock.now") {
    return run_clock(effect[2](read_now()), read_now);
  }

  return Effect.suspend(
    effect[1] as WithoutClock<requirements>,
    (value) => run_clock(effect[2](value), read_now),
  );
}

export function fixed_clock(value: string): () => string {
  return () => value;
}

export function system_clock(): () => string {
  return () => new Date().toISOString();
}
