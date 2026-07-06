export { is_data } from "./data_value.ts";
export type { WrappedData } from "./data_value.ts";
import {
  data_constructor as raw_as_data_cached,
  wrap_data as raw_as_data,
} from "./data_value.ts";
import type { WrappedData } from "./data_value.ts";

export const kind = Symbol("Data.kind");
const data_type = Symbol("Data.type");

export declare const type_item: unique symbol;
export declare const type_data: unique symbol;

export interface DataType {
  readonly [type_item]: unknown;
  readonly [type_data]: unknown;
}

export type AppliedData<type extends DataType, item> =
  (type & { readonly [type_item]: item })[typeof type_data];

export type ContextData<dictionary extends Dictionary, item> = AppliedData<
  DictionaryDataType<dictionary>,
  item
>;

export type DictionaryDataType<dictionary extends Dictionary> =
  NonNullable<dictionary[typeof data_type]> extends DataType
    ? NonNullable<dictionary[typeof data_type]>
    : DataType;

export type Data<dictionary extends Dictionary, item> = WrappedData<
  dictionary,
  ContextData<dictionary, item>,
  item
>;

export type Dictionary<type extends DataType = DataType> = {
  [kind]: unknown;
  readonly [data_type]?: type;
};

export interface As<type extends DataType> extends Dictionary<type> {
  <item>(value: AppliedData<type, item>): WrappedData<
    this,
    AppliedData<type, item>,
    item
  >;
}

export function as_data<dictionary extends Dictionary, item>(
  dictionary: dictionary,
  value: ContextData<dictionary, item>,
): Data<dictionary, item>;
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

export function as_data_cached<dictionary extends Dictionary>(
  dictionary: dictionary,
): <item>(value: ContextData<dictionary, item>) => Data<dictionary, item>;
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

export type DataWrapper<dictionary extends Dictionary> = <item>(
  value: ContextData<dictionary, item>,
) => Data<dictionary, item>;

export type DataConstructorContext<dictionary extends Dictionary> = {
  readonly data: DataWrapper<dictionary>;
};

export type DataConstructor<dictionary extends Dictionary> = <item>(
  this: DataConstructorContext<dictionary>,
  value: ContextData<dictionary, item>,
) => Data<dictionary, item>;

export function data<dictionary extends Dictionary>(): dictionary;
export function data<dictionary extends Dictionary>(
  construct: DataConstructor<dictionary>,
): dictionary;
export function data<dictionary extends Dictionary>(
  construct?: DataConstructor<dictionary>,
): dictionary {
  const runtime_kind = Symbol("Data.dictionary") as dictionary[typeof kind];
  const construct_dictionary = construct;

  if (construct_dictionary === undefined) {
    const target = function <item>(
      value: ContextData<dictionary, item>,
    ): Data<dictionary, item> {
      return wrap_data(value);
    } as unknown as dictionary;

    target[kind] = runtime_kind;
    const wrap_data = as_data_cached(target);

    return target;
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

export type TypeclassDictionary<
  dictionary extends Dictionary,
  token extends PropertyKey,
  methods extends object,
> =
  & {
    [kind]: dictionary[typeof kind];
    readonly [data_type]?: DictionaryDataType<dictionary>;
  }
  & { [key in token]: methods }
  & methods;

export function call_typeclass_method<self, args extends unknown[], out>(
  method: (this: self, ...args: args) => out,
  self: self,
  ...args: args
): out {
  return Reflect.apply(method, self, args) as out;
}

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

export type TypeclassDefinition<token extends PropertyKey = PropertyKey> =
  & TypeclassDefinitionPrototype<token>
  & {
    readonly token: token;
  };

type TypeclassDefinitionPrototype<token extends PropertyKey = PropertyKey> = {
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

type TypeclassMethods<token extends PropertyKey, methods extends object> =
  & methods
  & ThisType<TypeclassDefinition<token> & methods>;

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

export const TypeclassDefinition: TypeclassDefinitionPrototype = {
  instance<
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
  },

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
