import { Option, type Option as OptionContext, some } from "../src/option.ts";
import { as_trait, as_trait_cached, type Trait } from "../src/trait.ts";

// Each benchmark iteration performs this many constructions or read cycles.
const iterations = 10_000;
let _sink: unknown;

type BenchValue = OptionContext<number>;

const dictionary = {
  map(this: unknown, fn: (value: number) => number): number {
    return fn(1);
  },
};

const construct_trait = as_trait_cached(dictionary);
const branch_lookup_payload = raw_some(1);

type ConstructTrait<dictionary extends object = object> = <
  value,
  item = unknown,
>(
  value: value,
) => Trait<dictionary, value, item>;

const weakmap_constructors = new WeakMap<object, ConstructTrait<object>>();
const symbol_constructor = Symbol("symbol.constructor");
const weakmap_cached_as_trait_warmed = weakmap_cached_as_trait(
  dictionary,
  branch_lookup_payload,
);
const symbol_cached_as_trait_warmed = symbol_cached_as_trait(
  dictionary,
  branch_lookup_payload,
);
const lazy_construct_trait = lazy_constructor(dictionary);
const lazy_construct_trait_warmed = lazy_construct_trait(branch_lookup_payload);

const proxy_brand = Symbol("proxy.brand");
const proxy_dictionary = Symbol("proxy.dictionary");
const proxy_value = Symbol("proxy.value");

type ProxyTarget<dictionary, value> = {
  readonly [proxy_brand]: true;
  readonly [proxy_dictionary]: dictionary;
  readonly [proxy_value]: value;
};

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

Deno.bench("raw option payload construction", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = raw_some(index);
  }

  _sink = current;
});

Deno.bench("current some() value construction", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = some(index);
  }

  _sink = current;
});

Deno.bench("current Option(raw) value construction", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = Option(raw_some(index));
  }

  _sink = current;
});

Deno.bench("current as_trait(dictionary, raw) construction", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = as_trait(dictionary, raw_some(index));
  }

  _sink = current;
});

Deno.bench("cached as_trait_cached(dictionary)(raw) construction", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = construct_trait<BenchValue, number>(raw_some(index));
  }

  _sink = current;
});

Deno.bench("weakmap cached as_trait(dictionary, raw) construction", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = weakmap_cached_as_trait(dictionary, raw_some(index));
  }

  _sink = current;
});

Deno.bench("external symbol cached as_trait(dictionary, raw)", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = symbol_cached_as_trait(dictionary, raw_some(index));
  }

  _sink = current;
});

Deno.bench("lazy self-replacing constructor(raw) construction", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = lazy_construct_trait(raw_some(index));
  }

  _sink = current;
});

Deno.bench("as_trait(dictionary, existing raw) constructor lookup", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = as_trait(dictionary, branch_lookup_payload);
  }

  _sink = current;
});

Deno.bench("as_trait_cached(dictionary)(existing raw) no branch lookup", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = construct_trait<BenchValue, number>(branch_lookup_payload);
  }

  _sink = current;
});

Deno.bench("weakmap cached as_trait(dictionary, existing raw)", () => {
  let current: unknown = weakmap_cached_as_trait_warmed;

  for (let index = 0; index < iterations; index += 1) {
    current = weakmap_cached_as_trait(dictionary, branch_lookup_payload);
  }

  _sink = current;
});

Deno.bench("external symbol cached as_trait(dictionary, existing raw)", () => {
  let current: unknown = symbol_cached_as_trait_warmed;

  for (let index = 0; index < iterations; index += 1) {
    current = symbol_cached_as_trait(dictionary, branch_lookup_payload);
  }

  _sink = current;
});

Deno.bench("lazy self-replacing constructor(existing raw)", () => {
  let current: unknown = lazy_construct_trait_warmed;

  for (let index = 0; index < iterations; index += 1) {
    current = lazy_construct_trait(branch_lookup_payload);
  }

  _sink = current;
});

Deno.bench("legacy proxy trait(dictionary, raw) construction", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = proxy_trait(dictionary, raw_some(index));
  }

  _sink = current;
});

Deno.bench("tuple [dictionary, raw] construction", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = tuple_value(dictionary, raw_some(index));
  }

  _sink = current;
});

Deno.bench("record {dictionary, raw} construction", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = record_value_of(dictionary, raw_some(index));
  }

  _sink = current;
});

Deno.bench("prototype symbol object construction", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = prototype_value_of(dictionary, raw_some(index));
  }

  _sink = current;
});

Deno.bench("current Option(raw).value() read", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = Option(raw_some(index)).value();
  }

  _sink = current;
});

Deno.bench("cached as_trait_cached(dictionary)(raw).value() read", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = construct_trait<BenchValue, number>(raw_some(index)).value();
  }

  _sink = current;
});

Deno.bench("legacy proxy trait(raw).value() read", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = proxy_trait(dictionary, raw_some(index)).value();
  }

  _sink = current;
});

Deno.bench("tuple [dictionary, raw][1] read", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = tuple_value(dictionary, raw_some(index))[1];
  }

  _sink = current;
});

Deno.bench("prototype symbol object value() read", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = prototype_value_of(dictionary, raw_some(index)).value();
  }

  _sink = current;
});

function raw_some(value: number): BenchValue {
  return { tag: "some", value };
}

function weakmap_cached_as_trait<dictionary extends object, value>(
  dictionary: dictionary,
  value: value,
): Trait<dictionary, value> {
  let construct = weakmap_constructors.get(dictionary) as
    | ConstructTrait<dictionary>
    | undefined;

  if (construct === undefined) {
    construct = as_trait_cached(dictionary);
    weakmap_constructors.set(dictionary, construct as ConstructTrait<object>);
  }

  return construct<value>(value);
}

function symbol_cached_as_trait<dictionary extends object, value>(
  dictionary: dictionary,
  value: value,
): Trait<dictionary, value> {
  const cache = dictionary as {
    [symbol_constructor]?: ConstructTrait<dictionary>;
  };
  let construct = cache[symbol_constructor];

  if (construct === undefined) {
    construct = as_trait_cached(dictionary);
    Object.defineProperty(cache, symbol_constructor, {
      value: construct,
    });
  }

  return construct<value>(value);
}

function lazy_constructor<dictionary extends object>(
  dictionary: dictionary,
): <value>(value: value) => Trait<dictionary, value> {
  let construct = <value>(
    value: value,
  ): Trait<dictionary, value> => {
    construct = as_trait_cached(dictionary) as typeof construct;
    return construct(value);
  };

  return (value) => construct(value);
}

function proxy_trait<dictionary extends object, value>(
  dictionary: dictionary,
  value: value,
): { value: () => value } & dictionary {
  const target: ProxyTarget<dictionary, value> = {
    [proxy_brand]: true,
    [proxy_dictionary]: dictionary,
    [proxy_value]: value,
  };

  return new Proxy(target, {
    get(current, property, receiver) {
      if (property === proxy_brand) {
        return true;
      }

      if (property === proxy_dictionary) {
        return current[proxy_dictionary];
      }

      if (property === proxy_value) {
        return current[proxy_value];
      }

      if (property === "value") {
        return function value() {
          return current[proxy_value];
        };
      }

      if (property === Symbol.iterator) {
        return function* iterator(): Generator<unknown, unknown, unknown> {
          const item = yield receiver;
          return item;
        };
      }

      const dictionary_value = current[proxy_dictionary][
        property as keyof dictionary
      ];

      if (typeof dictionary_value !== "function") {
        return dictionary_value;
      }

      return function proxy_trait_function(...args: unknown[]) {
        return dictionary_value.call(receiver, ...args);
      };
    },
  }) as unknown as { value: () => value } & dictionary;
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
