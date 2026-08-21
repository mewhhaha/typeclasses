import { Effect, has_tag, type WithoutOperation } from "../../src/effects.ts";

const Clock = Effect.operation<string>()(["clock.now"]);

export type Clock = typeof Clock;

export function now() {
  return Effect.send(Clock);
}

export function run_clock<requirements, item>(
  effect: Effect<requirements, item>,
  read_now: () => string,
): Effect<WithoutOperation<requirements, Clock>, item> {
  return Effect.handle_operation(
    effect,
    (operation): operation is Clock => has_tag(operation, "clock.now"),
    () => Effect.pure(read_now()),
  );
}

export function fixed_clock(value: string): () => string {
  return () => value;
}

export function system_clock(): () => string {
  return () => new Date().toISOString();
}
