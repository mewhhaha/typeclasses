import {
  define_trait,
  type Dictionary,
  type Receiver,
  type TraitDictionary,
  type Value,
} from "./trait.ts";

export const format_trait = Symbol("Format");

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

export const Format = define_trait(format_trait, {
  fmt<dictionary extends Format<dictionary>>(
    value: Value<dictionary, unknown>,
  ): string {
    return this.implementation(value).fmt(value);
  },
});

export const equal_trait = Symbol("Equal");

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

export const Equal = define_trait(equal_trait, {
  eq<
    dictionary extends Equal<dictionary>,
    item,
  >(
    left: Value<dictionary, item>,
    right: Value<dictionary, item>,
  ): boolean {
    return this.implementation(left).eq(left, right);
  },
});

export const semigroup_trait = Symbol("Semigroup");

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

export const Semigroup = define_trait(semigroup_trait, {
  concat<
    dictionary extends Semigroup<dictionary>,
    item,
  >(
    left: Value<dictionary, item>,
    right: Value<dictionary, item>,
  ): Value<dictionary, item> {
    return this.implementation(left).concat(left, right);
  },
});

export const monoid_trait = Symbol("Monoid");

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

export const Monoid = define_trait(monoid_trait, {
  empty<
    dictionary extends Monoid<dictionary>,
    item,
  >(
    value: Value<dictionary, unknown>,
  ): Value<dictionary, item> {
    return this.implementation(value).empty(value);
  },

  concat<
    dictionary extends Monoid<dictionary>,
    item,
  >(
    left: Value<dictionary, item>,
    right: Value<dictionary, item>,
  ): Value<dictionary, item> {
    return Semigroup.concat(left, right);
  },
});

export const functor_trait = Symbol("Functor");

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

export const Functor = define_trait(functor_trait, {
  map<
    dictionary extends Functor<dictionary>,
    from,
    to,
  >(
    value: Value<dictionary, from>,
    fn: (value: from) => to,
  ): Value<dictionary, to> {
    return this.implementation(value).map(value, fn);
  },
});

export const applicative_trait = Symbol("Applicative");

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

export const Applicative = define_trait(applicative_trait, {
  pure<
    dictionary extends Applicative<dictionary>,
    item,
  >(
    value: Value<dictionary, unknown>,
    item: item,
  ): Value<dictionary, item> {
    return this.implementation(value).pure(value, item);
  },

  ap<
    dictionary extends Applicative<dictionary>,
    from,
    to,
  >(
    value: Value<dictionary, (value: NoInfer<from>) => to>,
    item: Value<dictionary, from>,
  ): Value<dictionary, to> {
    return this.implementation(value).ap(value, item);
  },
});

export const alternative_trait = Symbol("Alternative");

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

export const Alternative = define_trait(alternative_trait, {
  empty<
    dictionary extends Alternative<dictionary>,
    item,
  >(
    value: Value<dictionary, unknown>,
  ): Value<dictionary, item> {
    return this.implementation(value).empty(value);
  },

  alt<
    dictionary extends Alternative<dictionary>,
    item,
  >(
    left: Value<dictionary, item>,
    right: Value<dictionary, item>,
  ): Value<dictionary, item> {
    return this.implementation(left).alt(left, right);
  },
});

export const monad_trait = Symbol("Monad");

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

export const Monad = define_trait(monad_trait, {
  bind<
    dictionary extends Monad<dictionary>,
    from,
    to,
  >(
    value: Value<dictionary, from>,
    fn: (value: from) => Value<dictionary, to>,
  ): Value<dictionary, to> {
    return this.implementation(value).bind(value, fn);
  },
});

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

export const foldable_trait = Symbol("Foldable");

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

export const Foldable = define_trait(foldable_trait, {
  fold<
    dictionary extends Foldable<dictionary>,
    item,
    out,
  >(
    value: Value<dictionary, item>,
    initial: out,
    fn: (state: out, item: item) => out,
  ): out {
    return this.implementation(value).fold(value, initial, fn);
  },
});

export const traversable_trait = Symbol("Traversable");

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

export const Traversable = define_trait(traversable_trait, {
  traverse<
    dictionary extends Traversable<dictionary>,
    applicative extends Applicative<applicative>,
    from,
    to,
  >(
    value: Value<dictionary, from>,
    applicative: Value<applicative, unknown>,
    fn: (value: from) => Value<applicative, to>,
  ): Value<applicative, Value<dictionary, to>> {
    return this.implementation(value).traverse(
      value,
      applicative,
      fn,
    );
  },

  sequence<
    dictionary extends Traversable<dictionary>,
    applicative extends Applicative<applicative>,
    item,
  >(
    value: Value<dictionary, Value<applicative, item>>,
    applicative: Value<applicative, unknown>,
  ): Value<applicative, Value<dictionary, item>> {
    return this.implementation(value).traverse(
      value,
      applicative,
      (value: Value<applicative, item>) => {
        return value;
      },
    );
  },
});
