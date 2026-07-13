import {
  from_factory as iterable_from_factory,
  to_array as iterable_to_array,
} from "../src/iterable.ts";

type Step = (value: number) => number;

const item_count = 50_000;
const prefix_count = 100;
const source_items = Array.from(
  { length: item_count },
  (_item, index) => index,
);
const iterable_source = iterable_from_factory(function* () {
  yield* source_items;
});
const steps: readonly Step[] = [
  (value) => value + 1,
  (value) => value * 3,
  (value) => value - 7,
  (value) => value + value % 11,
  (value) => value * 2,
  (value) => value - value % 5,
];

let _sink = 0;

Deno.bench("iterable pipeline Array.map materializes each step", () => {
  _sink = sum_array(array_materialized_pipeline());
});

Deno.bench("iterable pipeline native generator maps lazy", () => {
  _sink = sum_iterable(native_lazy_pipeline());
});

Deno.bench("iterable pipeline IterableT maps lazy, final array", () => {
  _sink = sum_array(iterable_to_array(iterable_lazy_pipeline()));
});

Deno.bench("iterable pipeline IterableT maps lazy, folded", () => {
  _sink = iterable_lazy_pipeline().fold(0, (total, item) => total + item);
});

Deno.bench("iterable pipeline manual fused loop", () => {
  _sink = manual_fused_sum();
});

Deno.bench("iterable pipeline Array.map materializes all, first 100", () => {
  _sink = sum_first_array(array_materialized_pipeline(), prefix_count);
});

Deno.bench("iterable pipeline native generator maps lazy, first 100", () => {
  _sink = sum_first_iterable(native_lazy_pipeline(), prefix_count);
});

Deno.bench("iterable pipeline IterableT maps lazy, first 100", () => {
  _sink = sum_first_iterable(iterable_lazy_pipeline().value()(), prefix_count);
});

function array_materialized_pipeline(): readonly number[] {
  let current: readonly number[] = source_items;

  for (const step of steps) {
    current = current.map(step);
  }

  return current;
}

function native_lazy_pipeline(): Iterable<number> {
  let current: Iterable<number> = source_items;

  for (const step of steps) {
    current = map_iterable(current, step);
  }

  return current;
}

function iterable_lazy_pipeline() {
  let current = iterable_source;

  for (const step of steps) {
    current = current.map(step);
  }

  return current;
}

function* map_iterable(
  source: Iterable<number>,
  fn: Step,
): Iterable<number> {
  for (const item of source) {
    yield fn(item);
  }
}

function sum_array(items: readonly number[]): number {
  let total = 0;

  for (const item of items) {
    total += item;
  }

  return total;
}

function sum_iterable(items: Iterable<number>): number {
  let total = 0;

  for (const item of items) {
    total += item;
  }

  return total;
}

function sum_first_array(items: readonly number[], count: number): number {
  let total = 0;

  for (let index = 0; index < count && index < items.length; index += 1) {
    total += items[index];
  }

  return total;
}

function sum_first_iterable(items: Iterable<number>, count: number): number {
  let total = 0;
  let seen = 0;

  for (const item of items) {
    total += item;
    seen += 1;

    if (seen >= count) {
      break;
    }
  }

  return total;
}

function manual_fused_sum(): number {
  let total = 0;

  for (const item of source_items) {
    let current = item;

    for (const step of steps) {
      current = step(current);
    }

    total += current;
  }

  return total;
}

const expected_pipeline = array_materialized_pipeline();
const native_pipeline = [...native_lazy_pipeline()];
const wrapped_pipeline = iterable_to_array(iterable_lazy_pipeline());

assert_same_pipeline("native generator", native_pipeline, expected_pipeline);
assert_same_pipeline("IterableT", wrapped_pipeline, expected_pipeline);
assert_same_number(
  "IterableT fold",
  iterable_lazy_pipeline().fold(0, (total, item) => total + item),
  sum_array(expected_pipeline),
);
assert_same_number(
  "manual fused loop",
  manual_fused_sum(),
  sum_array(expected_pipeline),
);
assert_same_number(
  "native prefix",
  sum_first_iterable(native_lazy_pipeline(), prefix_count),
  sum_first_array(expected_pipeline, prefix_count),
);
assert_same_number(
  "IterableT prefix",
  sum_first_iterable(iterable_lazy_pipeline().value()(), prefix_count),
  sum_first_array(expected_pipeline, prefix_count),
);

function assert_same_pipeline(
  name: string,
  actual: readonly number[],
  expected: readonly number[],
): void {
  if (actual.length !== expected.length) {
    throw new Error(
      `${name} produced ${actual.length} values; expected ${expected.length}`,
    );
  }

  for (let index = 0; index < expected.length; index += 1) {
    if (!Object.is(actual[index], expected[index])) {
      throw new Error(
        `${name} differs at index ${index}: ` +
          `actual ${actual[index]}, expected ${expected[index]}`,
      );
    }
  }
}

function assert_same_number(
  name: string,
  actual: number,
  expected: number,
): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`${name} produced ${actual}; expected ${expected}`);
  }
}
