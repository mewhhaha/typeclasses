import {
  type Data,
  type Dictionary,
  type Typeclass,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";
import {
  Applicative,
  type Applicative as ApplicativeDictionary,
} from "./applicative.ts";
import { Functor } from "./functor.ts";
import { monad_error_typeclass } from "./monad_error.ts";

export const monad_typeclass = Symbol("Monad");

export interface Monad<dictionary extends Dictionary>
  extends
    TypeclassDictionary<
      dictionary,
      typeof monad_typeclass,
      {
        bind: <from, to>(
          this: Data<dictionary, from>,
          fn: (value: from) => Data<dictionary, to>,
        ) => Data<dictionary, to>;
      }
    >,
    ApplicativeDictionary<dictionary> {}

/** The minimal complete definition of a Monad instance. */
export type MinimalMonad<dictionary extends Monad<dictionary>> = {
  pure: <item>(this: dictionary, value: item) => Data<dictionary, item>;
  bind: <from, to>(
    this: Data<dictionary, from>,
    fn: (value: from) => Data<dictionary, to>,
  ) => Data<dictionary, to>;
};

type MonadTypeclass =
  & Typeclass<typeof monad_typeclass, {
    bind<dictionary extends Monad<dictionary>, from, to>(
      value: Data<dictionary, from>,
      fn: (value: from) => Data<dictionary, to>,
    ): Data<dictionary, to>;
  }>
  & {
    derive<dictionary extends Monad<dictionary>>(
      dictionary: dictionary,
    ): (minimal: MinimalMonad<dictionary>) => void;
  };

type DoGenerator<
  dictionary extends Monad<dictionary>,
  out,
> = Generator<Data<dictionary, unknown>, out, unknown>;

type DoPath = {
  readonly previous: DoPath | undefined;
  readonly value: unknown;
};

export const Monad: MonadTypeclass = typeclass(monad_typeclass, {
  derive<dictionary extends Monad<dictionary>>(
    dictionary: dictionary,
  ): (minimal: MinimalMonad<dictionary>) => void {
    return (minimal) => {
      Monad.instance(dictionary)({
        bind: minimal.bind,
      });

      Functor.instance(dictionary)({
        map<from, to>(
          this: Data<dictionary, from>,
          fn: (value: from) => to,
        ): Data<dictionary, to> {
          return this.bind((value) => this.pure(fn(value)));
        },
      });

      Applicative.instance(dictionary)({
        pure: minimal.pure,
        ap<from, to>(
          this: Data<dictionary, (value: NoInfer<from>) => to>,
          value: Data<dictionary, from>,
        ): Data<dictionary, to> {
          return this.bind((fn) => value.bind((item) => this.pure(fn(item))));
        },
      });
    };
  },

  bind<
    dictionary extends Monad<dictionary>,
    from,
    to,
  >(
    value: Data<dictionary, from>,
    fn: (value: from) => Data<dictionary, to>,
  ): Data<dictionary, to> {
    const bind = value[monad_typeclass].bind as (
      this: Data<dictionary, from>,
      fn: (value: from) => Data<dictionary, to>,
    ) => Data<dictionary, to>;

    return bind.call(value, fn);
  },
});

export function Do<dictionary extends Monad<dictionary>, out>(
  dictionary: Monad<dictionary>,
  run: () => DoGenerator<dictionary, out>,
): Data<dictionary, out>;
export function Do<dictionary extends Monad<dictionary>, out>(
  run: () => DoGenerator<dictionary, out>,
): Data<dictionary, out>;
export function Do<dictionary extends Monad<dictionary>, out>(
  dictionary_or_run: dictionary | (() => DoGenerator<dictionary, out>),
  explicit_run?: () => DoGenerator<dictionary, out>,
): Data<dictionary, out> {
  const dictionary = explicit_run === undefined
    ? undefined
    : dictionary_or_run as dictionary;
  const run = explicit_run === undefined
    ? dictionary_or_run as () => DoGenerator<dictionary, out>
    : explicit_run;
  const first = run_with(undefined);

  if (first.next.done) {
    if (dictionary !== undefined) {
      return dictionary.pure(first.next.value);
    }

    throw new TypeError("Do requires at least one yielded value");
  }

  return step(undefined, first.next.value, first.iterator);

  function run_with(
    path: DoPath | undefined,
  ): {
    iterator: DoGenerator<dictionary, out>;
    next: IteratorResult<Data<dictionary, unknown>, out>;
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
    current: Data<dictionary, unknown>,
    iterator: DoGenerator<dictionary, out>,
  ): Data<dictionary, out> {
    let calls = 0;

    const bound = current.bind((value) => {
      if (calls === 0) {
        calls += 1;
        const next = iterator.next(value);

        if (next.done) {
          return current.pure(next.value);
        }

        const next_path = append_do_path(path, value);
        return step(next_path, next.value, iterator);
      }

      calls += 1;
      const next_path = append_do_path(path, value);
      const state = run_with(next_path);

      if (state.next.done) {
        return current.pure(state.next.value);
      }

      return step(next_path, state.next.value, state.iterator);
    });

    return catch_generator_error(bound, path, current, iterator);
  }

  function catch_generator_error(
    failed: Data<dictionary, out>,
    path: DoPath | undefined,
    witness: Data<dictionary, unknown>,
    iterator: DoGenerator<dictionary, out>,
  ): Data<dictionary, out> {
    const catchable = failed as Data<dictionary, out> & {
      [monad_error_typeclass]?: {
        catch_error: (
          this: Data<dictionary, out>,
          handler: (error: unknown) => Data<dictionary, out>,
        ) => Data<dictionary, out>;
      };
    };
    const implementation = catchable[monad_error_typeclass];

    if (implementation === undefined) {
      return failed;
    }

    return implementation.catch_error.call(failed, (error) => {
      let next: IteratorResult<Data<dictionary, unknown>, out>;

      try {
        next = iterator.throw(error);
      } catch (thrown) {
        if (thrown === error) {
          return failed;
        }

        throw thrown;
      }

      if (next.done) {
        return witness.pure(next.value);
      }

      return step(path, next.value, iterator);
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
  };
}

function values_from_path(path: DoPath | undefined): unknown[] {
  if (path === undefined) {
    return [];
  }

  const values = new Array<unknown>(do_path_length(path));
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

function do_path_length(path: DoPath): number {
  let length = 0;

  for (
    let node: DoPath | undefined = path;
    node !== undefined;
    node = node.previous
  ) {
    length += 1;
  }

  return length;
}
