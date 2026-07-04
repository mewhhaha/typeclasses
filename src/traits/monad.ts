import {
  call_trait_method,
  define_trait,
  type Dictionary,
  type TraitDictionary,
  type Value,
} from "../trait.ts";
import {
  Applicative,
  type Applicative as ApplicativeDictionary,
} from "./applicative.ts";

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
  ApplicativeDictionary<dictionary> {}

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
