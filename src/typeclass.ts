export { is_data, match_tagged } from "./data_value.ts";
export type {
  TaggedMatchCases,
  TaggedValue,
  WrappedData,
} from "./data_value.ts";
import {
  cache_data_constructor as raw_cache_data_constructor,
  data_constructor as raw_as_data_cached,
  data_dictionary as raw_data_dictionary,
  mark_data_prototype as raw_mark_data_prototype,
  match_tagged,
  wrap_data as raw_as_data,
} from "./data_value.ts";
import type { TaggedMatchCases, WrappedData } from "./data_value.ts";

/** Runtime marker shared by a dictionary and each of its instances. */
export const kind = Symbol("Data.kind");
/** @ignore */
export const data_type = Symbol("Data.type");

/** Phantom property that selects the item carried by a data type. */
export declare const type_item: unique symbol;
/** Phantom property that resolves a data type after its item is selected. */
export declare const type_data: unique symbol;
/** Phantom property that distinguishes otherwise identical dictionaries. */
export declare const type_identity: unique symbol;

/** A higher-kinded data description with an item slot and resolved shape. */
export interface DataType {
  /** The item supplied when applying this data type. */
  readonly [type_item]: unknown;
  /** The raw value shape produced by this data type. */
  readonly [type_data]: unknown;
}

/** Resolve a data description for a particular item type. */
export type AppliedData<type extends DataType, item> =
  (type & { readonly [type_item]: item })[typeof type_data];

/** Resolve the raw value shape accepted by a dictionary. */
export type ContextData<dictionary extends Dictionary, item> = AppliedData<
  DictionaryDataType<dictionary>,
  item
>;

/** @ignore */
export type RawDictionaryDataType<dictionary extends Dictionary> =
  NonNullable<dictionary[typeof data_type]> extends DataType
    ? NonNullable<dictionary[typeof data_type]>
    : DataType;

/** Extract the higher-kinded data description carried by a dictionary. */
export type DictionaryDataType<dictionary extends Dictionary> =
  IdentifiedDataType<
    RawDictionaryDataType<dictionary>,
    dictionary[typeof type_identity]
  >;

/** A wrapped value with the operations supplied by its dictionary. */
export type Data<dictionary extends Dictionary, item> = WrappedData<
  dictionary,
  ContextData<dictionary, item>,
  item
>;

/** @ignore */
export type IdentifiedDataType<type extends DataType, identity> =
  & type
  & { readonly [type_identity]: identity };

/** The common type-level metadata carried by every data dictionary. */
export type Dictionary<
  type extends DataType = DataType,
  identity = unknown,
> = {
  /** Runtime identity used to associate instances with this dictionary. */
  [kind]: unknown;
  /** The higher-kinded raw value description for this dictionary. */
  readonly [data_type]?: type;
  /** A phantom identity that keeps separate dictionaries distinct. */
  readonly [type_identity]: identity;
};

/** A callable dictionary that wraps raw values of a data description. */
export interface As<type extends DataType, identity>
  extends Dictionary<type, identity> {
  /** Wrap a raw value and attach this dictionary's operations. */
  <item>(value: AppliedData<type, item>): WrappedData<
    this,
    AppliedData<type, item>,
    item
  >;
}

/** Wrap a value whose raw shape is described by a data dictionary. */
export function as_data<dictionary extends Dictionary, item>(
  dictionary: dictionary,
  value: ContextData<dictionary, item>,
): Data<dictionary, item>;
/** Wrap an arbitrary value with the members of an object dictionary. */
export function as_data<dictionary extends object, value, item = unknown>(
  dictionary: dictionary,
  value: value,
): WrappedData<dictionary, value, item>;
export function as_data<dictionary extends object, value, item = unknown>(
  dictionary: dictionary,
  value: value,
): WrappedData<dictionary, value, item> {
  return raw_as_data(dictionary, value);
}

/** Create a reusable wrapper for values described by a data dictionary. */
export function as_data_cached<dictionary extends Dictionary>(
  dictionary: dictionary,
): <item>(value: ContextData<dictionary, item>) => Data<dictionary, item>;
/** Create a reusable wrapper that attaches an object dictionary. */
export function as_data_cached<dictionary extends object>(
  dictionary: dictionary,
): <value, item = unknown>(
  value: value,
) => WrappedData<dictionary, value, item>;
export function as_data_cached<dictionary extends object>(
  dictionary: dictionary,
): <value, item = unknown>(
  value: value,
) => WrappedData<dictionary, value, item> {
  return raw_as_data_cached(dictionary);
}

/** A function that wraps raw values for one dictionary. */
export type DataWrapper<dictionary extends Dictionary> = <item>(
  value: ContextData<dictionary, item>,
) => Data<dictionary, item>;

/** The receiver available to custom data constructors. */
export type DataConstructorContext<dictionary extends Dictionary> = {
  /** Wrap a raw value without invoking the custom constructor again. */
  readonly data: DataWrapper<dictionary>;
};

/** A custom constructor used to build values for a dictionary. */
export type DataConstructor<dictionary extends Dictionary> = <item>(
  this: DataConstructorContext<dictionary>,
  value: ContextData<dictionary, item>,
) => Data<dictionary, item>;

/** Placeholder used to declare one payload position in a union variant. */
export const $slot = Symbol("Data.slot");

const union_definition = Symbol("Data.union");

/** The type of the union payload placeholder. */
export type Slot = typeof $slot;

/** @ignore */
export type UnionVariantShape = readonly [PropertyKey, ...readonly Slot[]];

/** @ignore */
export type UnionVariantsShape = readonly UnionVariantShape[];

const union_shape = Symbol("Data.union_shape");

/** @ignore */
export type UnionShapeFromVariants<variants extends UnionVariantsShape> = {
  readonly [variant in variants[number] as variant[0]]: variant;
};

/** @ignore */
export type UnionDefinition<shape extends object> = {
  readonly [union_definition]: UnionVariantsShape;
  readonly [union_shape]?: (shape: shape) => shape;
};

/** @ignore */
export type TaggedPayloadSlots<payload extends readonly unknown[]> =
  payload extends readonly [unknown, ...infer rest] ? readonly [
      Slot,
      ...TaggedPayloadSlots<rest>,
    ]
    : readonly [];

/** @ignore */
export type TaggedUnionVariant<
  dictionary extends Dictionary,
  tag extends TaggedTag<dictionary> = TaggedTag<dictionary>,
> = tag extends TaggedTag<dictionary> ? readonly [
    tag,
    ...TaggedPayloadSlots<
      TaggedPayload<ContextData<dictionary, unknown>, tag>
    >,
  ]
  : never;

/** @ignore */
export type TaggedUnionShape<dictionary extends Dictionary> = {
  readonly [tag in TaggedTag<dictionary>]: TaggedUnionVariant<
    dictionary,
    tag
  >;
};

/** A dictionary augmented with constructors and guards for every union tag. */
export type UnionDictionary<dictionary extends Dictionary> =
  & dictionary
  & TaggedDictionary<dictionary, TaggedTag<dictionary>>;

/** Declare the tags and payload slots of a tagged union dictionary. */
export function union<const variants extends UnionVariantsShape>(
  ...variants: variants
): UnionDefinition<UnionShapeFromVariants<variants>> {
  return {
    [union_definition]: variants,
  };
}

/** Create an empty callable dictionary. */
export function data<dictionary extends Dictionary>(): dictionary;
/** Create a tagged-union dictionary from a union declaration. */
export function data<dictionary extends Dictionary>(
  construct: UnionDefinition<TaggedUnionShape<dictionary>>,
): UnionDictionary<dictionary>;
/** Create a dictionary backed by a custom value constructor. */
export function data<dictionary extends Dictionary>(
  construct: DataConstructor<dictionary>,
): dictionary;
export function data<dictionary extends Dictionary>(
  construct?:
    | DataConstructor<dictionary>
    | UnionDefinition<
      TaggedUnionShape<dictionary>
    >,
): dictionary {
  const runtime_kind = Symbol("Data.dictionary") as dictionary[typeof kind];
  const construct_dictionary = construct;

  if (construct_dictionary === undefined) {
    const target = raw_data_dictionary<dictionary>();
    target[kind] = runtime_kind;

    return target;
  }

  if (is_union_definition(construct_dictionary)) {
    return tagged_data_from_union(construct_dictionary);
  }

  const target = function <item>(
    value: ContextData<dictionary, item>,
  ): Data<dictionary, item> {
    return construct_dictionary.call(context, value) as Data<dictionary, item>;
  } as unknown as dictionary;

  target[kind] = runtime_kind;
  const wrap_data = as_data_cached(target);
  const context: DataConstructorContext<dictionary> = {
    data<item>(value: ContextData<dictionary, item>) {
      return wrap_data(value);
    },
  };

  return target;
}

type TaggedData = readonly [PropertyKey, ...readonly unknown[]];

const tagged_data_constructor_cache = Symbol("Data.tagged_constructors");
const tagged_data_singleton_cache = Symbol("Data.tagged_singletons");
const tagged_data_singleton_tags = Symbol("Data.tagged_singleton_tags");

type TaggedDataDictionary<dictionary extends object> = object & {
  [tagged_data_constructor_cache]?: Map<
    PropertyKey,
    TaggedVariantFactory<dictionary>
  >;
  [tagged_data_singleton_cache]?: Map<
    PropertyKey,
    WrappedData<dictionary, TaggedData, unknown>
  >;
  [tagged_data_singleton_tags]?: Set<PropertyKey>;
};

type TaggedVariantFactory<dictionary extends object> = {
  readonly empty: () => WrappedData<dictionary, TaggedData, unknown>;
  readonly many: (
    payloads: readonly unknown[],
  ) => WrappedData<dictionary, TaggedData, unknown>;
  readonly one: (
    payload: unknown,
  ) => WrappedData<dictionary, TaggedData, unknown>;
  readonly two: (
    first: unknown,
    second: unknown,
  ) => WrappedData<dictionary, TaggedData, unknown>;
  readonly from_value: (
    value: TaggedData,
  ) => WrappedData<dictionary, TaggedData, unknown>;
};

type TaggedOnePayload = {
  payload: unknown;
};

type TaggedManyPayload = {
  payload: readonly unknown[];
};

type TaggedTwoPayload = {
  first: unknown;
  second: unknown;
};

/** @ignore */
export type TaggedConstructorName<tag extends PropertyKey> = tag extends string
  ? Capitalize<tag>
  : tag;

/** @ignore */
export type TaggedTag<dictionary extends Dictionary> = ContextData<
  dictionary,
  unknown
> extends readonly [
  infer tag extends PropertyKey,
  ...readonly unknown[],
] ? tag
  : never;

/** @ignore */
export type TaggedPayload<value, tag extends PropertyKey> = value extends
  readonly [
    infer current extends PropertyKey,
    ...infer payload,
  ] ? current extends tag ? payload
  : never
  : never;

type TaggedVariants<dictionary extends Dictionary> = {
  readonly [tag in TaggedTag<dictionary>]: number;
};

type TaggedDataOptions<dictionary extends Dictionary> = {
  readonly variants?: TaggedVariants<dictionary>;
};

/** @ignore */
export type TaggedMember<
  dictionary extends Dictionary,
  tag extends PropertyKey,
  item,
> = ContextData<dictionary, item> extends infer value ? value extends readonly [
    tag,
    ...readonly unknown[],
  ] ? value
  : never
  : never;

/** @ignore */
export type TaggedGuard<
  dictionary extends Dictionary,
  tag extends PropertyKey,
> = {
  <item>(
    value: ContextData<dictionary, item>,
  ): value is TaggedMember<dictionary, tag, item>;
  (value: unknown): value is TaggedMember<dictionary, tag, unknown>;
};

/** @ignore */
export type TaggedVariant<
  dictionary extends Dictionary,
  tag extends PropertyKey,
> =
  & (TaggedPayload<ContextData<dictionary, never>, tag> extends []
    ? <item = never>() => Data<dictionary, item>
    : <item = unknown>(
      ...payloads: TaggedPayload<ContextData<dictionary, item>, tag>
    ) => Data<dictionary, item>)
  & {
    readonly is: TaggedGuard<dictionary, tag>;
  };

/** @ignore */
export type TaggedDictionary<
  dictionary extends Dictionary,
  tags extends PropertyKey,
> = {
  readonly [tag in tags as TaggedConstructorName<tag>]: TaggedVariant<
    dictionary,
    tag
  >;
};

function tagged_data<dictionary extends Dictionary>(
  options: TaggedDataOptions<dictionary> = {},
): dictionary {
  const runtime_kind = Symbol("Data.dictionary") as dictionary[typeof kind];
  const variants = options.variants;
  const singleton_tags = tagged_singleton_tags(variants);

  const target = function <item>(
    value: ContextData<dictionary, item>,
  ): Data<dictionary, item> {
    const tagged = value as TaggedData;
    const tag = tagged[0];

    if (tagged.length === 1 && singleton_tags.has(tag)) {
      let singleton = singletons.get(tag);

      if (singleton === undefined) {
        singleton = construct_tagged(tagged);
        singletons.set(tag, singleton);
      }

      return singleton as Data<dictionary, item>;
    }

    return construct_tagged(tagged) as Data<dictionary, item>;
  } as unknown as dictionary;

  target[kind] = runtime_kind;

  const tagged_dictionary = target as TaggedDataDictionary<dictionary>;
  const constructors = new Map<
    PropertyKey,
    TaggedVariantFactory<
      dictionary
    >
  >();
  const singletons = new Map<
    PropertyKey,
    WrappedData<
      dictionary,
      TaggedData,
      unknown
    >
  >();

  tagged_dictionary[tagged_data_constructor_cache] = constructors;
  tagged_dictionary[tagged_data_singleton_cache] = singletons;
  tagged_dictionary[tagged_data_singleton_tags] = singleton_tags;
  raw_cache_data_constructor(
    target,
    target as unknown as <value, item = unknown>(
      value: value,
    ) => WrappedData<dictionary, value, item>,
  );
  install_tagged_variants(target, variants);

  return target;

  function construct_tagged(
    value: TaggedData,
  ): WrappedData<dictionary, TaggedData, unknown> {
    const tag = value[0];
    const construct_variant = tagged_variant_factory(target, tag);

    return construct_variant.from_value(value);
  }
}

function is_union_definition<dictionary extends Dictionary>(
  value:
    | DataConstructor<dictionary>
    | UnionDefinition<
      TaggedUnionShape<
        dictionary
      >
    >,
): value is UnionDefinition<TaggedUnionShape<dictionary>> {
  if (typeof value !== "object") {
    return false;
  }

  if (value === null) {
    return false;
  }

  return union_definition in value;
}

function tagged_data_from_union<dictionary extends Dictionary>(
  definition: UnionDefinition<TaggedUnionShape<dictionary>>,
): UnionDictionary<dictionary> {
  return tagged_data<dictionary>({
    variants: tagged_variants_from_union(definition[union_definition]),
  }) as UnionDictionary<dictionary>;
}

function tagged_variants_from_union<dictionary extends Dictionary>(
  shape: UnionVariantsShape,
): TaggedVariants<dictionary> {
  const variants = {} as Record<PropertyKey, number>;

  for (const variant of shape) {
    const tag = variant[0];
    variants[tag] = variant.length;
  }

  return variants as TaggedVariants<dictionary>;
}

function tagged_variant<
  dictionary extends Dictionary,
  const tag extends PropertyKey,
>(
  dictionary: dictionary,
  tag: tag,
  expected_length: number,
): TaggedVariant<dictionary, tag> {
  const factory = tagged_variant_factory(dictionary, tag);
  const tagged_dictionary = dictionary as TaggedDataDictionary<dictionary>;
  const singleton_tags = tagged_dictionary[tagged_data_singleton_tags];
  const singletons = tagged_dictionary[tagged_data_singleton_cache];
  const is_singleton = singleton_tags !== undefined && singleton_tags.has(tag);
  let singleton = singletons?.get(tag);

  const construct = function construct_tagged_variant<item = unknown>(): Data<
    dictionary,
    item
  > {
    switch (arguments.length) {
      case 0:
        if (!is_singleton) {
          return factory.empty() as Data<dictionary, item>;
        }

        if (singleton === undefined) {
          singleton = singletons?.get(tag);

          if (singleton === undefined) {
            singleton = factory.empty();
            singletons?.set(tag, singleton);
          }
        }

        return singleton as Data<dictionary, item>;
      case 1:
        return factory.one(arguments[0]) as Data<dictionary, item>;
      case 2:
        return factory.two(arguments[0], arguments[1]) as Data<
          dictionary,
          item
        >;
      default:
        return factory.many(payloads_from_arguments(arguments)) as Data<
          dictionary,
          item
        >;
    }
  } as TaggedVariant<dictionary, tag>;

  Object.defineProperty(construct, "is", {
    value: tagged_guard(tag, expected_length),
  });

  return construct;
}

function tagged_singleton_tags<dictionary extends Dictionary>(
  variants: TaggedVariants<dictionary> | undefined,
): Set<PropertyKey> {
  const singletons = new Set<PropertyKey>();

  if (variants === undefined) {
    return singletons;
  }

  for (const tag of Reflect.ownKeys(variants)) {
    if (Reflect.get(variants, tag) === 1) {
      singletons.add(tag);
    }
  }

  return singletons;
}

function install_tagged_variants<dictionary extends Dictionary>(
  dictionary: dictionary,
  variants: TaggedVariants<dictionary> | undefined,
): void {
  if (variants === undefined) {
    return;
  }

  for (const tag of Reflect.ownKeys(variants)) {
    Object.defineProperty(dictionary, tagged_constructor_name(tag), {
      value: tagged_variant(dictionary, tag, Reflect.get(variants, tag)),
    });
  }
}

function tagged_constructor_name(tag: PropertyKey): PropertyKey {
  if (typeof tag !== "string") {
    return tag;
  }

  const [first = "", ...rest] = tag;

  return first.toUpperCase() + rest.join("");
}

function tagged_guard(
  tag: PropertyKey,
  expected_length: number,
): (value: unknown) => boolean {
  return function is_tagged(value: unknown): boolean {
    if (!Array.isArray(value)) {
      return false;
    }

    return value.length === expected_length && value[0] === tag;
  };
}

function payloads_from_arguments(args: IArguments): unknown[] {
  const payloads = new Array<unknown>(args.length);

  for (let index = 0; index < args.length; index += 1) {
    payloads[index] = args[index];
  }

  return payloads;
}

function tagged_variant_factory<dictionary extends object>(
  dictionary: dictionary,
  tag: PropertyKey,
): TaggedVariantFactory<dictionary> {
  const tagged_dictionary = dictionary as TaggedDataDictionary<dictionary>;
  const constructors = tagged_dictionary[tagged_data_constructor_cache];

  if (constructors === undefined) {
    throw new TypeError("Expected a tagged data dictionary");
  }

  let factory = constructors.get(tag);

  if (factory === undefined) {
    factory = create_tagged_variant_factory(dictionary, tag);
    constructors.set(tag, factory);
  }

  return factory;
}

function create_tagged_variant_factory<dictionary extends object>(
  dictionary: dictionary,
  tag: PropertyKey,
): TaggedVariantFactory<dictionary> {
  const empty_value = [tag] as TaggedData;
  const empty_prototype = tagged_data_prototype(
    dictionary,
    function value(): TaggedData {
      return empty_value;
    },
  );
  const one_prototype = tagged_data_prototype(
    dictionary,
    function value(this: TaggedOnePayload): TaggedData {
      return [tag, this.payload];
    },
  );
  const many_prototype = tagged_data_prototype(
    dictionary,
    function value(this: TaggedManyPayload): TaggedData {
      return [tag, ...this.payload];
    },
  );
  const two_prototype = tagged_data_prototype(
    dictionary,
    function value(this: TaggedTwoPayload): TaggedData {
      return [tag, this.first, this.second];
    },
  );

  function TaggedOne(this: TaggedOnePayload, payload: unknown) {
    this.payload = payload;
  }

  function TaggedMany(
    this: TaggedManyPayload,
    payload: readonly unknown[],
  ) {
    this.payload = payload;
  }

  function TaggedTwo(
    this: TaggedTwoPayload,
    first: unknown,
    second: unknown,
  ) {
    this.first = first;
    this.second = second;
  }

  TaggedOne.prototype = one_prototype;
  TaggedMany.prototype = many_prototype;
  TaggedTwo.prototype = two_prototype;

  return {
    empty() {
      return construct_empty();
    },

    many(payloads) {
      return construct_many(payloads);
    },

    one(payload) {
      return construct_one(payload);
    },

    two(first, second) {
      return construct_two(first, second);
    },

    from_value(value) {
      switch (value.length) {
        case 1:
          return this.empty();
        case 2:
          return this.one(value[1]);
        case 3:
          return this.two(value[1], value[2]);
        default:
          return this.many(value.slice(1));
      }
    },
  };

  function construct_empty(): WrappedData<dictionary, TaggedData, unknown> {
    return Object.create(empty_prototype) as WrappedData<
      dictionary,
      TaggedData,
      unknown
    >;
  }

  function construct_one(
    payload: unknown,
  ): WrappedData<dictionary, TaggedData, unknown> {
    return new (TaggedOne as unknown as {
      new (payload: unknown): WrappedData<
        dictionary,
        TaggedData,
        unknown
      >;
    })(payload);
  }

  function construct_many(
    payloads: readonly unknown[],
  ): WrappedData<dictionary, TaggedData, unknown> {
    return new (TaggedMany as unknown as {
      new (payload: readonly unknown[]): WrappedData<
        dictionary,
        TaggedData,
        unknown
      >;
    })(payloads);
  }

  function construct_two(
    first: unknown,
    second: unknown,
  ): WrappedData<dictionary, TaggedData, unknown> {
    return new (TaggedTwo as unknown as {
      new (
        first: unknown,
        second: unknown,
      ): WrappedData<
        dictionary,
        TaggedData,
        unknown
      >;
    })(first, second);
  }
}

function tagged_data_prototype<
  dictionary extends object,
  receiver extends object,
>(
  dictionary: dictionary,
  value: (this: receiver) => TaggedData,
): object {
  const prototype = Object.create(dictionary);

  Object.defineProperties(prototype, {
    value: {
      value,
    },
    run: {
      value: tagged_data_run,
    },
    match: {
      value: tagged_data_match,
    },
    [Symbol.iterator]: {
      value: tagged_data_iterator,
    },
  });
  raw_mark_data_prototype(prototype);

  return prototype;
}

function tagged_data_match(
  this: { value(): TaggedData },
  cases: TaggedMatchCases<TaggedData, unknown>,
): unknown {
  return match_tagged(this.value(), cases);
}

function tagged_data_run(this: { value(): unknown }, ...args: unknown[]) {
  const value = this.value();

  if (typeof value !== "function") {
    throw new TypeError("Data value is not callable");
  }

  return Reflect.apply(value, undefined, args);
}

function* tagged_data_iterator<dictionary, value, item>(
  this: WrappedData<dictionary, value, item>,
): Generator<
  WrappedData<dictionary, value, item>,
  item,
  unknown
> {
  const item = yield this;
  return item as item;
}

/** A data dictionary extended with one installed typeclass instance. */
export type TypeclassDictionary<
  dictionary extends Dictionary,
  token extends PropertyKey,
  methods extends object,
> =
  & {
    /** The runtime identity inherited from the data dictionary. */
    [kind]: dictionary[typeof kind];
    /** The higher-kinded raw value description inherited by the instance. */
    readonly [data_type]?: RawDictionaryDataType<dictionary>;
    /** The phantom identity inherited from the data dictionary. */
    readonly [type_identity]: dictionary[typeof type_identity];
  }
  & { [key in token]: methods }
  & methods;

/** Invoke a typeclass method with an explicit dictionary receiver. */
export function call_typeclass_method<self, args extends unknown[], result>(
  method: (this: self, ...args: args) => result,
  self: self,
  ...args: args
): result {
  return method.call(self, ...args);
}

/** Attach a typeclass implementation to a data dictionary. */
export function install_instance<implementation extends object>(
  dictionary: object,
  token: PropertyKey,
  implementation: implementation,
): implementation {
  Object.assign(dictionary, implementation);
  (dictionary as { [key: PropertyKey]: unknown })[token] = implementation;

  return implementation;
}

type TypeclassInstance<
  token extends PropertyKey,
  dictionary extends { [key in token]: object },
> = dictionary[token];

/** A typeclass token with operations for installing and retrieving instances. */
export type TypeclassDefinition<token extends PropertyKey = PropertyKey> =
  & TypeclassDefinitionPrototype<token>
  & {
    /** The property key under which an instance is installed. */
    readonly token: token;
  };

/** A typeclass definition combined with its reusable derived methods. */
export type Typeclass<
  token extends PropertyKey,
  methods extends object,
> = TypeclassDefinition<token> & methods;

/** @ignore */
export type TypeclassDefinitionPrototype<
  token extends PropertyKey = PropertyKey,
> = {
  instance<
    dictionary extends Dictionary & { [key in token]: object },
  >(
    this: TypeclassDefinition<token>,
    dictionary: dictionary,
  ): (
    implementation: TypeclassInstance<token, dictionary>,
  ) => TypeclassInstance<token, dictionary>;

  instance_for<
    receiver extends { [key in token]: object },
  >(
    this: TypeclassDefinition<token>,
    receiver: receiver,
  ): TypeclassInstance<token, receiver>;
};

/** @ignore */
export type TypeclassMethods<
  token extends PropertyKey,
  methods extends object,
> =
  & methods
  & ThisType<TypeclassDefinition<token> & methods>;

/** Create a typeclass definition with optional derived methods. */
export function typeclass<token extends PropertyKey, methods extends object>(
  token: token,
  methods: TypeclassMethods<token, methods>,
): TypeclassDefinition<token> & methods {
  const definition = Object.assign(
    Object.create(TypeclassDefinition) as TypeclassDefinition<token> & methods,
    methods,
  );

  Object.defineProperty(definition, "token", {
    enumerable: true,
    value: token,
  });

  return definition;
}

type TypeclassDefinitionReceiver<token extends PropertyKey = PropertyKey> = {
  readonly token: token;
};

/** Shared implementation used by every typeclass definition. */
export const TypeclassDefinition: TypeclassDefinitionPrototype = {
  instance: install_typeclass_instance,

  instance_for<
    token extends PropertyKey,
    receiver extends { [key in token]: object },
  >(
    this: TypeclassDefinitionReceiver<token>,
    receiver: receiver,
  ): TypeclassInstance<token, receiver> {
    return receiver[this.token];
  },
};

function install_typeclass_instance<
  token extends PropertyKey,
  dictionary extends Dictionary & { [key in token]: object },
>(
  this: TypeclassDefinitionReceiver<token>,
  dictionary: dictionary,
): (
  implementation: TypeclassInstance<token, dictionary>,
) => TypeclassInstance<token, dictionary> {
  const token = this.token;

  return (implementation) => {
    return install_instance(
      dictionary,
      token,
      implementation,
    ) as TypeclassInstance<token, dictionary>;
  };
}
