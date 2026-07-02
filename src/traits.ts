import {
  type Dictionary,
  type Receiver,
  TraitDefinition,
  type TraitDictionary,
  type Value,
} from "./trait.ts";

export const format_trait: unique symbol = Symbol("Format");

export interface Format<dictionary extends Dictionary> extends
  TraitDictionary<
    dictionary,
    typeof format_trait,
    {
      fmt: (self: Value<dictionary, unknown>) => string;
    },
    {
      fmt: (this: Receiver<dictionary, unknown>) => string;
    }
  > {}

export abstract class Format<dictionary extends Dictionary>
  extends TraitDefinition {
  static override readonly token: typeof format_trait = format_trait;

  static fmt<dictionary extends Format<dictionary>>(
    value: Value<dictionary, unknown>,
  ): string {
    return this.invoke<string>(value, "fmt");
  }
}

export const equal_trait: unique symbol = Symbol("Equal");

export interface Equal<dictionary extends Dictionary> extends
  TraitDictionary<
    dictionary,
    typeof equal_trait,
    {
      eq: <item>(
        left: Value<dictionary, item>,
        right: Value<dictionary, item>,
      ) => boolean;
    },
    {
      eq: <item>(
        this: Receiver<dictionary, item>,
        right: Value<dictionary, item>,
      ) => boolean;
    }
  > {}

export abstract class Equal<dictionary extends Dictionary>
  extends TraitDefinition {
  static override readonly token: typeof equal_trait = equal_trait;

  static eq<
    dictionary extends Equal<dictionary>,
    item,
  >(
    left: Value<dictionary, item>,
    right: Value<dictionary, item>,
  ): boolean {
    return this.invoke<boolean>(left, "eq", [right]);
  }
}

export const semigroup_trait: unique symbol = Symbol("Semigroup");

export interface Semigroup<dictionary extends Dictionary>
  extends
    TraitDictionary<
      dictionary,
      typeof semigroup_trait,
      {
        concat: <item>(
          left: Value<dictionary, item>,
          right: Value<dictionary, item>,
        ) => Value<dictionary, item>;
      },
      {
        concat: <item>(
          this: Receiver<dictionary, item>,
          right: Value<dictionary, item>,
        ) => Value<dictionary, item>;
      }
    > {}

export abstract class Semigroup<dictionary extends Dictionary>
  extends TraitDefinition {
  static override readonly token: typeof semigroup_trait = semigroup_trait;

  static concat<
    dictionary extends Semigroup<dictionary>,
    item,
  >(
    left: Value<dictionary, item>,
    right: Value<dictionary, item>,
  ): Value<dictionary, item> {
    return this.invoke<Value<dictionary, item>>(left, "concat", [right]);
  }
}

export const monoid_trait: unique symbol = Symbol("Monoid");

export interface Monoid<dictionary extends Dictionary> extends
  TraitDictionary<
    dictionary,
    typeof monoid_trait,
    {
      empty: <item>(self: Value<dictionary, unknown>) => Value<
        dictionary,
        item
      >;
    },
    {
      empty: <item>(this: Receiver<dictionary, unknown>) => Value<
        dictionary,
        item
      >;
    }
  >,
  Semigroup<dictionary> {}

export abstract class Monoid<dictionary extends Dictionary>
  extends TraitDefinition {
  static override readonly token: typeof monoid_trait = monoid_trait;

  static empty<
    dictionary extends Monoid<dictionary>,
    item,
  >(
    value: Value<dictionary, unknown>,
  ): Value<dictionary, item> {
    return this.invoke<Value<dictionary, item>>(value, "empty");
  }

  static concat<
    dictionary extends Monoid<dictionary>,
    item,
  >(
    left: Value<dictionary, item>,
    right: Value<dictionary, item>,
  ): Value<dictionary, item> {
    return Semigroup.concat(left, right);
  }
}

export const functor_trait: unique symbol = Symbol("Functor");

export interface Functor<dictionary extends Dictionary> extends
  TraitDictionary<
    dictionary,
    typeof functor_trait,
    {
      map: <from, to>(
        value: Value<dictionary, from>,
        fn: (value: from) => to,
      ) => Value<dictionary, to>;
    },
    {
      map: <from, to>(
        this: Receiver<dictionary, from>,
        fn: (value: from) => to,
      ) => Value<dictionary, to>;
    }
  > {}

export abstract class Functor<dictionary extends Dictionary>
  extends TraitDefinition {
  static override readonly token: typeof functor_trait = functor_trait;

  static map<
    dictionary extends Functor<dictionary>,
    from,
    to,
  >(
    value: Value<dictionary, from>,
    fn: (value: from) => to,
  ): Value<dictionary, to> {
    return this.invoke<Value<dictionary, to>>(value, "map", [fn]);
  }
}

export const applicative_trait: unique symbol = Symbol("Applicative");

export interface Applicative<dictionary extends Dictionary>
  extends
    TraitDictionary<
      dictionary,
      typeof applicative_trait,
      {
        pure: <item>(
          self: Value<dictionary, unknown>,
          value: item,
        ) => Value<dictionary, item>;
        ap: <from, to>(
          self: Value<dictionary, (value: NoInfer<from>) => to>,
          value: Value<dictionary, from>,
        ) => Value<dictionary, to>;
      },
      {
        pure: <item>(
          this: Receiver<dictionary, unknown>,
          value: item,
        ) => Value<dictionary, item>;
        ap: <from, to>(
          this: Receiver<dictionary, (value: NoInfer<from>) => to>,
          value: Value<dictionary, from>,
        ) => Value<dictionary, to>;
      }
    >,
    Functor<dictionary> {}

export abstract class Applicative<dictionary extends Dictionary>
  extends TraitDefinition {
  static override readonly token: typeof applicative_trait = applicative_trait;

  static pure<
    dictionary extends Applicative<dictionary>,
    item,
  >(
    value: Value<dictionary, unknown>,
    item: item,
  ): Value<dictionary, item> {
    return this.invoke<Value<dictionary, item>>(value, "pure", [item]);
  }

  static ap<
    dictionary extends Applicative<dictionary>,
    from,
    to,
  >(
    value: Value<dictionary, (value: NoInfer<from>) => to>,
    item: Value<dictionary, from>,
  ): Value<dictionary, to> {
    return this.invoke<Value<dictionary, to>>(value, "ap", [item]);
  }
}

export const alternative_trait: unique symbol = Symbol("Alternative");

export interface Alternative<dictionary extends Dictionary>
  extends
    TraitDictionary<
      dictionary,
      typeof alternative_trait,
      {
        empty: <item>(self: Value<dictionary, unknown>) => Value<
          dictionary,
          item
        >;
        alt: <item>(
          left: Value<dictionary, item>,
          right: Value<dictionary, item>,
        ) => Value<dictionary, item>;
      },
      {
        empty: <item>(this: Receiver<dictionary, unknown>) => Value<
          dictionary,
          item
        >;
        alt: <item>(
          this: Receiver<dictionary, item>,
          right: Value<dictionary, item>,
        ) => Value<dictionary, item>;
      }
    >,
    Applicative<dictionary> {}

export abstract class Alternative<dictionary extends Dictionary>
  extends TraitDefinition {
  static override readonly token: typeof alternative_trait = alternative_trait;

  static empty<
    dictionary extends Alternative<dictionary>,
    item,
  >(
    value: Value<dictionary, unknown>,
  ): Value<dictionary, item> {
    return this.invoke<Value<dictionary, item>>(value, "empty");
  }

  static alt<
    dictionary extends Alternative<dictionary>,
    item,
  >(
    left: Value<dictionary, item>,
    right: Value<dictionary, item>,
  ): Value<dictionary, item> {
    return this.invoke<Value<dictionary, item>>(left, "alt", [right]);
  }
}

export const monad_trait: unique symbol = Symbol("Monad");

export interface Monad<dictionary extends Dictionary> extends
  TraitDictionary<
    dictionary,
    typeof monad_trait,
    {
      bind: <from, to>(
        value: Value<dictionary, from>,
        fn: (value: from) => Value<dictionary, to>,
      ) => Value<dictionary, to>;
    },
    {
      bind: <from, to>(
        this: Receiver<dictionary, from>,
        fn: (value: from) => Value<dictionary, to>,
      ) => Value<dictionary, to>;
    }
  >,
  Applicative<dictionary> {}

type PerformGenerator<
  dictionary extends Monad<dictionary>,
  out,
> = Generator<Value<dictionary, unknown>, out, unknown>;

export abstract class Monad<dictionary extends Dictionary>
  extends TraitDefinition {
  static override readonly token: typeof monad_trait = monad_trait;

  static override bind<
    dictionary extends Monad<dictionary>,
    from,
    to,
  >(
    value: Value<dictionary, from>,
    fn: (value: from) => Value<dictionary, to>,
  ): Value<dictionary, to> {
    return this.invoke<Value<dictionary, to>>(value, "bind", [fn]);
  }
}

export function perform<dictionary extends Monad<dictionary>, out>(
  run: () => PerformGenerator<dictionary, out>,
): Value<dictionary, out> {
  const first = run_with([]);

  if (first.done) {
    throw new TypeError("perform requires at least one yielded value");
  }

  return step([], first.value);

  function run_with(
    values: unknown[],
  ): IteratorResult<Value<dictionary, unknown>, out> {
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
    current: Value<dictionary, unknown>,
  ): Value<dictionary, out> {
    return Monad.bind(current, (value) => {
      const next_values = [...values, value];
      const next = run_with(next_values);

      if (next.done) {
        return Applicative.pure(current, next.value);
      }

      return step(next_values, next.value);
    });
  }
}

export const foldable_trait: unique symbol = Symbol("Foldable");

export interface Foldable<dictionary extends Dictionary>
  extends
    TraitDictionary<
      dictionary,
      typeof foldable_trait,
      {
        fold: <item, out>(
          value: Value<dictionary, item>,
          initial: out,
          fn: (state: out, item: item) => out,
        ) => out;
      },
      {
        fold: <item, out>(
          this: Receiver<dictionary, item>,
          initial: out,
          fn: (state: out, item: item) => out,
        ) => out;
      }
    > {}

export abstract class Foldable<dictionary extends Dictionary>
  extends TraitDefinition {
  static override readonly token: typeof foldable_trait = foldable_trait;

  static fold<
    dictionary extends Foldable<dictionary>,
    item,
    out,
  >(
    value: Value<dictionary, item>,
    initial: out,
    fn: (state: out, item: item) => out,
  ): out {
    return this.invoke<out>(value, "fold", [initial, fn]);
  }
}

export const traversable_trait: unique symbol = Symbol("Traversable");

export interface Traversable<dictionary extends Dictionary>
  extends
    TraitDictionary<
      dictionary,
      typeof traversable_trait,
      {
        traverse: <
          applicative extends Applicative<applicative>,
          from,
          to,
        >(
          value: Value<dictionary, from>,
          applicative: Value<applicative, unknown>,
          fn: (value: from) => Value<applicative, to>,
        ) => Value<applicative, Value<dictionary, to>>;
      },
      {
        traverse: <
          applicative extends Applicative<applicative>,
          from,
          to,
        >(
          this: Receiver<dictionary, from>,
          applicative: Value<applicative, unknown>,
          fn: (value: from) => Value<applicative, to>,
        ) => Value<applicative, Value<dictionary, to>>;
      }
    >,
    Functor<dictionary>,
    Foldable<dictionary> {}

export abstract class Traversable<dictionary extends Dictionary>
  extends TraitDefinition {
  static override readonly token: typeof traversable_trait = traversable_trait;

  static traverse<
    dictionary extends Traversable<dictionary>,
    applicative extends Applicative<applicative>,
    from,
    to,
  >(
    value: Value<dictionary, from>,
    applicative: Value<applicative, unknown>,
    fn: (value: from) => Value<applicative, to>,
  ): Value<applicative, Value<dictionary, to>> {
    return this.invoke<Value<applicative, Value<dictionary, to>>>(
      value,
      "traverse",
      [applicative, fn],
    );
  }

  static sequence<
    dictionary extends Traversable<dictionary>,
    applicative extends Applicative<applicative>,
    item,
  >(
    value: Value<dictionary, Value<applicative, item>>,
    applicative: Value<applicative, unknown>,
  ): Value<applicative, Value<dictionary, item>> {
    return this.invoke<Value<applicative, Value<dictionary, item>>>(
      value,
      "traverse",
      [
        applicative,
        (value: Value<applicative, item>) => {
          return value;
        },
      ],
    );
  }
}
