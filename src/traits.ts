import {
  call_trait_method,
  define_trait,
  type Dictionary,
  type TraitDictionary,
  type Value,
} from "./trait.ts";

export const format_trait = Symbol("Format");

export interface Format<dictionary extends Dictionary> extends
  TraitDictionary<
    dictionary,
    typeof format_trait,
    {
      fmt: (this: Value<dictionary, unknown>) => string;
    }
  > {}

export const Format = define_trait(format_trait, {
  fmt<dictionary extends Format<dictionary>>(
    value: Value<dictionary, unknown>,
  ): string {
    return call_trait_method(this.implementation(value).fmt, value);
  },
});

export const equal_trait = Symbol("Equal");

export interface Equal<dictionary extends Dictionary> extends
  TraitDictionary<
    dictionary,
    typeof equal_trait,
    {
      eq: <item>(
        this: Value<dictionary, item>,
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
    return call_trait_method(this.implementation(left).eq<item>, left, right);
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
          this: Value<dictionary, item>,
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
    return call_trait_method(
      this.implementation(left).concat<item>,
      left,
      right,
    );
  },
});

export const monoid_trait = Symbol("Monoid");

export interface Monoid<dictionary extends Dictionary> extends
  TraitDictionary<
    dictionary,
    typeof monoid_trait,
    {
      empty: <item>(this: Value<dictionary, unknown>) => Value<
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
    return call_trait_method(this.implementation(value).empty<item>, value);
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
        this: Value<dictionary, from>,
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
    return call_trait_method(
      this.implementation(value).map<from, to>,
      value,
      fn,
    );
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
          this: Value<dictionary, unknown>,
          value: item,
        ) => Value<dictionary, item>;
        ap: <from, to>(
          this: Value<dictionary, (value: NoInfer<from>) => to>,
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
    return call_trait_method(
      this.implementation(value).pure<item>,
      value,
      item,
    );
  },

  lift: applicative_lift,

  ap<
    dictionary extends Applicative<dictionary>,
    from,
    to,
  >(
    value: Value<dictionary, (value: NoInfer<from>) => to>,
    item: Value<dictionary, from>,
  ): Value<dictionary, to> {
    return call_trait_method(
      this.implementation(value).ap<from, to>,
      value,
      item,
    );
  },
});

function applicative_lift<
  dictionary extends Applicative<dictionary>,
  first,
  out,
>(
  fn: (first: first) => out,
  first: Value<dictionary, first>,
): Value<dictionary, out>;
function applicative_lift<
  dictionary extends Applicative<dictionary>,
  first,
  second,
  out,
>(
  fn: (first: first, second: second) => out,
  first: Value<dictionary, first>,
  second: Value<dictionary, second>,
): Value<dictionary, out>;
function applicative_lift<
  dictionary extends Applicative<dictionary>,
  first,
  second,
  third,
  out,
>(
  fn: (first: first, second: second, third: third) => out,
  first: Value<dictionary, first>,
  second: Value<dictionary, second>,
  third: Value<dictionary, third>,
): Value<dictionary, out>;
function applicative_lift<
  dictionary extends Applicative<dictionary>,
  first,
  second,
  third,
  fourth,
  out,
>(
  fn: (first: first, second: second, third: third, fourth: fourth) => out,
  first: Value<dictionary, first>,
  second: Value<dictionary, second>,
  third: Value<dictionary, third>,
  fourth: Value<dictionary, fourth>,
): Value<dictionary, out>;
function applicative_lift<
  dictionary extends Applicative<dictionary>,
  first,
  second,
  third,
  fourth,
  fifth,
  out,
>(
  fn: (
    first: first,
    second: second,
    third: third,
    fourth: fourth,
    fifth: fifth,
  ) => out,
  first: Value<dictionary, first>,
  second: Value<dictionary, second>,
  third: Value<dictionary, third>,
  fourth: Value<dictionary, fourth>,
  fifth: Value<dictionary, fifth>,
): Value<dictionary, out>;
function applicative_lift<
  dictionary extends Applicative<dictionary>,
  out,
>(
  fn: (...values: unknown[]) => out,
  first: Value<dictionary, unknown>,
  ...rest: Value<dictionary, unknown>[]
): Value<dictionary, out>;
function applicative_lift<
  dictionary extends Applicative<dictionary>,
  out,
>(
  fn: (...values: unknown[]) => out,
  first: Value<dictionary, unknown>,
  ...rest: Value<dictionary, unknown>[]
): Value<dictionary, out> {
  const values = [first, ...rest];

  if (values.length === 1) {
    return values[0].map((value) => {
      return fn(value);
    });
  }

  if (values.length === 2) {
    const combined = values[0].map((left) => {
      return (right: unknown) => {
        return fn(left, right);
      };
    });

    return combined.ap(values[1]);
  }

  if (values.length === 3) {
    const combined = values[0].map((left) => {
      return (middle: unknown) => {
        return (right: unknown) => {
          return fn(left, middle, right);
        };
      };
    });

    return combined.ap(values[1]).ap(values[2]);
  }

  let combined = values[0].map((value) => [value] as unknown[]);

  for (let index = 1; index < values.length; index += 1) {
    const current = values[index];
    const append = combined.map((items) => {
      return (item: unknown) => append_item(items, item);
    });

    combined = append.ap(current);
  }

  return Functor.map(combined, (items) => {
    return fn(...items);
  });
}

function append_item(values: unknown[], item: unknown): unknown[] {
  const next = new Array<unknown>(values.length + 1);

  for (let index = 0; index < values.length; index += 1) {
    next[index] = values[index];
  }

  next[values.length] = item;

  return next;
}

export const alternative_trait = Symbol("Alternative");

export interface Alternative<dictionary extends Dictionary>
  extends
    TraitDictionary<
      dictionary,
      typeof alternative_trait,
      {
        empty: <item>(this: Value<dictionary, unknown>) => Value<
          dictionary,
          item
        >;
        alt: <item>(
          this: Value<dictionary, item>,
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
    return call_trait_method(this.implementation(value).empty<item>, value);
  },

  alt<
    dictionary extends Alternative<dictionary>,
    item,
  >(
    left: Value<dictionary, item>,
    right: Value<dictionary, item>,
  ): Value<dictionary, item> {
    return call_trait_method(this.implementation(left).alt<item>, left, right);
  },
});

export const monad_trait = Symbol("Monad");

export interface Monad<dictionary extends Dictionary> extends
  TraitDictionary<
    dictionary,
    typeof monad_trait,
    {
      bind: <from, to>(
        this: Value<dictionary, from>,
        fn: (value: from) => Value<dictionary, to>,
      ) => Value<dictionary, to>;
    }
  >,
  Applicative<dictionary> {}

type DoGenerator<
  dictionary extends Monad<dictionary>,
  out,
> = Generator<Value<dictionary, unknown>, out, unknown>;

type DoPath = {
  readonly previous: DoPath | undefined;
  readonly value: unknown;
  readonly length: number;
};

export const Monad = define_trait(monad_trait, {
  bind<
    dictionary extends Monad<dictionary>,
    from,
    to,
  >(
    value: Value<dictionary, from>,
    fn: (value: from) => Value<dictionary, to>,
  ): Value<dictionary, to> {
    return call_trait_method(
      this.implementation(value).bind<from, to>,
      value,
      fn,
    );
  },
});

export function Do<dictionary extends Monad<dictionary>, out>(
  run: () => DoGenerator<dictionary, out>,
): Value<dictionary, out> {
  const first = run_with(undefined);

  if (first.next.done) {
    throw new TypeError("Do requires at least one yielded value");
  }

  return step(undefined, first.next.value, first.iterator);

  function run_with(
    path: DoPath | undefined,
  ): {
    iterator: DoGenerator<dictionary, out>;
    next: IteratorResult<Value<dictionary, unknown>, out>;
  } {
    const iterator = run();
    let next = iterator.next();

    const values = values_from_path(path);

    for (const value of values) {
      if (next.done) {
        return { iterator, next };
      }

      next = iterator.next(value);
    }

    return { iterator, next };
  }

  function step(
    path: DoPath | undefined,
    current: Value<dictionary, unknown>,
    iterator: DoGenerator<dictionary, out>,
  ): Value<dictionary, out> {
    let calls = 0;

    return Monad.bind(current, (value) => {
      if (calls === 0) {
        calls += 1;
        const next = iterator.next(value);

        if (next.done) {
          return Applicative.pure(current, next.value);
        }

        const next_path = append_do_path(path, value);
        return step(next_path, next.value, iterator);
      }

      calls += 1;
      const next_path = append_do_path(path, value);
      const state = run_with(next_path);

      if (state.next.done) {
        return Applicative.pure(current, state.next.value);
      }

      return step(next_path, state.next.value, state.iterator);
    });
  }
}

function append_do_path(
  previous: DoPath | undefined,
  value: unknown,
): DoPath {
  return {
    previous,
    value,
    length: previous === undefined ? 1 : previous.length + 1,
  };
}

function values_from_path(path: DoPath | undefined): unknown[] {
  if (path === undefined) {
    return [];
  }

  const values = new Array<unknown>(path.length);
  let index = values.length - 1;

  for (
    let node: DoPath | undefined = path;
    node !== undefined;
    node = node.previous
  ) {
    values[index] = node.value;
    index -= 1;
  }

  return values;
}

export const foldable_trait = Symbol("Foldable");

export interface Foldable<dictionary extends Dictionary>
  extends
    TraitDictionary<
      dictionary,
      typeof foldable_trait,
      {
        fold: <item, out>(
          this: Value<dictionary, item>,
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
    return call_trait_method(
      this.implementation(value).fold<item, out>,
      value,
      initial,
      fn,
    );
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
          this: Value<dictionary, from>,
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
    return call_trait_method(
      this.implementation(value).traverse<applicative, from, to>,
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
    return call_trait_method(
      this.implementation(value)
        .traverse<applicative, Value<applicative, item>, item>,
      value,
      applicative,
      (value: Value<applicative, item>) => {
        return value;
      },
    );
  },
});
