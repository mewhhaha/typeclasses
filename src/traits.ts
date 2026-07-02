import type { Dictionary, Receiver, Value } from "./trait.ts";

export function implement_trait<implementation extends object>(
  dictionary: object,
  token: PropertyKey,
  implementation: implementation,
): implementation {
  Object.assign(dictionary, implementation);
  (dictionary as { [key: PropertyKey]: unknown })[token] = implementation;

  return implementation;
}

function call_trait_method<out>(
  method: Function,
  receiver: unknown,
  args: readonly unknown[],
): out {
  return Reflect.apply(method, receiver, args) as out;
}

export const format_trait: unique symbol = Symbol("Format");

export interface FormatImplementation<dictionary extends Dictionary> {
  fmt: (this: Receiver<dictionary, unknown>) => string;
}

export interface Format<dictionary extends Dictionary> {
  [format_trait]: FormatImplementation<dictionary>;
}

export function Format() {}

export namespace Format {
  export type Trait<dictionary extends Dictionary> =
    & Format<dictionary>
    & FormatImplementation<dictionary>;
}

Format.implement = function implement<dictionary extends Dictionary>(
  dictionary: dictionary,
  implementation: FormatImplementation<dictionary>,
): FormatImplementation<dictionary> {
  return implement_trait(dictionary, format_trait, implementation);
};

Format.fmt = function fmt<dictionary extends Dictionary & Format<dictionary>>(
  value: Value<dictionary, unknown>,
): string {
  return call_trait_method(value[format_trait].fmt, value, []);
};

export const equal_trait: unique symbol = Symbol("Equal");

export interface EqualImplementation<dictionary extends Dictionary> {
  eq: <item>(
    this: Receiver<dictionary, item>,
    right: Value<dictionary, item>,
  ) => boolean;
}

export interface Equal<dictionary extends Dictionary> {
  [equal_trait]: EqualImplementation<dictionary>;
}

export function Equal() {}

export namespace Equal {
  export type Trait<dictionary extends Dictionary> =
    & Equal<dictionary>
    & EqualImplementation<dictionary>;
}

Equal.implement = function implement<dictionary extends Dictionary>(
  dictionary: dictionary,
  implementation: EqualImplementation<dictionary>,
): EqualImplementation<dictionary> {
  return implement_trait(dictionary, equal_trait, implementation);
};

Equal.eq = function eq<
  dictionary extends Dictionary & Equal<dictionary>,
  item,
>(
  left: Value<dictionary, item>,
  right: Value<dictionary, item>,
): boolean {
  return call_trait_method(left[equal_trait].eq, left, [right]);
};

export const semigroup_trait: unique symbol = Symbol("Semigroup");

export interface SemigroupImplementation<dictionary extends Dictionary> {
  concat: <item>(
    this: Receiver<dictionary, item>,
    right: Value<dictionary, item>,
  ) => Value<dictionary, item>;
}

export interface Semigroup<dictionary extends Dictionary> {
  [semigroup_trait]: SemigroupImplementation<dictionary>;
}

export function Semigroup() {}

export namespace Semigroup {
  export type Trait<dictionary extends Dictionary> =
    & Semigroup<dictionary>
    & SemigroupImplementation<dictionary>;
}

Semigroup.implement = function implement<dictionary extends Dictionary>(
  dictionary: dictionary,
  implementation: SemigroupImplementation<dictionary>,
): SemigroupImplementation<dictionary> {
  return implement_trait(dictionary, semigroup_trait, implementation);
};

Semigroup.concat = function concat<
  dictionary extends Dictionary & Semigroup<dictionary>,
  item,
>(
  left: Value<dictionary, item>,
  right: Value<dictionary, item>,
): Value<dictionary, item> {
  return call_trait_method(left[semigroup_trait].concat, left, [right]);
};

export const monoid_trait: unique symbol = Symbol("Monoid");

export interface MonoidImplementation<dictionary extends Dictionary> {
  empty: <item>() => Value<dictionary, item>;
}

export interface Monoid<dictionary extends Dictionary>
  extends Semigroup<dictionary> {
  [monoid_trait]: MonoidImplementation<dictionary>;
}

export function Monoid() {}

export namespace Monoid {
  export type Trait<dictionary extends Dictionary> =
    & Monoid<dictionary>
    & MonoidImplementation<dictionary>;
}

Monoid.implement = function implement<dictionary extends Dictionary>(
  dictionary: dictionary,
  implementation: MonoidImplementation<dictionary>,
): MonoidImplementation<dictionary> {
  return implement_trait(dictionary, monoid_trait, implementation);
};

Monoid.empty = function empty<
  dictionary extends Dictionary & Monoid<dictionary>,
  item,
>(
  value: Value<dictionary, unknown>,
): Value<dictionary, item> {
  return value[monoid_trait].empty();
};

Monoid.concat = Semigroup.concat;

export const functor_trait: unique symbol = Symbol("Functor");

export interface FunctorImplementation<dictionary extends Dictionary> {
  map: <from, to>(
    this: Receiver<dictionary, from>,
    fn: (value: from) => to,
  ) => Value<dictionary, to>;
}

export interface Functor<dictionary extends Dictionary> {
  [functor_trait]: FunctorImplementation<dictionary>;
}

export function Functor() {}

export namespace Functor {
  export type Trait<dictionary extends Dictionary> =
    & Functor<dictionary>
    & FunctorImplementation<dictionary>;
}

Functor.implement = function implement<dictionary extends Dictionary>(
  dictionary: dictionary,
  implementation: FunctorImplementation<dictionary>,
): FunctorImplementation<dictionary> {
  return implement_trait(dictionary, functor_trait, implementation);
};

Functor.map = function map<
  dictionary extends Dictionary & Functor<dictionary>,
  from,
  to,
>(
  value: Value<dictionary, from>,
  fn: (value: from) => to,
): Value<dictionary, to> {
  return call_trait_method(value[functor_trait].map, value, [fn]);
};

export const applicative_trait: unique symbol = Symbol("Applicative");

export interface ApplicativeImplementation<dictionary extends Dictionary> {
  pure: <item>(value: item) => Value<dictionary, item>;
  ap: <from, to>(
    this: Receiver<dictionary, (value: NoInfer<from>) => to>,
    value: Value<dictionary, from>,
  ) => Value<dictionary, to>;
}

export interface Applicative<dictionary extends Dictionary>
  extends Functor<dictionary> {
  [applicative_trait]: ApplicativeImplementation<dictionary>;
}

export function Applicative() {}

export namespace Applicative {
  export type Trait<dictionary extends Dictionary> =
    & Applicative<dictionary>
    & ApplicativeImplementation<dictionary>;
}

Applicative.implement = function implement<dictionary extends Dictionary>(
  dictionary: dictionary,
  implementation: ApplicativeImplementation<dictionary>,
): ApplicativeImplementation<dictionary> {
  return implement_trait(dictionary, applicative_trait, implementation);
};

Applicative.pure = function pure<
  dictionary extends Dictionary & Applicative<dictionary>,
  item,
>(
  value: Value<dictionary, unknown>,
  item: item,
): Value<dictionary, item> {
  return value[applicative_trait].pure(item);
};

Applicative.ap = function ap<
  dictionary extends Dictionary & Applicative<dictionary>,
  from,
  to,
>(
  value: Value<dictionary, (value: NoInfer<from>) => to>,
  item: Value<dictionary, from>,
): Value<dictionary, to> {
  return call_trait_method(value[applicative_trait].ap, value, [item]);
};

export const alternative_trait: unique symbol = Symbol("Alternative");

export interface AlternativeImplementation<dictionary extends Dictionary> {
  empty: <item>() => Value<dictionary, item>;
  alt: <item>(
    this: Receiver<dictionary, item>,
    right: Value<dictionary, item>,
  ) => Value<dictionary, item>;
}

export interface Alternative<dictionary extends Dictionary>
  extends Applicative<dictionary> {
  [alternative_trait]: AlternativeImplementation<dictionary>;
}

export function Alternative() {}

export namespace Alternative {
  export type Trait<dictionary extends Dictionary> =
    & Alternative<dictionary>
    & AlternativeImplementation<dictionary>;
}

Alternative.implement = function implement<dictionary extends Dictionary>(
  dictionary: dictionary,
  implementation: AlternativeImplementation<dictionary>,
): AlternativeImplementation<dictionary> {
  return implement_trait(dictionary, alternative_trait, implementation);
};

Alternative.empty = function empty<
  dictionary extends Dictionary & Alternative<dictionary>,
  item,
>(
  value: Value<dictionary, unknown>,
): Value<dictionary, item> {
  return value[alternative_trait].empty();
};

Alternative.alt = function alt<
  dictionary extends Dictionary & Alternative<dictionary>,
  item,
>(
  left: Value<dictionary, item>,
  right: Value<dictionary, item>,
): Value<dictionary, item> {
  return call_trait_method(left[alternative_trait].alt, left, [right]);
};

export const monad_trait: unique symbol = Symbol("Monad");

export interface MonadImplementation<dictionary extends Dictionary> {
  bind: <from, to>(
    this: Receiver<dictionary, from>,
    fn: (value: from) => Value<dictionary, to>,
  ) => Value<dictionary, to>;
}

export interface Monad<dictionary extends Dictionary>
  extends Applicative<dictionary> {
  [monad_trait]: MonadImplementation<dictionary>;
}

type PerformGenerator<
  dictionary extends Dictionary & Monad<dictionary>,
  out,
> = Generator<Value<dictionary, any>, out, any>;

export function Monad() {}

export namespace Monad {
  export type Trait<dictionary extends Dictionary> =
    & Monad<dictionary>
    & MonadImplementation<dictionary>;
}

Monad.implement = function implement<dictionary extends Dictionary>(
  dictionary: dictionary,
  implementation: MonadImplementation<dictionary>,
): MonadImplementation<dictionary> {
  return implement_trait(dictionary, monad_trait, implementation);
};

Monad.bind = function bind<
  dictionary extends Dictionary & Monad<dictionary>,
  from,
  to,
>(
  value: Value<dictionary, from>,
  fn: (value: from) => Value<dictionary, to>,
): Value<dictionary, to> {
  return call_trait_method(value[monad_trait].bind, value, [fn]);
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
    return call_trait_method(current[monad_trait].bind, current, [
      (value: any) => {
        const next_values = [...values, value];
        const next = run_with(next_values);

        if (next.done) {
          return current[applicative_trait].pure(next.value);
        }

        return step(next_values, next.value);
      },
    ]);
  }
}

export const foldable_trait: unique symbol = Symbol("Foldable");

export interface FoldableImplementation<dictionary extends Dictionary> {
  fold: <item, out>(
    this: Receiver<dictionary, item>,
    initial: out,
    fn: (state: out, item: item) => out,
  ) => out;
}

export interface Foldable<dictionary extends Dictionary> {
  [foldable_trait]: FoldableImplementation<dictionary>;
}

export function Foldable() {}

export namespace Foldable {
  export type Trait<dictionary extends Dictionary> =
    & Foldable<dictionary>
    & FoldableImplementation<dictionary>;
}

Foldable.implement = function implement<dictionary extends Dictionary>(
  dictionary: dictionary,
  implementation: FoldableImplementation<dictionary>,
): FoldableImplementation<dictionary> {
  return implement_trait(dictionary, foldable_trait, implementation);
};

Foldable.fold = function fold<
  dictionary extends Dictionary & Foldable<dictionary>,
  item,
  out,
>(
  value: Value<dictionary, item>,
  initial: out,
  fn: (state: out, item: item) => out,
): out {
  return call_trait_method(value[foldable_trait].fold, value, [initial, fn]);
};

export const traversable_trait: unique symbol = Symbol("Traversable");

export interface TraversableImplementation<dictionary extends Dictionary> {
  traverse: <
    applicative extends Dictionary & Applicative<applicative>,
    from,
    to,
  >(
    this: Receiver<dictionary, from>,
    applicative: Value<applicative, unknown>,
    fn: (value: from) => Value<applicative, to>,
  ) => Value<applicative, Value<dictionary, to>>;
}

export interface Traversable<dictionary extends Dictionary>
  extends Functor<dictionary>, Foldable<dictionary> {
  [traversable_trait]: TraversableImplementation<dictionary>;
}

export function Traversable() {}

export namespace Traversable {
  export type Trait<dictionary extends Dictionary> =
    & Traversable<dictionary>
    & TraversableImplementation<dictionary>;
}

Traversable.implement = function implement<dictionary extends Dictionary>(
  dictionary: dictionary,
  implementation: TraversableImplementation<dictionary>,
): TraversableImplementation<dictionary> {
  return implement_trait(dictionary, traversable_trait, implementation);
};

Traversable.traverse = function traverse<
  dictionary extends Dictionary & Traversable<dictionary>,
  applicative extends Dictionary & Applicative<applicative>,
  from,
  to,
>(
  value: Value<dictionary, from>,
  applicative: Value<applicative, unknown>,
  fn: (value: from) => Value<applicative, to>,
): Value<applicative, Value<dictionary, to>> {
  return call_trait_method(value[traversable_trait].traverse, value, [
    applicative,
    fn,
  ]);
};

Traversable.sequence = function sequence<
  dictionary extends Dictionary & Traversable<dictionary>,
  applicative extends Dictionary & Applicative<applicative>,
  item,
>(
  value: Value<dictionary, Value<applicative, item>>,
  applicative: Value<applicative, unknown>,
): Value<applicative, Value<dictionary, item>> {
  return call_trait_method(value[traversable_trait].traverse, value, [
    applicative,
    (value: Value<applicative, item>) => {
      return value;
    },
  ]);
};
