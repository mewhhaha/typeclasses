export interface TypeApp<item> {}

export type TypeName = keyof TypeApp<unknown>;

export type Kind<uri extends TypeName, item> = TypeApp<item>[uri];

export type Format<self> = {
  fmt: (value: self) => string;
};

export function Format() {}

Format.fmt = function fmt<self>(impl: Format<self>, value: self): string {
  return impl.fmt(value);
};

export type Equal<self> = {
  eq: (left: self, right: self) => boolean;
};

export function Equal() {}

Equal.eq = function eq<self>(
  impl: Equal<self>,
  left: self,
  right: self,
): boolean {
  return impl.eq(left, right);
};

export type Functor<uri extends TypeName> = {
  uri: uri;
  map: <from, to>(
    value: Kind<uri, from>,
    fn: (value: from) => to,
  ) => Kind<uri, to>;
};

export function Functor() {}

Functor.map = function map<value, from, to, out>(
  impl: { map: (value: value, fn: (value: from) => to) => out },
  value: value,
  fn: (value: from) => to,
): out {
  return impl.map(value, fn);
};

export type Applicative<uri extends TypeName> =
  & Functor<uri>
  & {
    pure: <item>(value: item) => Kind<uri, item>;
    ap: <from, to>(
      fn: Kind<uri, (value: from) => to>,
      value: Kind<uri, from>,
    ) => Kind<uri, to>;
  };

export function Applicative() {}

Applicative.pure = function pure<item, out>(
  impl: { pure: (value: item) => out },
  value: item,
): out {
  return impl.pure(value);
};

Applicative.ap = function ap<fn_value, value, out>(
  impl: { ap: (fn: fn_value, value: value) => out },
  fn: fn_value,
  value: value,
): out {
  return impl.ap(fn, value);
};

export type Monad<uri extends TypeName> =
  & Applicative<uri>
  & {
    flat_map: <from, to>(
      value: Kind<uri, from>,
      fn: (value: from) => Kind<uri, to>,
    ) => Kind<uri, to>;
  };

export function Monad() {}

Monad.flat_map = function flat_map<value, from, out>(
  impl: { flat_map: (value: value, fn: (value: from) => out) => out },
  value: value,
  fn: (value: from) => out,
): out {
  return impl.flat_map(value, fn);
};

export type Foldable<uri extends TypeName> = {
  uri: uri;
  fold: <item, out>(
    value: Kind<uri, item>,
    initial: out,
    fn: (state: out, item: item) => out,
  ) => out;
};

export function Foldable() {}

Foldable.fold = function fold<value, item, out>(
  impl: {
    fold: (
      value: value,
      initial: out,
      fn: (state: out, item: item) => out,
    ) => out;
  },
  value: value,
  initial: out,
  fn: (state: out, item: item) => out,
): out {
  return impl.fold(value, initial, fn);
};
