import type { Dictionary, TraitThis, Value } from "./trait.ts";

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
  bind: <from, to>(
    this: TraitThis<Value<dictionary, from>>,
    fn: (value: from) => Value<dictionary, to>,
  ) => Value<dictionary, to>;
}

type PerformGenerator<
  dictionary extends Dictionary & Monad<dictionary>,
  out,
> = Generator<Value<dictionary, any>, out, any>;

export interface MonadImpl {}

export function Monad() {}

Monad.bind = function bind<
  dictionary extends Dictionary & Monad<dictionary>,
  from,
  to,
>(
  value: Value<dictionary, from>,
  fn: (value: from) => Value<dictionary, to>,
): Value<dictionary, to> {
  return value.bind(fn);
};

export function perform<dictionary extends Dictionary & Monad<dictionary>, out>(
  run: () => PerformGenerator<dictionary, out>,
): Value<dictionary, out> {
  const first = run_with([]);

  if (first.done) {
    throw new TypeError("perform requires at least one yielded value");
  }

  return step([], first.value);

  function run_with(
    values: unknown[],
  ): IteratorResult<Value<dictionary, any>, out> {
    const iterator = run();
    let next = iterator.next();

    for (const value of values) {
      if (next.done) {
        return next;
      }

      next = iterator.next(value);
    }

    return next;
  }

  function step(
    values: unknown[],
    current: Value<dictionary, any>,
  ): Value<dictionary, out> {
    return current.bind((value) => {
      const next_values = [...values, value];
      const next = run_with(next_values);

      if (next.done) {
        return current.pure(next.value);
      }

      return step(next_values, next.value);
    });
  }
}

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
