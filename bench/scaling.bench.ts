import { ArrayT } from "../src/array.ts";
import { Effect, Program, run } from "../src/effects.ts";
import { Identity } from "../src/identity.ts";
import { from_iterable, to_array } from "../src/iterable.ts";
import { MapT } from "../src/map.ts";
import { RecordT } from "../src/record.ts";
import { traverse_ } from "../src/prelude.ts";
import { State } from "../src/state.ts";
import { Traversable } from "../src/typeclasses.ts";

const Tick = Effect.operation<number>()(["benchmark.tick"]);
let _sink: unknown;

for (const size of [1_000, 2_000, 4_000, 8_000, 16_000]) {
  const items = Array.from({ length: size }, (_, index) => index);
  const array = ArrayT(items);
  const iterable = from_iterable(items);
  const map = MapT(new Map(items.map((item) => [String(item), item])));
  const record = RecordT(Object.fromEntries(map.value()));
  const chain = make_chain(size);
  const counter = State.with_state<number>();
  const count_one = () => counter((state) => [undefined, state + 1]);

  // These run even under test:benchmarks' non-matching filter.
  check_length(
    Traversable.traverse(array, Identity, Identity).value().value().length,
    size,
  );
  check_length(
    to_array(Traversable.traverse(iterable, Identity, Identity).value()).length,
    size,
  );
  check_length(
    Traversable.traverse(map, Identity, Identity).value().value().size,
    size,
  );
  check_length(
    Object.keys(
      Traversable.traverse(record, Identity, Identity).value().value(),
    ).length,
    size,
  );
  check_length(execute(chain), size + 1);
  check_length(execute(chain), size + 1);
  check_length(run(pure_program(size)), size);
  check_length(traverse_(counter, count_one, array).run(0)[1], size);

  Deno.bench({
    name: "ArrayT traverse/" + size,
    group: "ArrayT traverse scaling",
    fn() {
      _sink = Traversable.traverse(array, Identity, Identity);
    },
  });
  Deno.bench({
    name: "IterableT traverse/" + size,
    group: "IterableT traverse scaling",
    fn() {
      _sink = to_array(
        Traversable.traverse(iterable, Identity, Identity).value(),
      );
    },
  });
  Deno.bench({
    name: "MapT traverse/" + size,
    group: "MapT traverse scaling",
    fn() {
      _sink = Traversable.traverse(map, Identity, Identity);
    },
  });
  Deno.bench({
    name: "RecordT traverse/" + size,
    group: "RecordT traverse scaling",
    fn() {
      _sink = Traversable.traverse(record, Identity, Identity);
    },
  });
  Deno.bench({
    name: "State discarded traversal/" + size,
    group: "discarded traversal scaling",
    fn() {
      _sink = traverse_(counter, count_one, array).run(0);
    },
  });
  Deno.bench({
    name: "impure Effect bind/" + size,
    group: "impure Effect bind scaling",
    fn() {
      _sink = execute(chain);
    },
  });
  Deno.bench({
    name: "pure Program yields/" + size,
    group: "pure Program scaling",
    fn() {
      _sink = run(pure_program(size));
    },
  });
}

function make_chain(length: number): Effect<typeof Tick, number> {
  let effect = Effect.send(Tick);

  for (let index = 0; index < length; index += 1) {
    effect = Effect.bind(
      effect,
      (total) => Effect.map(Effect.send(Tick), (value) => total + value),
    );
  }

  return effect;
}

function execute(effect: Effect<typeof Tick, number>): number {
  let current = effect;

  while (current[0] === "impure") {
    current = current[2](1);
  }

  return current[1];
}

function pure_program(length: number) {
  return Program(function* () {
    let total = 0;

    for (let index = 0; index < length; index += 1) {
      total += yield* Effect.pure(1);
    }

    return total;
  });
}

function check_length(actual: number, expected: number) {
  if (actual !== expected) {
    throw new Error(
      `Scaling benchmark expected ${expected}, received ${actual}`,
    );
  }
}
