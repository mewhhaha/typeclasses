export { kind } from "./registry.ts";
export type { Kind, Registry, TypeId } from "./registry.ts";
import { type Kind, kind, type TypeId } from "./registry.ts";
import type { Trait } from "./trait_value.ts";

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

export type Value<dictionary, item> = Trait<
  dictionary,
  Kind<KindOf<dictionary>, item>,
  item
>;

export type Dictionary = {
  readonly [kind]: TypeId;
};

export interface Format<dictionary extends Dictionary & Format<dictionary>> {
  fmt: (this: TraitThis<Value<dictionary, unknown>>) => string;
}

export interface FormatImpl {}

export function Format() {}

Format.fmt = function fmt<dictionary extends Dictionary & Format<dictionary>>(
  value: Value<dictionary, unknown>,
): string {
  return value.fmt();
};

export interface Equal<dictionary extends Dictionary & Equal<dictionary>> {
  eq: <item>(
    this: TraitThis<Value<dictionary, item>>,
    right: Value<dictionary, item>,
  ) => boolean;
}

export interface EqualImpl {}

export function Equal() {}

Equal.eq = function eq<
  dictionary extends Dictionary & Equal<dictionary>,
  item,
>(
  left: Value<dictionary, item>,
  right: Value<dictionary, item>,
): boolean {
  return left.eq(right);
};

export interface Functor<dictionary extends Dictionary & Functor<dictionary>> {
  map: <from, to>(
    this: TraitThis<Value<dictionary, from>>,
    fn: (value: from) => to,
  ) => Value<dictionary, to>;
}

export interface FunctorImpl {}

export function Functor() {}

Functor.map = function map<
  dictionary extends Dictionary & Functor<dictionary>,
  from,
  to,
>(
  value: Value<dictionary, from>,
  fn: (value: from) => to,
): Value<dictionary, to> {
  return value.map(fn);
};

export interface Applicative<
  dictionary extends Dictionary & Applicative<dictionary>,
> extends Functor<dictionary> {
  pure: <item>(value: item) => Value<dictionary, item>;
  ap: <from, to>(
    this: TraitThis<Value<dictionary, (value: NoInfer<from>) => to>>,
    value: Value<dictionary, from>,
  ) => Value<dictionary, to>;
}

export interface ApplicativeImpl {}

export function Applicative() {}

Applicative.pure = function pure<
  dictionary extends Dictionary & Applicative<dictionary>,
  item,
>(
  value: Value<dictionary, unknown>,
  item: item,
): Value<dictionary, item> {
  return value.pure(item);
};

Applicative.ap = function ap<
  dictionary extends Dictionary & Applicative<dictionary>,
  from,
  to,
>(
  value: Value<dictionary, (value: NoInfer<from>) => to>,
  item: Value<dictionary, from>,
): Value<dictionary, to> {
  return value.ap(item);
};

export interface Monad<dictionary extends Dictionary & Monad<dictionary>>
  extends Applicative<dictionary> {
  flat_map: <from, to>(
    this: TraitThis<Value<dictionary, from>>,
    fn: (value: from) => Value<dictionary, to>,
  ) => Value<dictionary, to>;
}

export interface MonadImpl {}

export function Monad() {}

Monad.flat_map = function flat_map<
  dictionary extends Dictionary & Monad<dictionary>,
  from,
  to,
>(
  value: Value<dictionary, from>,
  fn: (value: from) => Value<dictionary, to>,
): Value<dictionary, to> {
  return value.flat_map(fn);
};

export interface Foldable<
  dictionary extends Dictionary & Foldable<dictionary>,
> {
  fold: <item, out>(
    this: TraitThis<Value<dictionary, item>>,
    initial: out,
    fn: (state: out, item: item) => out,
  ) => out;
}

export interface FoldableImpl {}

export function Foldable() {}

Foldable.fold = function fold<
  dictionary extends Dictionary & Foldable<dictionary>,
  item,
  out,
>(
  value: Value<dictionary, item>,
  initial: out,
  fn: (state: out, item: item) => out,
): out {
  return value.fold(initial, fn);
};
