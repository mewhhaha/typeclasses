import {
  type ApplicativeApBinding,
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

export type Format<self> = {
  fmt: (this: TraitThis<self>) => string;
};

export function Format() {}

Format.method = trait_method<FormatBinding>();

Format.fmt = function fmt<self>(impl: Format<self>, value: self): string {
  return impl.fmt.call(value);
};

export type Equal<self> = {
  eq: (this: TraitThis<self>, right: self) => boolean;
};

export function Equal() {}

Equal.method = trait_method<EqualBinding>();

Equal.eq = function eq<self>(
  impl: Equal<self>,
  left: self,
  right: self,
): boolean {
  return impl.eq.call(left, right);
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

Functor.map = function map<type_id extends TypeId, from, to>(
  impl: Functor<type_id>,
  value: Kind<type_id, from>,
  fn: (value: from) => to,
): Kind<type_id, to> {
  const map = impl.map as (
    this: TraitThis<Kind<type_id, from>>,
    fn: (value: from) => to,
  ) => Kind<type_id, to>;

  return map.call(value, fn);
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

Applicative.pure = function pure<type_id extends TypeId, item>(
  impl: Applicative<type_id>,
  value: item,
): Kind<type_id, item> {
  return impl.pure(value);
};

Applicative.ap = function ap<type_id extends TypeId, to>(
  impl: Applicative<type_id>,
  fn: Kind<type_id, (value: any) => to>,
  value: Kind<type_id, any>,
): Kind<type_id, to> {
  const ap = impl.ap as (
    this: TraitThis<Kind<type_id, (value: any) => to>>,
    value: Kind<type_id, any>,
  ) => Kind<type_id, to>;

  return ap.call(fn, value);
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

Monad.flat_map = function flat_map<type_id extends TypeId, from, to>(
  impl: Monad<type_id>,
  value: Kind<type_id, from>,
  fn: (value: from) => Kind<type_id, to>,
): Kind<type_id, to> {
  const flat_map = impl.flat_map as (
    this: TraitThis<Kind<type_id, from>>,
    fn: (value: from) => Kind<type_id, to>,
  ) => Kind<type_id, to>;

  return flat_map.call(value, fn);
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

Foldable.fold = function fold<type_id extends TypeId, item, out>(
  impl: Foldable<type_id>,
  value: Kind<type_id, item>,
  initial: out,
  fn: (state: out, item: item) => out,
): out {
  const fold = impl.fold as (
    this: TraitThis<Kind<type_id, item>>,
    initial: out,
    fn: (state: out, item: item) => out,
  ) => out;

  return fold.call(value, initial, fn);
};
