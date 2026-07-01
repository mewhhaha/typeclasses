import { type Kind, kind, type TypeId } from "./registry.ts";

const trait_brand: unique symbol = Symbol("Trait.brand");
const trait_dictionary: unique symbol = Symbol("Trait.dictionary");
const trait_value: unique symbol = Symbol("Trait.value");

type KindOf<dictionary> = dictionary extends {
  readonly [kind]: infer type_id extends TypeId;
} ? type_id
  : never;

export interface TraitBinding {
  readonly dictionary: unknown;
  readonly value: unknown;
  readonly item: unknown;
  readonly bound: unknown;
}

export type TraitInput<dictionary, value, item = unknown> =
  | value
  | Trait<dictionary, value, item>;

type BindingValue<binding extends TraitBinding, dictionary, value, item> =
  (binding & {
    readonly dictionary: dictionary;
    readonly value: value;
    readonly item: item;
  })["bound"];

type BoundArgument<dictionary, value> = value extends
  Kind<KindOf<dictionary>, infer item> ? value | Trait<dictionary, value, item>
  : value;

type BoundArguments<dictionary, args extends unknown[]> = {
  [key in keyof args]: BoundArgument<dictionary, args[key]>;
};

type BoundReturn<dictionary, value> = value extends
  Kind<KindOf<dictionary>, infer item> ? Trait<dictionary, value, item>
  : value;

const trait_binding: unique symbol = Symbol("Trait.binding");

export type TraitMethod<fn, binding extends TraitBinding> = fn & {
  readonly [trait_binding]: binding;
};

export interface FormatBinding extends TraitBinding {
  readonly bound: () => string;
}

export interface EqualBinding extends TraitBinding {
  readonly bound: (
    right: TraitInput<this["dictionary"], this["value"], this["item"]>,
  ) => boolean;
}

export interface FunctorMapBinding extends TraitBinding {
  readonly bound: <to>(
    fn: (value: this["item"]) => to,
  ) => Trait<this["dictionary"], Kind<KindOf<this["dictionary"]>, to>, to>;
}

export interface ApplicativeApBinding extends TraitBinding {
  readonly bound: this["item"] extends (value: infer from) => infer to ? (
      value: TraitInput<
        this["dictionary"],
        Kind<KindOf<this["dictionary"]>, from>,
        from
      >,
    ) => Trait<this["dictionary"], Kind<KindOf<this["dictionary"]>, to>, to>
    : never;
}

export interface ApplicativePureBinding extends TraitBinding {
  readonly bound: <to>(
    value: to,
  ) => Trait<this["dictionary"], Kind<KindOf<this["dictionary"]>, to>, to>;
}

export interface MonadFlatMapBinding extends TraitBinding {
  readonly bound: <to>(
    fn: (value: this["item"]) => TraitInput<
      this["dictionary"],
      Kind<KindOf<this["dictionary"]>, to>,
      to
    >,
  ) => Trait<this["dictionary"], Kind<KindOf<this["dictionary"]>, to>, to>;
}

export interface FoldableFoldBinding extends TraitBinding {
  readonly bound: <out>(
    initial: out,
    fn: (state: out, item: this["item"]) => out,
  ) => out;
}

export function trait_method<binding extends TraitBinding>() {
  return function bind_trait_method<
    fn extends (this: any, ...args: any[]) => any,
  >(
    fn: fn,
  ): TraitMethod<fn, binding> {
    return fn as TraitMethod<fn, binding>;
  };
}

type TraitBase<value> = {
  readonly [trait_brand]: true;
  value: () => value;
};

type BoundMethod<
  dictionary,
  value,
  item,
  key extends keyof dictionary,
> = dictionary[key] extends {
  readonly [trait_binding]: infer binding extends TraitBinding;
} ? BindingValue<binding, dictionary, value, item>
  : dictionary[key] extends
    (this: value | void, ...args: infer args) => infer out ? (
      ...args: BoundArguments<dictionary, args>
    ) => BoundReturn<dictionary, out>
  : never;

type BoundDictionary<dictionary, value, item> = {
  [
    key in keyof dictionary as dictionary[key] extends {
      readonly [trait_binding]: TraitBinding;
    } ? key
      : never
  ]: BoundMethod<dictionary, value, item, key>;
};

export type Trait<dictionary, value, item = unknown> =
  & TraitBase<value>
  & BoundDictionary<dictionary, value, item>;

type TraitTarget<dictionary, value> = {
  readonly [trait_brand]: true;
  readonly [trait_dictionary]: dictionary;
  readonly [trait_value]: value;
};

export function trait<dictionary extends object, value, item = unknown>(
  dictionary: dictionary,
  value: value,
  is_value: (value: unknown) => value is value,
): Trait<dictionary, value, item> {
  const target: TraitTarget<dictionary, value> = {
    [trait_brand]: true,
    [trait_dictionary]: dictionary,
    [trait_value]: value,
  };

  return new Proxy(target, {
    get(current, property) {
      if (property === trait_brand) {
        return true;
      }

      if (property === "value") {
        return function value() {
          return current[trait_value];
        };
      }

      const dictionary_value = current[trait_dictionary][
        property as keyof dictionary
      ];

      if (typeof dictionary_value !== "function") {
        return dictionary_value;
      }

      return function trait_method(...args: unknown[]) {
        const untraited_args = args.map((arg) => {
          return untrait(arg);
        });
        const result = dictionary_value.call(
          current[trait_value],
          ...untraited_args,
        );

        if (is_value(result)) {
          return trait(current[trait_dictionary], result, is_value);
        }

        return result;
      };
    },
  }) as unknown as Trait<dictionary, value, item>;
}

export function is_trait(value: unknown): value is Trait<object, unknown> {
  if (typeof value !== "object") {
    return false;
  }

  if (value === null) {
    return false;
  }

  const candidate = value as { [trait_brand]?: unknown };
  return candidate[trait_brand] === true;
}

export function untrait(value: unknown): unknown {
  if (is_trait(value)) {
    return value.value();
  }

  return value;
}
