export { kind } from "./registry.ts";
export type { Kind, Registry, TypeId } from "./registry.ts";
import { type Kind, kind, type TypeId } from "./registry.ts";
import type { Trait, TraitInput } from "./trait_value.ts";

export type TraitThis<self> = self | void;

export function require_this<self>(value: TraitThis<self>, name: string): self {
  if (value === undefined) {
    throw new TypeError(name + " requires a trait receiver");
  }

  return value;
}

type KindOf<dictionary> = dictionary extends {
  readonly [kind]: infer type_id extends TypeId;
} ? type_id
  : never;

type TraitItem<value> = value extends Trait<any, any, infer item> ? item
  : never;

type TraitValue<value> = value extends Trait<any, infer raw, any> ? raw
  : never;

type TraitDictionary<value> = value extends Trait<infer dictionary, any, any>
  ? dictionary
  : never;

type Boxed<dictionary, item> = Trait<
  dictionary,
  Kind<KindOf<dictionary>, item>,
  item
>;

type BoxedInput<dictionary, item> = TraitInput<
  dictionary,
  Kind<KindOf<dictionary>, item>,
  item
>;

type Reboxed<value, item> = Boxed<TraitDictionary<value>, item>;

type AppliedInput<value> = TraitItem<value> extends
  (value: infer item) => unknown ? BoxedInput<TraitDictionary<value>, item>
  : never;

type AppliedReturn<value> = TraitItem<value> extends (value: any) => infer item
  ? Reboxed<value, item>
  : never;

type Dictionary = {
  readonly [kind]: TypeId;
};

type BoxedTrait = Trait<any, any, any>;

type BoundFormat = BoxedTrait & {
  fmt: () => string;
};

type BoundEqual = BoxedTrait & {
  eq: (right: any) => boolean;
};

type BoundFunctor = BoxedTrait & {
  map: (fn: any) => any;
};

type BoundApplicative = BoxedTrait & {
  pure: (value: any) => any;
  ap: (value: any) => any;
};

type BoundMonad = BoxedTrait & {
  flat_map: (fn: any) => any;
};

type BoundFoldable = BoxedTrait & {
  fold: (initial: any, fn: any) => any;
};

export type Format<dictionary extends Dictionary> = {
  fmt: (this: TraitThis<Boxed<dictionary, unknown>>) => string;
};

export function Format() {}

Format.fmt = function fmt<value extends BoundFormat>(
  value: value,
): ReturnType<value["fmt"]> {
  return value.fmt() as ReturnType<value["fmt"]>;
};

export type Equal<dictionary extends Dictionary> = {
  eq: <item>(
    this: TraitThis<Boxed<dictionary, item>>,
    right: BoxedInput<dictionary, item>,
  ) => boolean;
};

export function Equal() {}

Equal.eq = function eq<left extends BoundEqual>(
  left: left,
  right: TraitInput<TraitDictionary<left>, TraitValue<left>, TraitItem<left>>,
): boolean {
  return left.eq(right);
};

export type Functor<dictionary extends Dictionary> = {
  readonly [kind]: KindOf<dictionary>;
  map: <from, to>(
    this: TraitThis<Boxed<dictionary, from>>,
    fn: (value: from) => to,
  ) => Boxed<dictionary, to>;
};

export function Functor() {}

Functor.map = function map<value extends BoundFunctor, to>(
  value: value,
  fn: (value: TraitItem<value>) => to,
): Reboxed<value, to> {
  return value.map(fn) as Reboxed<value, to>;
};

export type Applicative<dictionary extends Dictionary> =
  & Functor<dictionary>
  & {
    pure: <item>(value: item) => Boxed<dictionary, item>;
    ap: <from, to>(
      this: TraitThis<Boxed<dictionary, (value: NoInfer<from>) => to>>,
      value: BoxedInput<dictionary, from>,
    ) => Boxed<dictionary, to>;
  };

export function Applicative() {}

Applicative.pure = function pure<value extends BoundApplicative, item>(
  value: value,
  item: item,
): Reboxed<value, item> {
  return value.pure(item) as Reboxed<value, item>;
};

Applicative.ap = function ap<value extends BoundApplicative>(
  value: value,
  item: AppliedInput<value>,
): AppliedReturn<value> {
  return value.ap(item) as AppliedReturn<value>;
};

export type Monad<dictionary extends Dictionary> =
  & Applicative<dictionary>
  & {
    flat_map: <from, to>(
      this: TraitThis<Boxed<dictionary, from>>,
      fn: (value: from) => BoxedInput<dictionary, to>,
    ) => Boxed<dictionary, to>;
  };

export function Monad() {}

Monad.flat_map = function flat_map<value extends BoundMonad, to>(
  value: value,
  fn: (value: TraitItem<value>) => BoxedInput<TraitDictionary<value>, to>,
): Reboxed<value, to> {
  return value.flat_map(fn) as Reboxed<value, to>;
};

export type Foldable<dictionary extends Dictionary> = {
  readonly [kind]: KindOf<dictionary>;
  fold: <item, out>(
    this: TraitThis<Boxed<dictionary, item>>,
    initial: out,
    fn: (state: out, item: item) => out,
  ) => out;
};

export function Foldable() {}

Foldable.fold = function fold<value extends BoundFoldable, out>(
  value: value,
  initial: out,
  fn: (state: out, item: TraitItem<value>) => out,
): out {
  return value.fold(initial, fn);
};
