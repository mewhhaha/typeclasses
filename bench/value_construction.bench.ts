import { Just, Maybe, type Maybe as MaybeContext } from "../src/maybe.ts";
import { as_data, as_data_cached, type WrappedData } from "../src/typeclass.ts";

// Each benchmark iteration performs this many constructions or read cycles.
const iterations = 10_000;
let _sink: unknown;

type BenchValue = MaybeContext<number>;

const dictionary = {
  map(this: unknown, fn: (value: number) => number): number {
    return fn(1);
  },
};

const construct_data = as_data_cached(dictionary);
const branch_lookup_payload = raw_just(1);

type ConstructData<dictionary extends object = object> = <
  value,
  item = unknown,
>(
  value: value,
) => WrappedData<dictionary, value, item>;

const weakmap_constructors = new WeakMap<object, ConstructData<object>>();
const symbol_constructor = Symbol("symbol.constructor");
const weakmap_cached_as_data_warmed = weakmap_cached_as_data(
  dictionary,
  branch_lookup_payload,
);
const symbol_cached_as_data_warmed = symbol_cached_as_data(
  dictionary,
  branch_lookup_payload,
);
const lazy_construct_data = lazy_constructor(dictionary);
const lazy_construct_data_warmed = lazy_construct_data(branch_lookup_payload);

const record_dictionary = Symbol("record.dictionary");
const record_value = Symbol("record.value");

type RecordValue<dictionary, value> = {
  readonly [record_dictionary]: dictionary;
  readonly [record_value]: value;
};

const prototype_dictionary = Symbol("prototype.dictionary");
const prototype_value = Symbol("prototype.value");

type PrototypeValue<dictionary, value> = {
  readonly [prototype_dictionary]: dictionary;
  readonly [prototype_value]: value;
  value: () => value;
};

type MutablePrototypeValue<dictionary, value> = {
  [prototype_dictionary]: dictionary;
  [prototype_value]: value;
  value: () => value;
};

const prototype = {
  value<dictionary, value>(
    this: PrototypeValue<dictionary, value>,
  ): value {
    return this[prototype_value];
  },
};

Deno.bench("raw maybe payload construction", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = raw_just(index);
  }

  _sink = current;
});

Deno.bench("current Just() value construction", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = Just(index);
  }

  _sink = current;
});

Deno.bench("current Maybe(raw) value construction", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = Maybe(raw_just(index));
  }

  _sink = current;
});

Deno.bench("current as_data(dictionary, raw) construction", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = as_data(dictionary, raw_just(index));
  }

  _sink = current;
});

Deno.bench("cached as_data_cached(dictionary)(raw) construction", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = construct_data<BenchValue, number>(raw_just(index));
  }

  _sink = current;
});

Deno.bench("weakmap cached as_data(dictionary, raw) construction", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = weakmap_cached_as_data(dictionary, raw_just(index));
  }

  _sink = current;
});

Deno.bench("external symbol cached as_data(dictionary, raw)", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = symbol_cached_as_data(dictionary, raw_just(index));
  }

  _sink = current;
});

Deno.bench("lazy self-replacing constructor(raw) construction", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = lazy_construct_data(raw_just(index));
  }

  _sink = current;
});

Deno.bench("as_data(dictionary, existing raw) constructor lookup", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = as_data(dictionary, branch_lookup_payload);
  }

  _sink = current;
});

Deno.bench("as_data_cached(dictionary)(existing raw) no branch lookup", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = construct_data<BenchValue, number>(branch_lookup_payload);
  }

  _sink = current;
});

Deno.bench("weakmap cached as_data(dictionary, existing raw)", () => {
  let current: unknown = weakmap_cached_as_data_warmed;

  for (let index = 0; index < iterations; index += 1) {
    current = weakmap_cached_as_data(dictionary, branch_lookup_payload);
  }

  _sink = current;
});

Deno.bench("external symbol cached as_data(dictionary, existing raw)", () => {
  let current: unknown = symbol_cached_as_data_warmed;

  for (let index = 0; index < iterations; index += 1) {
    current = symbol_cached_as_data(dictionary, branch_lookup_payload);
  }

  _sink = current;
});

Deno.bench("lazy self-replacing constructor(existing raw)", () => {
  let current: unknown = lazy_construct_data_warmed;

  for (let index = 0; index < iterations; index += 1) {
    current = lazy_construct_data(branch_lookup_payload);
  }

  _sink = current;
});

Deno.bench("tuple [dictionary, raw] construction", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = tuple_value(dictionary, raw_just(index));
  }

  _sink = current;
});

Deno.bench("record {dictionary, raw} construction", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = record_value_of(dictionary, raw_just(index));
  }

  _sink = current;
});

Deno.bench("prototype symbol object construction", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = prototype_value_of(dictionary, raw_just(index));
  }

  _sink = current;
});

Deno.bench("current Maybe(raw).value() read", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = Maybe(raw_just(index)).value();
  }

  _sink = current;
});

Deno.bench("cached as_data_cached(dictionary)(raw).value() read", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = construct_data<BenchValue, number>(raw_just(index)).value();
  }

  _sink = current;
});

Deno.bench("tuple [dictionary, raw][1] read", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = tuple_value(dictionary, raw_just(index))[1];
  }

  _sink = current;
});

Deno.bench("prototype symbol object value() read", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = prototype_value_of(dictionary, raw_just(index)).value();
  }

  _sink = current;
});

function raw_just(value: number): BenchValue {
  return ["Just", value];
}

function weakmap_cached_as_data<dictionary extends object, value>(
  dictionary: dictionary,
  value: value,
): WrappedData<dictionary, value> {
  let construct = weakmap_constructors.get(dictionary) as
    | ConstructData<dictionary>
    | undefined;

  if (construct === undefined) {
    construct = as_data_cached(dictionary);
    weakmap_constructors.set(dictionary, construct as ConstructData<object>);
  }

  return construct<value>(value);
}

function symbol_cached_as_data<dictionary extends object, value>(
  dictionary: dictionary,
  value: value,
): WrappedData<dictionary, value> {
  const cache = dictionary as {
    [symbol_constructor]?: ConstructData<dictionary>;
  };
  let construct = cache[symbol_constructor];

  if (construct === undefined) {
    construct = as_data_cached(dictionary);
    Object.defineProperty(cache, symbol_constructor, {
      value: construct,
    });
  }

  return construct<value>(value);
}

function lazy_constructor<dictionary extends object>(
  dictionary: dictionary,
): <value>(value: value) => WrappedData<dictionary, value> {
  let construct = <value>(
    value: value,
  ): WrappedData<dictionary, value> => {
    construct = as_data_cached(dictionary) as typeof construct;
    return construct(value);
  };

  return (value) => construct(value);
}

function tuple_value<dictionary, value>(
  dictionary: dictionary,
  value: value,
): readonly [dictionary, value] {
  return [dictionary, value];
}

function record_value_of<dictionary, value>(
  dictionary: dictionary,
  value: value,
): RecordValue<dictionary, value> {
  return {
    [record_dictionary]: dictionary,
    [record_value]: value,
  };
}

function prototype_value_of<dictionary, value>(
  dictionary: dictionary,
  value: value,
): PrototypeValue<dictionary, value> {
  const current = Object.create(prototype) as MutablePrototypeValue<
    dictionary,
    value
  >;

  current[prototype_dictionary] = dictionary;
  current[prototype_value] = value;

  return current;
}
