import {
  type ApplicativeApBinding,
  type ApplicativePureBinding,
  type EqualBinding,
  type FoldableFoldBinding,
  type FormatBinding,
  type FunctorMapBinding,
  type MonadFlatMapBinding,
  trait_method,
} from "./trait_value.ts";

export { kind } from "./registry.ts";
export type { Kind, Registry, TypeId } from "./registry.ts";
import { type Kind, kind, type TypeId } from "./registry.ts";

export type TraitThis<self> = self | void;

export function require_this<self>(value: TraitThis<self>, name: string): self {
  if (value === undefined) {
    throw new TypeError(name + " requires a trait receiver");
  }

  return value;
}

type BoundFormat = {
  fmt: () => string;
};

type BoundEqual = {
  eq: (right: any) => boolean;
};

type BoundFunctor = {
  map: (fn: any) => any;
};

type BoundApplicative = {
  pure: (value: any) => any;
  ap: (value: any) => any;
};

type BoundMonad = {
  flat_map: (fn: any) => any;
};

type BoundFoldable = {
  fold: (initial: any, fn: any) => any;
};

export type Format<self> = {
  fmt: (this: TraitThis<self>) => string;
};

export function Format() {}

Format.method = trait_method<FormatBinding>();

Format.fmt = function fmt<value extends BoundFormat>(
  value: value,
): ReturnType<value["fmt"]> {
  return value.fmt() as ReturnType<value["fmt"]>;
};

export type Equal<self> = {
  eq: (this: TraitThis<self>, right: self) => boolean;
};

export function Equal() {}

Equal.method = trait_method<EqualBinding>();

Equal.eq = function eq<left extends BoundEqual>(
  left: left,
  right: Parameters<left["eq"]>[0],
): ReturnType<left["eq"]> {
  return left.eq(right) as ReturnType<left["eq"]>;
};

export type Functor<type_id extends TypeId> = {
  readonly [kind]: type_id;
  map: <from, to>(
    this: TraitThis<Kind<type_id, from>>,
    fn: (value: from) => to,
  ) => Kind<type_id, to>;
};

export function Functor() {}

Functor.method = trait_method<FunctorMapBinding>();

Functor.map = function map<value extends BoundFunctor>(
  value: value,
  fn: Parameters<value["map"]>[0],
): ReturnType<value["map"]> {
  return value.map(fn) as ReturnType<value["map"]>;
};

export type Applicative<type_id extends TypeId> =
  & Functor<type_id>
  & {
    pure: <item>(value: item) => Kind<type_id, item>;
    ap: <from, to>(
      this: TraitThis<Kind<type_id, (value: NoInfer<from>) => to>>,
      value: Kind<type_id, from>,
    ) => Kind<type_id, to>;
  };

export function Applicative() {}

Applicative.method = trait_method<ApplicativeApBinding>();
Applicative.pure_method = trait_method<ApplicativePureBinding>();

Applicative.pure = function pure<value extends BoundApplicative>(
  value: value,
  item: Parameters<value["pure"]>[0],
): ReturnType<value["pure"]> {
  return value.pure(item) as ReturnType<value["pure"]>;
};

Applicative.ap = function ap<value extends BoundApplicative>(
  value: value,
  item: Parameters<value["ap"]>[0],
): ReturnType<value["ap"]> {
  return value.ap(item) as ReturnType<value["ap"]>;
};

export type Monad<type_id extends TypeId> =
  & Applicative<type_id>
  & {
    flat_map: <from, to>(
      this: TraitThis<Kind<type_id, from>>,
      fn: (value: from) => Kind<type_id, to>,
    ) => Kind<type_id, to>;
  };

export function Monad() {}

Monad.method = trait_method<MonadFlatMapBinding>();

Monad.flat_map = function flat_map<value extends BoundMonad>(
  value: value,
  fn: any,
): any {
  return value.flat_map(fn);
};

export type Foldable<type_id extends TypeId> = {
  readonly [kind]: type_id;
  fold: <item, out>(
    this: TraitThis<Kind<type_id, item>>,
    initial: out,
    fn: (state: out, item: item) => out,
  ) => out;
};

export function Foldable() {}

Foldable.method = trait_method<FoldableFoldBinding>();

Foldable.fold = function fold<value extends BoundFoldable>(
  value: value,
  initial: any,
  fn: any,
): any {
  return value.fold(initial, fn);
};
