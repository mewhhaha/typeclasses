import { assert_equals, assert_true } from "./assert.ts";
import { Effect, run } from "./effects.ts";
import { Just, Maybe, type MaybeValue, Nothing } from "./maybe.ts";
import {
  applicative_laws,
  arbitrary,
  array_of,
  check,
  check_effect,
  check_laws,
  constant,
  element,
  eq_laws,
  functor_laws,
  Gen,
  integer,
  integer_arbitrary,
  maybe_arbitrary,
  monad_laws,
  ord_laws,
  PropertyFailure,
  sample,
  sized,
} from "./quickcheck.ts";
import { Do } from "./typeclasses.ts";

Deno.test("Gen Do composes deterministic generators", () => {
  const coordinates = Do(Gen, function* () {
    const horizontal = yield* integer({ min: -10, max: 10 });
    const vertical = yield* integer({ min: -10, max: 10 });

    return [horizontal, vertical] as const;
  });

  assert_equals(
    sample(coordinates, { seed: 42, size: 10, count: 5 }),
    sample(coordinates, { seed: 42, size: 10, count: 5 }),
  );
});

Deno.test("check reports the smallest failing integer it finds", () => {
  let failure: unknown;

  try {
    check({
      arbitrary: integer_arbitrary({ min: 0, max: 10 }),
      seed: 3,
      iterations: 1,
      property: (value) => value === 0,
    });
  } catch (cause) {
    failure = cause;
  }

  if (!(failure instanceof PropertyFailure)) {
    throw new Error("a failed property must throw PropertyFailure", {
      cause: failure,
    });
  }

  assert_equals(failure.counterexample, 1);
  assert_equals(failure.iteration, 0);
});

Deno.test("a failure seed and size replay the generated case", () => {
  const values = arbitrary(sized((size) => constant(size)));
  let first_failure: unknown;

  try {
    check({
      arbitrary: values,
      seed: 19,
      iterations: 10,
      property: (value) => value < 4,
    });
  } catch (cause) {
    first_failure = cause;
  }

  if (!(first_failure instanceof PropertyFailure)) {
    throw new Error("the sized property must fail", {
      cause: first_failure,
    });
  }

  let replayed_failure: unknown;

  try {
    check({
      arbitrary: values,
      seed: first_failure.seed,
      start_size: first_failure.size,
      iterations: 1,
      property: (value) => value < 4,
    });
  } catch (cause) {
    replayed_failure = cause;
  }

  if (!(replayed_failure instanceof PropertyFailure)) {
    throw new Error("the reported seed and size must replay the failure", {
      cause: replayed_failure,
    });
  }

  assert_equals(replayed_failure.original, first_failure.original);
  assert_equals(replayed_failure.counterexample, first_failure.counterexample);
});

Deno.test("one-sided and minimum-size generator bounds remain valid at size zero", () => {
  assert_equals(
    sample(integer({ min: 200 }), { seed: 1, size: 0, count: 1 }),
    [200],
  );
  assert_equals(
    sample(array_of(constant("value"), { min_length: 3 }), {
      seed: 1,
      size: 0,
      count: 1,
    }),
    [["value", "value", "value"]],
  );
});

Deno.test("library arbitraries preserve their wrapped value types", () => {
  const values = sample(
    maybe_arbitrary(integer_arbitrary({ min: -5, max: 5 })).generate,
    { seed: 7, count: 20 },
  );

  for (const value of values) {
    const [tag, payload] = value.value();

    if (tag === "Just") {
      assert_true(
        Number.isInteger(payload),
        "Maybe arbitrary must contain generated integers",
      );
    }
  }
});

Deno.test("Maybe satisfies the reusable typeclass laws", () => {
  const integers = integer_arbitrary({ min: -20, max: 20 });
  const functions = arbitrary(element([
    (value: number) => value,
    (value: number) => value + 1,
    (value: number) => -value,
  ]));
  const monadic_functions = arbitrary(element([
    (value: number): MaybeValue<number> => Just(value),
    (value: number): MaybeValue<number> =>
      value % 2 === 0 ? Just(value / 2) : Nothing(),
  ]));
  const values = maybe_arbitrary(integers);
  const function_values = maybe_arbitrary(functions);
  const equals = (
    left: MaybeValue<number>,
    right: MaybeValue<number>,
  ): boolean => left.eq(right);

  const reports = check_laws([
    ...functor_laws({ values, functions, equals }),
    ...applicative_laws({
      dictionary: Maybe,
      items: integers,
      values,
      functions,
      function_values,
      equals,
    }),
    ...monad_laws({
      dictionary: Maybe,
      items: integers,
      values,
      functions: monadic_functions,
      equals,
    }),
    ...eq_laws(values),
    ...ord_laws(values),
  ], { seed: 91, iterations: 50 });

  assert_equals(reports.length, 15);
});

Deno.test("check_effect runs generated programs through the supplied interpreter", async () => {
  let interpreted = 0;

  const report = await check_effect({
    arbitrary: arbitrary(constant(21)),
    iterations: 3,
    property: (value) => Effect.pure(value * 2 === 42),
    run(effect) {
      interpreted += 1;
      return run(effect);
    },
  });

  assert_equals(report.iterations, 3);
  assert_equals(interpreted, 3);
});
