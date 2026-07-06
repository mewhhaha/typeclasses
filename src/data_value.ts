const data_constructor_key = Symbol("Data.constructor");
const data_prototype_key = Symbol("Data.prototype");
const data_value = Symbol("Data.value");
const has_own = Object.prototype.hasOwnProperty;

type WrappedDataBase<dictionary, value, item> = {
  readonly [data_value]: value;
  [Symbol.iterator]: () => Generator<
    WrappedData<dictionary, value, item>,
    item,
    unknown
  >;
  run: DataRunner<value>;
  value: () => value;
};

type DataRunner<value> = value extends (...args: infer args) => infer out
  ? (...args: args) => out
  : never;

export type WrappedData<dictionary, value, item = unknown> =
  & WrappedDataBase<dictionary, value, item>
  & dictionary;

type WrappedDataTarget<dictionary, value, item> = {
  [data_value]: value;
};

type DataConstructor<dictionary extends object = object> = <
  value,
  item = unknown,
>(
  value: value,
) => WrappedData<dictionary, value, item>;

type DataDictionary<dictionary extends object = object> = object & {
  [data_constructor_key]?: DataConstructor<dictionary>;
  [data_prototype_key]?: object;
};

export function wrap_data<dictionary extends object, value, item = unknown>(
  dictionary: dictionary,
  value: value,
): WrappedData<dictionary, value, item> {
  const data_dictionary = dictionary as DataDictionary<dictionary>;
  let construct_data = data_dictionary[data_constructor_key];

  if (construct_data === undefined) {
    construct_data = create_data_constructor(dictionary, data_dictionary);
  }

  return construct_data<value, item>(value);
}

export function data_constructor<dictionary extends object>(
  dictionary: dictionary,
): <value, item = unknown>(
  value: value,
) => WrappedData<dictionary, value, item> {
  const data_dictionary = dictionary as DataDictionary<dictionary>;
  const existing = data_dictionary[data_constructor_key];

  if (existing !== undefined) {
    return existing;
  }

  return create_data_constructor(dictionary, data_dictionary);
}

function create_data_constructor<dictionary extends object>(
  dictionary: dictionary,
  data_dictionary: DataDictionary<dictionary>,
): DataConstructor<dictionary> {
  const prototype = data_prototype(dictionary);

  const construct_data = function construct_data<value, item = unknown>(
    value: value,
  ): WrappedData<dictionary, value, item> {
    const target = Object.create(
      prototype,
    ) as WrappedDataTarget<dictionary, value, item>;

    target[data_value] = value;

    return target as unknown as WrappedData<dictionary, value, item>;
  };

  Object.defineProperty(data_dictionary, data_constructor_key, {
    value: construct_data,
  });

  return construct_data;
}

export function is_data(
  value: unknown,
): value is WrappedData<object, unknown, unknown> {
  if (typeof value !== "object") {
    return false;
  }

  if (value === null) {
    return false;
  }

  return has_own.call(value, data_value);
}

function data_prototype(dictionary: object): object {
  const data_dictionary = dictionary as DataDictionary;
  const existing = data_dictionary[data_prototype_key];

  if (existing !== undefined) {
    return existing;
  }

  const prototype = Object.create(dictionary);

  Object.defineProperties(prototype, {
    value: {
      value: data_value_of,
    },
    run: {
      value: data_run,
    },
    [Symbol.iterator]: {
      value: data_iterator,
    },
  });

  Object.defineProperty(data_dictionary, data_prototype_key, {
    value: prototype,
  });

  return prototype;
}

function data_value_of<dictionary, value, item>(
  this: WrappedDataTarget<dictionary, value, item>,
): value {
  return this[data_value];
}

function data_run<dictionary, value, item>(
  this: WrappedDataTarget<dictionary, value, item>,
  ...args: unknown[]
): unknown {
  const value = this[data_value];

  if (typeof value !== "function") {
    throw new TypeError("Data value is not callable");
  }

  return Reflect.apply(value, undefined, args);
}

function* data_iterator<dictionary, value, item>(
  this: WrappedData<dictionary, value, item>,
): Generator<
  WrappedData<dictionary, value, item>,
  item,
  unknown
> {
  const item = yield this;
  return item as item;
}
