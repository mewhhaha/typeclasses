import type { Matchable } from "./data_value.ts";
export type { dictionary_type, Matchable, Runnable } from "./data_value.ts";
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
  define_data_interop as raw_define_data_interop,
  detach_function_prototype as raw_detach_function_prototype,
  is_data as raw_is_data,
  mark_data_prototype as raw_mark_data_prototype,
  wrap_data as raw_as_data,
  yield_data as raw_yield_data,
} from "./data_value.ts";
import type { TaggedMatchCases, WrappedData } from "./data_value.ts";

/** Runtime marker shared by a dictionary and each of its instances. */
export const kind = Symbol("Data.kind");
/** @ignore */
export const data_type = Symbol("Data.type");

/** Phantom property that selects the item carried by a data type. */
export declare const type_item: unique symbol;
/** Phantom property for contexts whose elements have a fixed type. */
export declare const type_element: unique symbol;
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
  RawDictionaryDataType<dictionary>,
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
  DataItem<dictionary, item>
>;

/** Recover the owning dictionary without constructing or unwrapping a value. */
export function dictionary_of<dictionary extends Dictionary>(
  value: Data<dictionary, unknown>,
): dictionary {
  if (!raw_is_data(value)) throw new TypeError("Expected a wrapped data value");
  let prototype = Object.getPrototypeOf(value);
  while (prototype !== null) {
    if (Object.hasOwn(prototype, kind)) return prototype as dictionary;
    prototype = Object.getPrototypeOf(prototype);
  }
  throw new TypeError("Wrapped value has no dictionary");
}

/** Resolve the element exposed by a context, including fixed-element contexts. */
export type DataItem<dictionary extends Dictionary, item> = dictionary extends
  { readonly [type_element]: infer element } ? element
  : item;

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
  extends Dictionary<type, identity>, DataType {
  /** Resolve the raw shape without traversing this dictionary's capabilities. */
  readonly [type_data]: AppliedData<type, this[typeof type_item]>;
  /** Wrap a raw value and attach this dictionary's operations. */
  <item extends DataItem<this, unknown> = DataItem<this, unknown>>(
    value: AppliedData<type, item>,
  ): WrappedData<
    this,
    AppliedData<type, item>,
    DataItem<this, item>
  >;
}

/** Wrap a value whose raw shape is described by a data dictionary. */
export function as_data<
  dictionary extends Dictionary,
  item extends DataItem<dictionary, unknown> = DataItem<dictionary, unknown>,
>(
  dictionary: dictionary,
  value: ContextData<dictionary, item>,
): Data<dictionary, item>;
/** Wrap an arbitrary value with the members of an object dictionary. */
export function as_data<dictionary extends object, value, item = unknown>(
  dictionary: dictionary & { readonly [type_identity]?: never },
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
): <item extends DataItem<dictionary, unknown> = DataItem<dictionary, unknown>>(
  value: ContextData<dictionary, item>,
) => Data<dictionary, item>;
/** Create a reusable wrapper that attaches an object dictionary. */
export function as_data_cached<dictionary extends object>(
  dictionary: dictionary & { readonly [type_identity]?: never },
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
export type DataWrapper<dictionary extends Dictionary> = <
  item extends DataItem<dictionary, unknown> = DataItem<dictionary, unknown>,
>(
  value: ContextData<dictionary, item>,
) => Data<dictionary, item>;

/** The receiver available to custom data constructors. */
export type DataConstructorContext<dictionary extends Dictionary> = {
  /** Wrap a raw value without invoking the custom constructor again. */
  readonly data: DataWrapper<dictionary>;
};

/** A custom constructor used to build values for a dictionary. */
export type DataConstructor<dictionary extends Dictionary> = <
  item extends DataItem<dictionary, unknown> = DataItem<dictionary, unknown>,
>(
  this: DataConstructorContext<dictionary>,
  value: ContextData<dictionary, item>,
) => Data<dictionary, item>;

/** Placeholder used to declare one payload position in a union variant. */
export const $slot = Symbol("Data.slot");

const union_definition = Symbol("Data.union");

/** The type of the union payload placeholder. */
export type Slot = typeof $slot;

/** @ignore */
export declare const field_type: unique symbol;

/** A fixed payload type in a declarative union. Use $slot for its generic item. */
export type Field<value> = { readonly [field_type]: value };

/** Describe a fixed payload without allocating a value of that type. */
export function field<value>(): Field<value> {
  return $slot as unknown as Field<value>;
}

/** A declaration describing the tag and payload positions of a union. */
export type UnionSchema =
  readonly (readonly [PropertyKey, ...(Slot | Field<unknown>)[]])[];

/** @ignore */
export type SchemaPayload<payload extends readonly unknown[], item> = {
  readonly [index in keyof payload]: payload[index] extends Slot ? item
    : payload[index] extends Field<infer value> ? value
    : never;
};

/** Resolve a declarative union at its generic item type. */
export type UnionValue<schema extends UnionSchema, item> =
  schema[number] extends infer variant
    ? variant extends readonly [infer tag extends PropertyKey, ...infer payload]
      ? readonly [tag, ...SchemaPayload<payload, item>]
    : never
    : never;

/** @ignore */
export interface AsUnionLambda<schema extends UnionSchema> {
  readonly [type_item]: unknown;
  readonly [type_data]: UnionValue<schema, this[typeof type_item]>;
}

/** Dictionary inferred from a union declaration. */
export interface AsUnion<schema extends UnionSchema, identity>
  extends As<AsUnionLambda<schema>, identity>, Matchable {
}

/** @ignore */
export type IsUnion<value, whole = value> = value extends unknown
  ? [whole] extends [value] ? false : true
  : never;
/** @ignore */
export type UniqueSymbol<identity extends symbol> = symbol extends identity
  ? never
  : true extends IsUnion<identity> ? never
  : identity;

/** Define typed constructors from one schema and an explicit identity token. */
export function define_union<
  const identity extends symbol,
  const schema extends UnionSchema,
>(
  identity: identity & UniqueSymbol<identity>,
  ...variants: schema
): UnionDictionary<AsUnion<schema, identity>> {
  const dictionary = tagged_data_from_union<AsUnion<schema, identity>>(
    union(
      ...variants as unknown as UnionVariantsShape,
    ) as unknown as UnionDefinition<
      TaggedUnionShape<AsUnion<schema, identity>>
    >,
  );
  dictionary[kind] = identity;
  return dictionary;
}

/** A flat record or tuple description with generic and fixed payload slots. */
export type DataSchema =
  | Readonly<Record<string, Slot | Field<unknown>>>
  | readonly (Slot | Field<unknown>)[];

/** Resolve a data schema at its generic item type. */
export type SchemaValue<schema extends DataSchema, item> = {
  readonly [key in keyof schema]: schema[key] extends Slot ? item
    : schema[key] extends Field<infer value> ? value
    : never;
};

/** @ignore */
export interface AsSchemaLambda<schema extends DataSchema> {
  readonly [type_item]: unknown;
  readonly [type_data]: SchemaValue<schema, this[typeof type_item]>;
}

/** Dictionary inferred from a flat record or tuple schema. */
export interface AsSchema<schema extends DataSchema, identity>
  extends As<AsSchemaLambda<schema>, identity> {
}

/** Define a callable data dictionary from one record or tuple schema. */
export function define_data<
  const identity extends symbol,
  const schema extends DataSchema,
>(
  identity: identity & UniqueSymbol<identity>,
  _schema: schema,
): AsSchema<schema, identity> {
  return data<AsSchema<schema, identity>>(identity);
}

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

/** Create a dictionary using the same identity token as its static description. */
export function data<dictionary extends Dictionary>(
  identity: dictionary[typeof type_identity] & symbol,
): dictionary;
/** Create a tagged dictionary with an explicit identity token. */
export function data<dictionary extends Dictionary>(
  identity: dictionary[typeof type_identity] & symbol,
  construct: UnionDefinition<TaggedUnionShape<dictionary>>,
): UnionDictionary<dictionary>;
/** Create a custom dictionary with an explicit identity token. */
export function data<dictionary extends Dictionary>(
  identity: dictionary[typeof type_identity] & symbol,
  construct: DataConstructor<dictionary>,
): dictionary;
export function data<dictionary extends Dictionary>(
  identity: dictionary[typeof type_identity] & symbol,
  construct_dictionary?:
    | DataConstructor<dictionary>
    | UnionDefinition<TaggedUnionShape<dictionary>>,
): dictionary {
  if (typeof identity !== "symbol") {
    throw new TypeError("A dictionary requires its declared identity symbol");
  }
  const runtime_kind = identity;

  if (construct_dictionary === undefined) {
    const target = raw_data_dictionary<dictionary>();
    target[kind] = runtime_kind;

    return target;
  }

  if (is_union_definition(construct_dictionary)) {
    const target = tagged_data_from_union(construct_dictionary);
    target[kind] = runtime_kind;
    return target;
  }

  const target = function <item>(
    value: ContextData<dictionary, item>,
  ): Data<dictionary, item> {
    return construct_dictionary.call(context, value) as Data<dictionary, item>;
  } as unknown as dictionary;

  raw_detach_function_prototype(target);
  target[kind] = runtime_kind;
  const wrap_data = as_data_cached(target);
  const context: DataConstructorContext<dictionary> = {
    data<item extends DataItem<dictionary, unknown>>(
      value: ContextData<dictionary, item>,
    ) {
      return wrap_data<item>(value);
    },
  };

  return target;
}

type TaggedData = readonly [PropertyKey, ...readonly unknown[]];

const tagged_data_constructor_cache = Symbol("Data.tagged_constructors");
const tagged_data_singleton_cache = Symbol("Data.tagged_singletons");
const tagged_data_singleton_tags = Symbol("Data.tagged_singleton_tags");
const tagged_payload = Symbol("Data.tagged_payload");
const tagged_first_payload = Symbol("Data.tagged_first_payload");
const tagged_second_payload = Symbol("Data.tagged_second_payload");
const instance_method_owners = Symbol("Data.instance_method_owners");
const same_dictionary_methods = new Set<PropertyKey>([
  "alt",
  "ap",
  "compare",
  "compose",
  "concat",
  "eq",
]);
const runtime_kind_ids = new WeakMap<WeakKey, number>();
let next_runtime_kind_id = 0;

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
  [tagged_payload]: unknown;
};

type TaggedManyPayload = {
  [tagged_payload]: readonly unknown[];
};

type TaggedTwoPayload = {
  [tagged_first_payload]: unknown;
  [tagged_second_payload]: unknown;
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

type TaggedVariants = ReadonlyMap<PropertyKey, number>;

type TaggedDataOptions<dictionary extends Dictionary> = {
  readonly variants?: TaggedVariants;
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
  <item>(value: Data<dictionary, item>): value is {
    value(): TaggedMember<dictionary, tag, item>;
  } & Data<dictionary, item>;
  <item>(
    value: ContextData<dictionary, item>,
  ): value is TaggedMember<dictionary, tag, item>;
  (
    value: unknown,
  ): value is
    | TaggedMember<dictionary, tag, unknown>
    | (
      & { value(): TaggedMember<dictionary, tag, unknown> }
      & Data<dictionary, unknown>
    );
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
    const tagged = parse_tagged_value(value, variants);
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

  raw_detach_function_prototype(target);
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

function parse_tagged_value<dictionary extends Dictionary>(
  value: ContextData<dictionary, unknown>,
  variants: TaggedVariants | undefined,
): TaggedData {
  if (!Array.isArray(value)) {
    throw new TypeError(
      `Tagged data must be an array; received ${describe_runtime_value(value)}`,
    );
  }

  const tagged = value as unknown as TaggedData;

  if (variants === undefined) {
    return tagged;
  }

  const tag = tagged[0];

  const expected_length = variants.get(tag);

  if (expected_length === undefined) {
    throw new TypeError(`Unknown tagged data variant ${String(tag)}`);
  }

  if (tagged.length !== expected_length) {
    throw new TypeError(
      `Tagged data variant ${String(tag)} expects ${
        expected_length - 1
      } payload value(s); received ${tagged.length - 1}`,
    );
  }

  return tagged;
}

function describe_runtime_value(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
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

function tagged_variants_from_union(
  shape: UnionVariantsShape,
): TaggedVariants {
  const variants = new Map<PropertyKey, number>();

  for (const variant of shape) {
    const tag = variant[0];
    if (variants.has(tag)) {
      throw new TypeError("Duplicate union tag " + String(tag));
    }
    variants.set(tag, variant.length);
  }

  return variants;
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
    value: tagged_guard(dictionary, tag, expected_length),
  });

  return construct;
}

function tagged_singleton_tags(
  variants: TaggedVariants | undefined,
): Set<PropertyKey> {
  const singletons = new Set<PropertyKey>();

  if (variants === undefined) {
    return singletons;
  }

  for (const [tag, length] of variants) {
    if (length === 1) {
      singletons.add(tag);
    }
  }

  return singletons;
}

function install_tagged_variants<dictionary extends Dictionary>(
  dictionary: dictionary,
  variants: TaggedVariants | undefined,
): void {
  if (variants === undefined) {
    return;
  }

  for (const [tag, length] of variants) {
    const name = tagged_constructor_name(tag);
    if (name in dictionary || name === "__proto__") {
      throw new TypeError(
        "Union constructor conflicts with property " + String(name),
      );
    }
    Object.defineProperty(dictionary, name, {
      configurable: true,
      value: tagged_variant(dictionary, tag, length),
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
  dictionary: Dictionary,
  tag: PropertyKey,
  expected_length: number,
): (value: unknown) => boolean {
  return function is_tagged(value: unknown): boolean {
    if (!Array.isArray(value)) {
      if (!raw_is_data(value)) return false;
      if ((value as unknown as Dictionary)[kind] !== dictionary[kind]) {
        return false;
      }
      value = value.value();
      if (!Array.isArray(value)) return false;
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
    function match(cases) {
      return tagged_handler(cases, tag)();
    },
  );
  const one_prototype = tagged_data_prototype(
    dictionary,
    function value(this: TaggedOnePayload): TaggedData {
      return [tag, this[tagged_payload]];
    },
    function match(this: TaggedOnePayload, cases) {
      return tagged_handler(cases, tag)(this[tagged_payload]);
    },
  );
  const many_prototype = tagged_data_prototype(
    dictionary,
    function value(this: TaggedManyPayload): TaggedData {
      return [tag, ...this[tagged_payload]];
    },
    function match(this: TaggedManyPayload, cases) {
      return tagged_handler(cases, tag)(...this[tagged_payload]);
    },
  );
  const two_prototype = tagged_data_prototype(
    dictionary,
    function value(this: TaggedTwoPayload): TaggedData {
      return [tag, this[tagged_first_payload], this[tagged_second_payload]];
    },
    function match(this: TaggedTwoPayload, cases) {
      return tagged_handler(cases, tag)(
        this[tagged_first_payload],
        this[tagged_second_payload],
      );
    },
  );

  function TaggedOne(this: TaggedOnePayload, payload: unknown) {
    this[tagged_payload] = payload;
  }

  function TaggedMany(
    this: TaggedManyPayload,
    payload: readonly unknown[],
  ) {
    this[tagged_payload] = payload;
  }

  function TaggedTwo(
    this: TaggedTwoPayload,
    first: unknown,
    second: unknown,
  ) {
    this[tagged_first_payload] = first;
    this[tagged_second_payload] = second;
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
  match: (
    this: receiver,
    cases: TaggedMatchCases<TaggedData, unknown>,
  ) => unknown,
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
      value: match,
    },
    [Symbol.iterator]: {
      value: tagged_data_iterator,
    },
  });
  raw_define_data_interop(prototype);
  raw_mark_data_prototype(prototype);

  return prototype;
}

function tagged_handler(
  cases: TaggedMatchCases<TaggedData, unknown>,
  tag: PropertyKey,
): (...payload: unknown[]) => unknown {
  const handler = cases[tag];
  if (handler === undefined) {
    throw new TypeError("No match handler for tag " + String(tag));
  }
  return handler as (...payload: unknown[]) => unknown;
}

function tagged_data_run(this: { value(): unknown }, ...args: unknown[]) {
  const value = this.value();

  if (typeof value !== "function") {
    throw new TypeError("Data value is not callable");
  }

  return Reflect.apply(value, undefined, args);
}

function tagged_data_iterator<dictionary, value, item>(
  this: WrappedData<dictionary, value, item>,
): Generator<
  WrappedData<dictionary, value, item>,
  item,
  unknown
> {
  return raw_yield_data(this);
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
  const target = dictionary as {
    [instance_method_owners]?: Map<PropertyKey, PropertyKey>;
    [key: PropertyKey]: unknown;
  };
  let owners = target[instance_method_owners];

  if (owners === undefined) {
    owners = new Map();
    Object.defineProperty(target, instance_method_owners, { value: owners });
  }

  const installed = Object.create(Object.getPrototypeOf(implementation));
  const methods = Reflect.ownKeys(implementation);
  const extensible = Object.isExtensible(target);

  for (const method of methods) {
    const descriptor = Object.getOwnPropertyDescriptor(implementation, method)!;
    const owner = owners.get(method);
    const existing = target[method];

    if (
      owner !== undefined && owner !== token && existing !== descriptor.value
    ) {
      throw new TypeError(
        `Cannot install ${describe_property_key(token)} method ${
          describe_property_key(method)
        }; it is already owned by ${describe_property_key(owner)}`,
      );
    }

    if (
      owner === undefined && method in target && existing !== descriptor.value
    ) {
      throw new TypeError(
        `Cannot install ${describe_property_key(token)} method ${
          describe_property_key(method)
        }; the dictionary already defines that property`,
      );
    }

    if (descriptor.enumerable && (!extensible || method in target)) {
      assert_property_assignable(target, method);
    }

    if (
      "value" in descriptor && typeof descriptor.value === "function" &&
      same_dictionary_methods.has(method)
    ) {
      descriptor.value = same_dictionary_method(
        descriptor.value as (...args: unknown[]) => unknown,
        method,
      );
    }

    Object.defineProperty(installed, method, descriptor);
  }

  if (!extensible || token in target) assert_property_assignable(target, token);
  Object.assign(target, installed);
  target[token] = installed;

  for (const method of methods) {
    owners.set(method, token);
  }

  return installed as implementation;
}

function assert_property_assignable(target: object, key: PropertyKey): void {
  if (!Object.hasOwn(target, key) && !Object.isExtensible(target)) {
    throw new TypeError(
      `Cannot install ${
        describe_property_key(key)
      } on a non-extensible dictionary`,
    );
  }

  for (
    let owner: object | null = target;
    owner !== null;
    owner = Object.getPrototypeOf(owner)
  ) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);

    if (descriptor === undefined) continue;

    if (
      "value" in descriptor
        ? !descriptor.writable
        : descriptor.set === undefined
    ) {
      throw new TypeError(
        `Cannot install read-only dictionary property ${
          describe_property_key(key)
        }`,
      );
    }

    return;
  }
}

function same_dictionary_method(
  method: (...args: unknown[]) => unknown,
  name: PropertyKey,
): (...args: unknown[]) => unknown {
  return function (this: Dictionary, ...args: unknown[]): unknown {
    const right = args[0];

    if (
      typeof right === "object" && right !== null && kind in right &&
      right[kind as keyof typeof right] !== this[kind]
    ) {
      throw new TypeError(
        `${
          describe_property_key(name)
        } requires values from the same dictionary; left ${
          describe_runtime_kind(this[kind])
        }, right ${describe_runtime_kind(right[kind as keyof typeof right])}`,
      );
    }

    return method.apply(this, args);
  };
}

function describe_property_key(key: PropertyKey): string {
  if (typeof key === "symbol") {
    return key.description === undefined ? key.toString() : key.description;
  }

  return String(key);
}

function describe_runtime_kind(runtime_kind: unknown): string {
  if (typeof runtime_kind === "symbol") {
    const registered = Symbol.keyFor(runtime_kind);
    if (registered !== undefined) {
      return `dictionary Symbol.for(${JSON.stringify(registered)})`;
    }
  }
  const weak = (typeof runtime_kind === "object" && runtime_kind !== null) ||
    typeof runtime_kind === "function" ||
    typeof runtime_kind === "symbol";
  if (!weak) {
    let description = String(runtime_kind);
    if (typeof runtime_kind === "string") {
      description = JSON.stringify(runtime_kind);
    }
    return `dictionary ${typeof runtime_kind} ${description}`;
  }
  let identifier = runtime_kind_ids.get(runtime_kind as WeakKey);

  if (identifier === undefined) {
    identifier = ++next_runtime_kind_id;
    runtime_kind_ids.set(runtime_kind as WeakKey, identifier);
  }

  return `dictionary #${identifier.toString()}`;
}

type TypeclassInstance<
  token extends PropertyKey,
  dictionary extends { [key in token]: object },
> = dictionary[token];

/** A typeclass token with operations for installing and retrieving instances. */
export type TypeclassDefinition<token extends PropertyKey = PropertyKey> = {
  /** The property key under which an instance is installed. */
  readonly token: token;
  /** Installs an instance using this definition's bound token. */
  instance<dictionary extends Dictionary & { [key in token]: object }>(
    dictionary: dictionary,
  ): (
    implementation: dictionary[token],
  ) => dictionary[token];
  /** Looks up an instance using this definition's bound token. */
  instance_for<receiver extends { [key in token]: object }>(
    receiver: receiver,
  ): receiver[token];
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

  // Derived operations belong to their definition. Binding once keeps them
  // usable as ordinary functions without changing generic call signatures.
  for (const key of Reflect.ownKeys(methods)) {
    const method = Reflect.get(definition, key);
    if (typeof method === "function" && !(kind in method)) {
      const operation = method.bind(definition);
      Object.defineProperties(
        operation,
        Object.getOwnPropertyDescriptors(method),
      );
      Reflect.set(definition, key, operation);
    }
  }

  Object.defineProperties(definition, {
    instance: { value: definition.instance.bind(definition) },
    instance_for: { value: definition.instance_for.bind(definition) },
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
    return instance_for_token(this.token, receiver);
  },
};

/** @ignore Shared dispatch without retaining a complete typeclass definition. */
export function instance_for_token<
  token extends PropertyKey,
  receiver extends { [key in token]: object },
>(
  token: token,
  receiver: receiver,
): receiver[token] {
  const instance = receiver?.[token];
  if (instance === undefined) {
    throw new TypeError(
      `Missing ${describe_property_key(token)} instance on ${
        describe_instance_receiver(receiver)
      }`,
    );
  }
  return instance;
}

function describe_instance_receiver(receiver: unknown): string {
  if (
    (typeof receiver === "object" && receiver !== null) ||
    typeof receiver === "function"
  ) {
    if (kind in receiver) {
      return describe_runtime_kind(receiver[kind as keyof typeof receiver]);
    }
  }

  return `value ${describe_runtime_value(receiver)}`;
}

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
