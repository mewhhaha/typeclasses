import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { inspect } from "./inspect.ts";
import { type EitherValue, Left, Right } from "./either.ts";
import type { Effect } from "./effects.ts";
import { from_array, type ListValue, to_array } from "./list.ts";
import { Just, type MaybeValue, Nothing } from "./maybe.ts";
import {
  Applicative,
  type Applicative as ApplicativeDictionary,
  Eq,
  type Eq as EqDictionary,
  Functor,
  type Functor as FunctorDictionary,
  Monad,
  type Monad as MonadDictionary,
  Ord,
  type Ord as OrdDictionary,
  type Ordering,
  Show,
} from "./typeclasses.ts";

/** @ignore */
export declare const gen_identity: unique symbol;

/** Deterministic state threaded through a generator. */
export type GenState = {
  readonly seed: number;
  readonly size: number;
};

/** A deterministic generator computation. */
export type Gen<item> = (state: GenState) => readonly [item, GenState];

/** Dictionary type for deterministic generators. */
export interface AsGen
  extends As<AsGen, typeof gen_identity>, Show<AsGen>, MonadDictionary<AsGen> {
  /** Higher-kinded slot for the generated item type. */
  readonly [type_item]: unknown;
  /** Generator representation at the selected item type. */
  readonly [type_data]: Gen<this[typeof type_item]>;
}

/** A generator wrapped with its Functor, Applicative, and Monad operations. */
export type GenValue<item> = Data<AsGen, item>;

/** Callable generator dictionary. */
export const Gen: AsGen = data<AsGen>();

/** Options shared by property checks. */
export type CheckSettings = {
  readonly seed?: number;
  readonly iterations?: number;
  readonly start_size?: number;
  readonly max_size?: number;
  readonly max_shrinks?: number;
};

/** A value generator paired with its shrinking strategy. */
export type Arbitrary<item> = {
  readonly generate: GenValue<item>;
  readonly shrink: (value: item) => Iterable<item>;
};

/** Options for a synchronous property check. */
export type CheckOptions<item> =
  & CheckSettings
  & {
    readonly arbitrary: Arbitrary<item>;
    readonly property: (value: item) => boolean | void;
  };

/** Options for an asynchronous property check. */
export type AsyncCheckOptions<item> =
  & CheckSettings
  & {
    readonly arbitrary: Arbitrary<item>;
    readonly property: (
      value: item,
    ) => boolean | void | PromiseLike<boolean | void>;
  };

/** Successful property-check metadata. */
export type CheckReport = {
  readonly seed: number;
  readonly iterations: number;
};

/** Reproducible evidence for a failed property. */
export class PropertyFailure extends Error {
  /** Seed that generated the original failing case. */
  readonly seed: number;
  /** Zero-based iteration where the failure occurred. */
  readonly iteration: number;
  /** Generator size used for the original failing case. */
  readonly size: number;
  /** Value generated before shrinking. */
  readonly original: unknown;
  /** Smallest failing value found by the configured shrinker. */
  readonly counterexample: unknown;
  /** Number of candidate values evaluated while shrinking. */
  readonly shrinks: number;

  /** Creates reproducible evidence for one property failure. */
  constructor(options: {
    readonly seed: number;
    readonly iteration: number;
    readonly size: number;
    readonly original: unknown;
    readonly counterexample: unknown;
    readonly shrinks: number;
    readonly cause: unknown;
  }) {
    super(
      "Property failed after " + (options.iteration + 1).toString() +
        " tests\nseed: " + options.seed.toString() +
        "\nsize: " + options.size.toString() +
        "\ncounterexample: " + inspect(options.counterexample),
      { cause: options.cause },
    );
    this.name = "PropertyFailure";
    this.seed = options.seed;
    this.iteration = options.iteration;
    this.size = options.size;
    this.original = options.original;
    this.counterexample = options.counterexample;
    this.shrinks = options.shrinks;
  }
}

/** A named, independently runnable typeclass law. */
export type Law = {
  readonly name: string;
  readonly check: (settings?: CheckSettings) => CheckReport;
};

/** Result metadata for one checked law. */
export type LawReport = CheckReport & {
  readonly name: string;
};

/** Options for checking an effect program with a caller-supplied interpreter. */
export type EffectCheckOptions<sample, requirements> =
  & CheckSettings
  & {
    readonly arbitrary: Arbitrary<sample>;
    readonly property: (
      sample: sample,
    ) => Effect<requirements, boolean | void>;
    readonly run: (
      effect: Effect<requirements, boolean | void>,
    ) => boolean | void | PromiseLike<boolean | void>;
  };

/** Inclusive bounds for integer generation. */
export type IntegerOptions = {
  readonly min?: number;
  readonly max?: number;
};

/** Length bounds for collection generation. */
export type CollectionOptions = {
  readonly min_length?: number;
  readonly max_length?: number;
};

/** Length and alphabet settings for string generation. */
export type StringOptions = CollectionOptions & {
  readonly alphabet?: string;
};

type PropertyOutcome =
  | { readonly status: "passed" }
  | { readonly status: "failed"; readonly cause: unknown };

const default_seed = 0x1a2b3c4d;
const default_iterations = 100;
const default_max_size = 100;
const default_max_shrinks = 1_000;
const default_alphabet =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** Wraps a deterministic generator function. */
export function generator<item>(generate: Gen<item>): GenValue<item> {
  return Gen(generate);
}

/** Runs one generator with an explicit seed and size. */
export function run_gen<item>(
  value: GenValue<item>,
  state: GenState,
): readonly [item, GenState] {
  return value.value()(normalize_state(state));
}

/** Produces deterministic samples from one generator. */
export function sample<item>(
  value: GenValue<item>,
  options: {
    readonly seed?: number;
    readonly size?: number;
    readonly count?: number;
  } = {},
): readonly item[] {
  const count = non_negative_integer(options.count ?? 10, "sample count");
  let state: GenState = {
    seed: normalize_seed(options.seed ?? default_seed),
    size: non_negative_integer(options.size ?? 10, "sample size"),
  };
  const values: item[] = [];

  for (let index = 0; index < count; index += 1) {
    const [value_at_index, next] = value.value()(state);
    values.push(value_at_index);
    state = next;
  }

  return values;
}

/** Generates one constant value. */
export function constant<item>(value: item): GenValue<item> {
  return Gen((state) => [value, state]);
}

/** Generates an integer in an inclusive range. */
export function integer(options: IntegerOptions = {}): GenValue<number> {
  return Gen((state) => {
    const bounds = integer_bounds(options, state.size);
    const [unit, next] = next_random(state);
    const value = bounds.min +
      Math.floor(unit * (bounds.max - bounds.min + 1));

    return [value, next];
  });
}

/** Generates a boolean with equal probability. */
export function boolean(): GenValue<boolean> {
  return integer({ min: 0, max: 1 }).map((value) => value === 1);
}

/** Selects one value from a non-empty collection. */
export function element<item>(
  values: readonly [item, ...item[]],
): GenValue<item> {
  return integer({ min: 0, max: values.length - 1 }).map(
    (index) => values[index],
  );
}

/** Selects and runs one generator from a non-empty collection. */
export function one_of<item>(
  values: readonly [GenValue<item>, ...GenValue<item>[]],
): GenValue<item> {
  return Gen((state) => {
    const [index, selected_state] = integer({
      min: 0,
      max: values.length - 1,
    }).value()(state);

    return values[index].value()(selected_state);
  });
}

/** Gives a generator access to the current size. */
export function sized<item>(
  select: (size: number) => GenValue<item>,
): GenValue<item> {
  return Gen((state) => select(state.size).value()(state));
}

/** Runs a generator with a fixed size while preserving its seed. */
export function resize<item>(
  size: number,
  value: GenValue<item>,
): GenValue<item> {
  const normalized_size = non_negative_integer(size, "generator size");

  return Gen((state) => {
    const [item, next] = value.value()({
      seed: state.seed,
      size: normalized_size,
    });

    return [item, { seed: next.seed, size: state.size }];
  });
}

/** Generates an array of values. */
export function array_of<item>(
  value: GenValue<item>,
  options: CollectionOptions = {},
): GenValue<readonly item[]> {
  return Gen((state) => {
    const bounds = collection_bounds(options, state.size);
    const [length, length_state] = integer({
      min: bounds.min,
      max: bounds.max,
    }).value()(state);
    const items: item[] = [];
    let current = length_state;

    for (let index = 0; index < length; index += 1) {
      const [item, next] = value.value()(current);
      items.push(item);
      current = next;
    }

    return [items, current];
  });
}

/** Creates an Arbitrary from a generator and optional shrinker. */
export function arbitrary<item>(
  generate: GenValue<item>,
  shrink: (value: item) => Iterable<item> = no_shrink,
): Arbitrary<item> {
  return { generate, shrink };
}

/** Converts an Arbitrary while preserving shrinking through a reverse conversion. */
export function map_arbitrary<source, target>(
  source: Arbitrary<source>,
  convert: (value: source) => target,
  recover: (value: target) => source,
): Arbitrary<target> {
  return arbitrary(
    source.generate.map(convert),
    function* (value) {
      for (const smaller of source.shrink(recover(value))) {
        yield convert(smaller);
      }
    },
  );
}

/** Creates bounded integers that shrink toward zero or the nearest bound. */
export function integer_arbitrary(
  options: IntegerOptions = {},
): Arbitrary<number> {
  const target = options.min !== undefined && options.min > 0
    ? options.min
    : options.max !== undefined && options.max < 0
    ? options.max
    : 0;

  return arbitrary(
    integer(options),
    (value) => shrink_integer(value, target),
  );
}

/** Creates booleans that shrink from true to false. */
export function boolean_arbitrary(): Arbitrary<boolean> {
  return arbitrary(boolean(), function* (value) {
    if (value) {
      yield false;
    }
  });
}

/** Creates strings from a configurable alphabet. */
export function string_arbitrary(
  options: StringOptions = {},
): Arbitrary<string> {
  const [first, ...remaining] = Array.from(
    options.alphabet ?? default_alphabet,
  );

  if (first === undefined) {
    throw new RangeError("string alphabet must not be empty");
  }

  const generated = array_of(
    element([first, ...remaining]),
    options,
  ).map((characters) => characters.join(""));
  const minimum = collection_bounds(options, default_max_size).min;

  return arbitrary(generated, (value) => shrink_string(value, minimum));
}

/** Creates arrays whose elements and structure both shrink. */
export function array_arbitrary<item>(
  item: Arbitrary<item>,
  options: CollectionOptions = {},
): Arbitrary<readonly item[]> {
  const minimum = collection_bounds(options, default_max_size).min;

  return arbitrary(
    array_of(item.generate, options),
    (values) => shrink_array(values, item.shrink, minimum),
  );
}

/** Creates optional values and shrinks present values toward Nothing. */
export function maybe_arbitrary<item>(
  item: Arbitrary<item>,
): Arbitrary<MaybeValue<item>> {
  const generate = one_of<MaybeValue<item>>([
    constant<MaybeValue<item>>(Nothing<item>()),
    item.generate.map((value): MaybeValue<item> => Just(value)),
  ]);

  return arbitrary(generate, function* (value) {
    const [tag, payload] = value.value();

    if (tag === "Nothing") {
      return;
    }

    yield Nothing<item>();

    for (const smaller of item.shrink(payload)) {
      yield Just(smaller);
    }
  });
}

/** Creates Either values while shrinking within the selected branch. */
export function either_arbitrary<left, right>(
  left: Arbitrary<left>,
  right: Arbitrary<right>,
): Arbitrary<EitherValue<left, right>> {
  const generate = one_of<EitherValue<left, right>>([
    left.generate.map((value) => Left<left, right>(value)),
    right.generate.map((value) => Right<left, right>(value)),
  ]);

  return arbitrary(generate, function* (value) {
    const [tag, payload] = value.value();

    switch (tag) {
      case "Left":
        for (const smaller of left.shrink(payload)) {
          yield Left<left, right>(smaller);
        }
        return;
      case "Right":
        for (const smaller of right.shrink(payload)) {
          yield Right<left, right>(smaller);
        }
    }
  });
}

/** Creates recursive List values through array generation and shrinking. */
export function list_arbitrary<item>(
  item: Arbitrary<item>,
  options: CollectionOptions = {},
): Arbitrary<ListValue<item>> {
  const arrays = array_arbitrary(item, options);

  return arbitrary(
    arrays.generate.map((values) => from_array([...values])),
    function* (value) {
      for (const smaller of arrays.shrink(to_array(value))) {
        yield from_array([...smaller]);
      }
    },
  );
}

/** Combines two Arbitrary values into a tuple. */
export function pair_arbitrary<left, right>(
  left: Arbitrary<left>,
  right: Arbitrary<right>,
): Arbitrary<readonly [left, right]> {
  return arbitrary(
    left.generate.bind((left_value) =>
      right.generate.map(
        (right_value): readonly [left, right] => [left_value, right_value],
      )
    ),
    function* ([left_value, right_value]) {
      for (const smaller of left.shrink(left_value)) {
        yield [smaller, right_value];
      }

      for (const smaller of right.shrink(right_value)) {
        yield [left_value, smaller];
      }
    },
  );
}

/** Combines three Arbitrary values into a tuple. */
export function triple_arbitrary<first, second, third>(
  first: Arbitrary<first>,
  second: Arbitrary<second>,
  third: Arbitrary<third>,
): Arbitrary<readonly [first, second, third]> {
  return arbitrary(
    first.generate.bind((first_value) =>
      second.generate.bind((second_value) =>
        third.generate.map(
          (third_value): readonly [first, second, third] => [
            first_value,
            second_value,
            third_value,
          ],
        )
      )
    ),
    function* ([first_value, second_value, third_value]) {
      for (const smaller of first.shrink(first_value)) {
        yield [smaller, second_value, third_value];
      }

      for (const smaller of second.shrink(second_value)) {
        yield [first_value, smaller, third_value];
      }

      for (const smaller of third.shrink(third_value)) {
        yield [first_value, second_value, smaller];
      }
    },
  );
}

/** Checks a synchronous property and throws PropertyFailure on failure. */
export function check<item>(options: CheckOptions<item>): CheckReport {
  const settings = normalize_settings(options);
  let seed = settings.seed;

  for (let iteration = 0; iteration < settings.iterations; iteration += 1) {
    const size = iteration_size(
      iteration,
      settings.start_size,
      settings.max_size,
    );
    const case_seed = seed;
    const [value, next] = options.arbitrary.generate.value()({
      seed: case_seed,
      size,
    });
    seed = next.seed;
    const outcome = evaluate_property(options.property, value);

    if (outcome.status === "passed") {
      continue;
    }

    const shrunk = shrink_failure(
      value,
      outcome.cause,
      options.arbitrary.shrink,
      options.property,
      settings.max_shrinks,
    );

    throw new PropertyFailure({
      seed: case_seed,
      iteration,
      size,
      original: value,
      counterexample: shrunk.value,
      shrinks: shrunk.count,
      cause: shrunk.cause,
    });
  }

  return { seed: settings.seed, iterations: settings.iterations };
}

/** Checks an asynchronous property and throws PropertyFailure on failure. */
export async function check_async<item>(
  options: AsyncCheckOptions<item>,
): Promise<CheckReport> {
  const settings = normalize_settings(options);
  let seed = settings.seed;

  for (let iteration = 0; iteration < settings.iterations; iteration += 1) {
    const size = iteration_size(
      iteration,
      settings.start_size,
      settings.max_size,
    );
    const case_seed = seed;
    const [value, next] = options.arbitrary.generate.value()({
      seed: case_seed,
      size,
    });
    seed = next.seed;
    const outcome = await evaluate_async_property(options.property, value);

    if (outcome.status === "passed") {
      continue;
    }

    const shrunk = await shrink_async_failure(
      value,
      outcome.cause,
      options.arbitrary.shrink,
      options.property,
      settings.max_shrinks,
    );

    throw new PropertyFailure({
      seed: case_seed,
      iteration,
      size,
      original: value,
      counterexample: shrunk.value,
      shrinks: shrunk.count,
      cause: shrunk.cause,
    });
  }

  return { seed: settings.seed, iterations: settings.iterations };
}

/** Checks generated Effect programs through an explicit test interpreter. */
export function check_effect<sample, requirements>(
  options: EffectCheckOptions<sample, requirements>,
): Promise<CheckReport> {
  return check_async({
    ...options,
    property: (sample) => options.run(options.property(sample)),
  });
}

/** Creates one named property law. */
export function law<item>(
  name: string,
  values: Arbitrary<item>,
  property: (value: item) => boolean | void,
): Law {
  return {
    name,
    check(settings = {}) {
      return check({ ...settings, arbitrary: values, property });
    },
  };
}

/** Checks every law with a deterministically offset seed. */
export function check_laws(
  laws: readonly Law[],
  settings: CheckSettings = {},
): readonly LawReport[] {
  const seed = normalize_seed(settings.seed ?? default_seed);

  return laws.map((current, index) => {
    const report = current.check({
      ...settings,
      seed: normalize_seed(seed + index),
    });

    return { name: current.name, ...report };
  });
}

/** Builds Functor identity and composition laws over generated endomorphisms. */
export function functor_laws<
  dictionary extends FunctorDictionary<dictionary>,
  item,
>(options: {
  readonly values: Arbitrary<Data<dictionary, item>>;
  readonly functions: Arbitrary<(value: item) => item>;
  readonly equals: (
    left: Data<dictionary, item>,
    right: Data<dictionary, item>,
  ) => boolean;
}): readonly Law[] {
  return [
    law(
      "Functor identity",
      options.values,
      (value) => options.equals(Functor.map(value, identity), value),
    ),
    law(
      "Functor composition",
      triple_arbitrary(
        options.values,
        options.functions,
        options.functions,
      ),
      ([value, first, second]) =>
        options.equals(
          Functor.map(Functor.map(value, first), second),
          Functor.map(value, (item) => second(first(item))),
        ),
    ),
  ];
}

/** Builds the Applicative identity, homomorphism, interchange, and composition laws. */
export function applicative_laws<
  dictionary extends ApplicativeDictionary<dictionary>,
  item,
>(options: {
  readonly dictionary: dictionary;
  readonly items: Arbitrary<item>;
  readonly values: Arbitrary<Data<dictionary, item>>;
  readonly functions: Arbitrary<(value: item) => item>;
  readonly function_values: Arbitrary<
    Data<dictionary, (value: item) => item>
  >;
  readonly equals: (
    left: Data<dictionary, item>,
    right: Data<dictionary, item>,
  ) => boolean;
}): readonly Law[] {
  return [
    law("Applicative identity", options.values, (value) =>
      options.equals(
        Applicative.ap(
          Applicative.pure(options.dictionary, identity<item>),
          value,
        ),
        value,
      )),
    law(
      "Applicative homomorphism",
      pair_arbitrary(options.functions, options.items),
      ([fn, value]) =>
        options.equals(
          Applicative.ap(
            Applicative.pure(options.dictionary, fn),
            Applicative.pure(options.dictionary, value),
          ),
          Applicative.pure(options.dictionary, fn(value)),
        ),
    ),
    law(
      "Applicative interchange",
      pair_arbitrary(options.function_values, options.items),
      ([fn, value]) =>
        options.equals(
          Applicative.ap(
            fn,
            Applicative.pure(options.dictionary, value),
          ),
          Applicative.ap(
            Applicative.pure(
              options.dictionary,
              (apply: (value: item) => item) => apply(value),
            ),
            fn,
          ),
        ),
    ),
    law(
      "Applicative composition",
      triple_arbitrary(
        options.function_values,
        options.function_values,
        options.values,
      ),
      ([outer, inner, value]) =>
        options.equals(
          Applicative.ap(
            Applicative.ap(
              Applicative.ap(
                Applicative.pure(options.dictionary, compose<item>),
                outer,
              ),
              inner,
            ),
            value,
          ),
          Applicative.ap(outer, Applicative.ap(inner, value)),
        ),
    ),
  ];
}

/** Builds Monad identity and associativity laws. */
export function monad_laws<
  dictionary extends MonadDictionary<dictionary>,
  item,
>(options: {
  readonly dictionary: dictionary;
  readonly items: Arbitrary<item>;
  readonly values: Arbitrary<Data<dictionary, item>>;
  readonly functions: Arbitrary<
    (value: item) => Data<dictionary, item>
  >;
  readonly equals: (
    left: Data<dictionary, item>,
    right: Data<dictionary, item>,
  ) => boolean;
}): readonly Law[] {
  return [
    law(
      "Monad left identity",
      pair_arbitrary(options.items, options.functions),
      ([value, fn]) =>
        options.equals(
          Monad.bind(Applicative.pure(options.dictionary, value), fn),
          fn(value),
        ),
    ),
    law("Monad right identity", options.values, (value) =>
      options.equals(
        Monad.bind(
          value,
          (item) => Applicative.pure(options.dictionary, item),
        ),
        value,
      )),
    law(
      "Monad associativity",
      triple_arbitrary(
        options.values,
        options.functions,
        options.functions,
      ),
      ([value, first, second]) =>
        options.equals(
          Monad.bind(Monad.bind(value, first), second),
          Monad.bind(value, (item) => Monad.bind(first(item), second)),
        ),
    ),
  ];
}

/** Builds Eq reflexivity, symmetry, and transitivity laws. */
export function eq_laws<
  dictionary extends EqDictionary<dictionary>,
  item,
>(values: Arbitrary<Data<dictionary, item>>): readonly Law[] {
  return [
    law("Eq reflexivity", values, (value) => Eq.eq(value, value)),
    law(
      "Eq symmetry",
      pair_arbitrary(values, values),
      ([left, right]) => Eq.eq(left, right) === Eq.eq(right, left),
    ),
    law(
      "Eq transitivity",
      triple_arbitrary(values, values, values),
      ([left, middle, right]) =>
        !(Eq.eq(left, middle) && Eq.eq(middle, right)) || Eq.eq(left, right),
    ),
  ];
}

/** Builds Ord coherence, reversal, and transitivity laws. */
export function ord_laws<
  dictionary extends OrdDictionary<dictionary>,
  item,
>(values: Arbitrary<Data<dictionary, item>>): readonly Law[] {
  return [
    law(
      "Ord agrees with Eq",
      pair_arbitrary(values, values),
      ([left, right]) =>
        (Ord.compare(left, right) === "eq") === Eq.eq(left, right),
    ),
    law(
      "Ord reverses",
      pair_arbitrary(values, values),
      ([left, right]) =>
        Ord.compare(right, left) === reverse_order(Ord.compare(left, right)),
    ),
    law(
      "Ord transitivity",
      triple_arbitrary(values, values, values),
      ([left, middle, right]) => {
        if (Ord.compare(left, middle) === "gt") {
          return true;
        }

        if (Ord.compare(middle, right) === "gt") {
          return true;
        }

        return Ord.compare(left, right) !== "gt";
      },
    ),
  ];
}

Show.instance(Gen)({
  show() {
    return "Gen(?)";
  },
});

Monad.derive(Gen)({
  pure(value) {
    return constant(value);
  },

  bind(fn) {
    const first = this.value();

    return Gen((state) => {
      const [value, next] = first(state);
      return fn(value).value()(next);
    });
  },
});

function next_random(state: GenState): readonly [number, GenState] {
  const seed = (state.seed + 0x6d2b79f5) >>> 0;
  let mixed = seed;
  mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  const value = ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;

  return [value, { seed, size: state.size }];
}

function normalize_state(state: GenState): GenState {
  return {
    seed: normalize_seed(state.seed),
    size: non_negative_integer(state.size, "generator size"),
  };
}

function normalize_seed(seed: number): number {
  if (!Number.isSafeInteger(seed)) {
    throw new RangeError("QuickCheck seed must be a safe integer: " + seed);
  }

  return seed >>> 0;
}

function non_negative_integer(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      name + " must be a non-negative safe integer: " +
        value,
    );
  }

  return value;
}

function integer_bounds(
  options: IntegerOptions,
  size: number,
): { readonly min: number; readonly max: number } {
  const requested_max = options.max ?? size;
  const min = options.min ?? Math.min(-size, requested_max);
  const max = options.max ?? Math.max(min, size);

  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) {
    throw new RangeError(
      "integer bounds must be safe integers: " + min + ", " + max,
    );
  }

  if (min > max) {
    throw new RangeError(
      "integer minimum " + min + " exceeds maximum " + max,
    );
  }

  if (max - min >= 4_294_967_296) {
    throw new RangeError(
      "integer range must contain at most 4294967296 values",
    );
  }

  return { min, max };
}

function collection_bounds(
  options: CollectionOptions,
  size: number,
): { readonly min: number; readonly max: number } {
  const min = non_negative_integer(
    options.min_length ?? 0,
    "minimum collection length",
  );
  const max = non_negative_integer(
    options.max_length ?? Math.max(min, size),
    "maximum collection length",
  );

  if (min > max) {
    throw new RangeError(
      "minimum collection length " + min +
        " exceeds maximum collection length " + max,
    );
  }

  return { min, max };
}

function* no_shrink<item>(_value: item): Iterable<item> {
}

function* shrink_integer(
  value: number,
  target: number,
): Iterable<number> {
  if (value === target) {
    return;
  }

  yield target;
  let distance = value - target;

  while (Math.abs(distance) > 1) {
    distance = Math.trunc(distance / 2);
    const candidate = target + distance;

    if (candidate !== value && candidate !== target) {
      yield candidate;
    }
  }
}

function* shrink_string(value: string, minimum: number): Iterable<string> {
  const characters = Array.from(value);

  if (characters.length > minimum) {
    yield characters.slice(0, minimum).join("");
  }

  for (let index = characters.length - 1; index > minimum; index -= 1) {
    yield characters.slice(0, index).join("");
  }
}

function* shrink_array<item>(
  values: readonly item[],
  shrink_item: (value: item) => Iterable<item>,
  minimum: number,
): Iterable<readonly item[]> {
  if (values.length > minimum) {
    yield values.slice(0, minimum);
  }

  for (let index = values.length - 1; index > minimum; index -= 1) {
    yield values.slice(0, index);
  }

  for (let index = 0; index < values.length; index += 1) {
    for (const smaller of shrink_item(values[index])) {
      const candidate = [...values];
      candidate[index] = smaller;
      yield candidate;
    }
  }
}

function normalize_settings(settings: CheckSettings): {
  readonly seed: number;
  readonly iterations: number;
  readonly start_size: number;
  readonly max_size: number;
  readonly max_shrinks: number;
} {
  const start_size = non_negative_integer(
    settings.start_size ?? 0,
    "initial property size",
  );
  const max_size = non_negative_integer(
    settings.max_size ?? default_max_size,
    "maximum property size",
  );

  if (start_size > max_size) {
    throw new RangeError(
      "initial property size " + start_size +
        " exceeds maximum property size " + max_size,
    );
  }

  return {
    seed: normalize_seed(settings.seed ?? default_seed),
    iterations: non_negative_integer(
      settings.iterations ?? default_iterations,
      "property iterations",
    ),
    start_size,
    max_size,
    max_shrinks: non_negative_integer(
      settings.max_shrinks ?? default_max_shrinks,
      "maximum property shrinks",
    ),
  };
}

function iteration_size(
  iteration: number,
  start_size: number,
  max_size: number,
): number {
  if (max_size === 0) {
    return 0;
  }

  return (start_size + iteration) % (max_size + 1);
}

function evaluate_property<item>(
  property: (value: item) => boolean | void,
  value: item,
): PropertyOutcome {
  try {
    if (property(value) === false) {
      return {
        status: "failed",
        cause: new Error("property returned false"),
      };
    }

    return { status: "passed" };
  } catch (cause) {
    return { status: "failed", cause };
  }
}

async function evaluate_async_property<item>(
  property: (
    value: item,
  ) => boolean | void | PromiseLike<boolean | void>,
  value: item,
): Promise<PropertyOutcome> {
  try {
    if (await property(value) === false) {
      return {
        status: "failed",
        cause: new Error("property returned false"),
      };
    }

    return { status: "passed" };
  } catch (cause) {
    return { status: "failed", cause };
  }
}

function shrink_failure<item>(
  original: item,
  original_cause: unknown,
  shrink: (value: item) => Iterable<item>,
  property: (value: item) => boolean | void,
  maximum: number,
): { readonly value: item; readonly cause: unknown; readonly count: number } {
  let value = original;
  let cause = original_cause;
  let count = 0;

  while (count < maximum) {
    let reduced = false;

    for (const candidate of shrink(value)) {
      count += 1;
      const outcome = evaluate_property(property, candidate);

      if (outcome.status === "failed") {
        value = candidate;
        cause = outcome.cause;
        reduced = true;
        break;
      }

      if (count >= maximum) {
        break;
      }
    }

    if (!reduced) {
      break;
    }
  }

  return { value, cause, count };
}

async function shrink_async_failure<item>(
  original: item,
  original_cause: unknown,
  shrink: (value: item) => Iterable<item>,
  property: (
    value: item,
  ) => boolean | void | PromiseLike<boolean | void>,
  maximum: number,
): Promise<
  { readonly value: item; readonly cause: unknown; readonly count: number }
> {
  let value = original;
  let cause = original_cause;
  let count = 0;

  while (count < maximum) {
    let reduced = false;

    for (const candidate of shrink(value)) {
      count += 1;
      const outcome = await evaluate_async_property(property, candidate);

      if (outcome.status === "failed") {
        value = candidate;
        cause = outcome.cause;
        reduced = true;
        break;
      }

      if (count >= maximum) {
        break;
      }
    }

    if (!reduced) {
      break;
    }
  }

  return { value, cause, count };
}

function identity<item>(value: item): item {
  return value;
}

function compose<item>(
  outer: (value: item) => item,
): (inner: (value: item) => item) => (value: item) => item {
  return (inner) => (value) => outer(inner(value));
}

function reverse_order(order: Ordering): Ordering {
  switch (order) {
    case "lt":
      return "gt";
    case "eq":
      return "eq";
    case "gt":
      return "lt";
  }
}
