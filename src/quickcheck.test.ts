import { assert_equals, assert_true } from "./assert.ts";
import { Effect, run } from "./effects.ts";
import { Either } from "./either.ts";
import { fn, type FnValue } from "./fn.ts";
import { Identity, identity, type IdentityValue } from "./identity.ts";
import { Just, Maybe, type MaybeValue, Nothing } from "./maybe.ts";
import { predicate, type PredicateValue } from "./predicate.ts";
import {
  alternative_laws,
  applicative_laws,
  arbitrary,
  array_of,
  arrow_laws,
  bifunctor_laws,
  category_laws,
  check,
  check_effect,
  check_laws,
  comonad_laws,
  constant,
  contravariant_laws,
  either_arbitrary,
  element,
  eq_laws,
  foldable_laws,
  functor_laws,
  Gen,
  integer,
  integer_arbitrary,
  map_arbitrary,
  maybe_arbitrary,
  monad_error_laws,
  monad_laws,
  monoid_laws,
  ord_laws,
  profunctor_laws,
  PropertyFailure,
  sample,
  semigroup_laws,
  sized,
  string_arbitrary,
  traversable_laws,
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

Deno.test("advanced typeclasses satisfy their reusable laws", () => {
  const integers = integer_arbitrary({ min: -20, max: 20 });
  const functions = arbitrary(element<(value: number) => number>([
    (value) => value,
    (value) => value + 1,
    (value) => -value,
  ]));
  const maybe_values = maybe_arbitrary(integers);
  const either_values = either_arbitrary(string_arbitrary(), integers);
  const predicates = arbitrary(element<PredicateValue<number>>([
    predicate((value) => value >= 0),
    predicate((value) => value % 2 === 0),
    predicate(() => true),
  ]));
  const function_values = map_arbitrary(
    functions,
    (value) => fn(value),
    (value) => value.value(),
  );
  const identity_values = map_arbitrary(
    integers,
    identity,
    (value: IdentityValue<number>) => value.value(),
  );
  const function_equals = (
    left: FnValue<number, number>,
    right: FnValue<number, number>,
  ) =>
    [-5, -1, 0, 1, 5].every((value) =>
      Object.is(left.run(value), right.run(value))
    );
  const predicate_equals = (
    left: PredicateValue<number>,
    right: PredicateValue<number>,
  ) => [-5, -1, 0, 1, 5].every((value) => left.run(value) === right.run(value));
  const Strings = Either.with_left<string>();

  const reports = check_laws([
    ...semigroup_laws({
      values: maybe_values,
      concat: (left, right) => left.concat(right),
      equals: (left, right) => left.eq(right),
    }),
    ...monoid_laws({
      values: maybe_values,
      empty: () => Maybe.empty<number>(),
      concat: (left, right) => left.concat(right),
      equals: (left, right) => left.eq(right),
    }),
    ...alternative_laws({
      values: maybe_values,
      empty: () => Nothing<number>(),
      alt: (left, right) => left.alt(right),
      equals: (left, right) => left.eq(right),
    }),
    ...foldable_laws({
      values: maybe_values,
      fold: (value, initial, combine) => value.fold(initial, combine),
      to_array: (value) => {
        const [tag, item] = value.value();
        return tag === "Nothing" ? [] : [item];
      },
      equals_item: Object.is,
    }),
    ...traversable_laws({
      values: maybe_values,
      functions,
      traverse: (value, transform) =>
        value.traverse(Identity, (item) => identity(transform(item))).value(),
      equals: (left, right) => left.eq(right),
    }),
    ...bifunctor_laws({
      values: either_values,
      left_functions: arbitrary(element([
        (value: string) => value,
        (value: string) => value + "!",
      ])),
      right_functions: functions,
      bimap: (value, left, right) => value.bimap(left, right),
      equals: (left, right) => left.eq(right),
    }),
    ...contravariant_laws({
      values: predicates,
      functions,
      contramap: (value, transform) => value.contramap(transform),
      equals: predicate_equals,
    }),
    ...profunctor_laws({
      values: function_values,
      input_functions: functions,
      output_functions: functions,
      dimap: (value, input, output) => value.dimap(input, output),
      equals: function_equals,
    }),
    ...category_laws({
      arrows: function_values,
      identity: () => identity_arrow(),
      compose: (after, before) => after.compose(before),
      equals: function_equals,
    }),
    ...arrow_laws({
      functions,
      identity_function: (value: number) => value,
      compose_functions: (after, before) => (value) => after(before(value)),
      arr: (transform) => fn(transform),
      identity_arrow: () => identity_arrow(),
      compose_arrows: (after, before) => after.compose(before),
      first_coherence: (transform) => {
        const lifted = fn(transform).first<number, number>();
        const direct = fn((pair: readonly [number, number]) => {
          return [transform(pair[0]), pair[1]] as const;
        });

        const pairs = [[-2, 1], [0, 3], [4, 5]] as const;

        return pairs.every((pair) => {
          return JSON.stringify(lifted.run(pair)) ===
            JSON.stringify(direct.run(pair));
        });
      },
      equals: function_equals,
    }),
    ...comonad_laws({
      values: identity_values,
      functions: arbitrary(element([
        (value: IdentityValue<number>) => value.value(),
        (value: IdentityValue<number>) => value.value() + 1,
      ])),
      extract: (value) => value.extract(),
      extend: (value, extend) => value.extend(extend),
      equals: (left, right) => left.eq(right),
      equals_item: Object.is,
    }),
    ...monad_error_laws({
      values: either_values,
      items: integers,
      errors: string_arbitrary(),
      pure: (item) => Strings.pure(item),
      throw_error: (error) => Strings.throw_error<number>(error),
      catch_error: (value, recover) => value.catch_error(recover),
      recover: (error) => Strings.pure(error.length),
      equals: (left, right) => left.eq(right),
    }),
  ], { seed: 171, iterations: 50 });

  assert_equals(reports.length, 28);

  function identity_arrow(): FnValue<number, number> {
    return fn((value: number) => value);
  }
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
