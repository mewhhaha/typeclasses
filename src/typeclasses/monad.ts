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

/** Runtime token for the Monad typeclass. */
export const monad_typeclass = Symbol("Monad");

/** Applicative dictionary capability for context-dependent sequencing. */
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

/** @ignore */
export type MonadTypeclass =
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

/** @ignore */
export type DoGenerator<
  dictionary extends Monad<dictionary>,
  result,
> = Generator<Data<dictionary, unknown>, result, unknown>;

type DoPath = {
  readonly previous: DoPath | undefined;
  readonly value: unknown;
};

/** Operations for sequencing values through Monad dictionaries. */
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

/** Run generator-based monadic notation with an explicit dictionary. */
export function Do<dictionary extends Monad<dictionary>, result>(
  dictionary: Monad<dictionary>,
  run: () => DoGenerator<dictionary, result>,
): Data<dictionary, result>;
/** Run generator-based monadic notation inferred from the first yield. */
export function Do<dictionary extends Monad<dictionary>, result>(
  run: () => DoGenerator<dictionary, result>,
): Data<dictionary, result>;
/** Run generator-based monadic notation. */
export function Do<dictionary extends Monad<dictionary>, result>(
  dictionary_or_run: dictionary | (() => DoGenerator<dictionary, result>),
  explicit_run?: () => DoGenerator<dictionary, result>,
): Data<dictionary, result> {
  const dictionary = explicit_run === undefined
    ? undefined
    : dictionary_or_run as dictionary;
  const run = explicit_run === undefined
    ? dictionary_or_run as () => DoGenerator<dictionary, result>
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
    iterator: DoGenerator<dictionary, result>;
    next: IteratorResult<Data<dictionary, unknown>, result>;
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
    iterator: DoGenerator<dictionary, result>,
  ): Data<dictionary, result> {
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
    failed: Data<dictionary, result>,
    path: DoPath | undefined,
    witness: Data<dictionary, unknown>,
    iterator: DoGenerator<dictionary, result>,
  ): Data<dictionary, result> {
    const catchable = failed as Data<dictionary, result> & {
      [monad_error_typeclass]?: {
        catch_error: (
          this: Data<dictionary, result>,
          handler: (error: unknown) => Data<dictionary, result>,
        ) => Data<dictionary, result>;
      };
    };
    const implementation = catchable[monad_error_typeclass];

    if (implementation === undefined) {
      return failed;
    }

    return implementation.catch_error.call(failed, (error) => {
      let next: IteratorResult<Data<dictionary, unknown>, result>;

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
