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
export const monad_typeclass = /* @__PURE__ */ Symbol("Monad");

type FastDoSpec = readonly [
  mode: 0 | 1 | 2,
  wrap: (value: unknown) => unknown,
  fail: ((error: unknown) => unknown) | undefined,
  bind: unknown,
  pure: unknown,
  map: unknown,
  err: unknown,
];

/** @ignore Internal fast iterative runner metadata for single-shot synchronous monads. */
export const do_runner_method: unique symbol = /* @__PURE__ */ Symbol(
  "Monad.do_runner",
);

/** @ignore Registers a canonical single-shot monad for iterative Do execution. */
export function register_fast_do(
  dictionary: object,
  mode: 0 | 1 | 2,
  wrap: (value: unknown) => unknown,
  fail?: (error: unknown) => unknown,
): void {
  const t = dictionary as Record<PropertyKey, unknown>;
  Object.defineProperty(dictionary, do_runner_method, {
    value: [
      mode,
      wrap,
      fail,
      t.bind,
      t.pure,
      mode === 1 ? t.map : undefined,
      mode === 1 ? t[monad_error_typeclass] : undefined,
    ] satisfies FastDoSpec,
  });
}

function push_do_path(
  previous: DoPath | undefined,
  thrown: boolean,
  value: unknown,
): DoPath {
  return { previous, thrown, value };
}

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
      dictionary: Monad<dictionary>,
    ): (minimal: MinimalMonad<dictionary>) => void;
  };

/** @ignore */
export type DoGenerator<
  dictionary extends Monad<dictionary>,
  result,
> = Generator<Data<dictionary, unknown>, result, unknown>;

type DoInput = {
  readonly tag: "next" | "throw";
  readonly value: unknown;
};

type DoPath = {
  readonly previous: DoPath | undefined;
  readonly thrown: boolean;
  readonly value: unknown;
};

type DoErrorMethods<dictionary extends Dictionary> = {
  catch_error<item>(
    this: Data<dictionary, item>,
    handler: (error: unknown) => Data<dictionary, item>,
  ): Data<dictionary, item>;
  throw_error<item>(
    this: Data<dictionary, unknown>,
    error: unknown,
  ): Data<dictionary, item>;
};

/** Operations for sequencing values through Monad dictionaries. */
export const Monad: MonadTypeclass = /* @__PURE__ */ typeclass(
  monad_typeclass,
  {
    derive<dictionary extends Monad<dictionary>>(
      dictionary: Monad<dictionary>,
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
  },
);

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
  const first_iterator = run();
  const first_next = first_iterator.next();

  if (first_next.done) {
    if (dictionary !== undefined) {
      return dictionary.pure(first_next.value);
    }

    throw new TypeError("Do requires at least one yielded value");
  }

  const spec = (first_next.value as {
    readonly [do_runner_method]?: FastDoSpec;
  })?.[do_runner_method];
  if (spec !== undefined) {
    const [mode, wrap, fail, c_bind, c_pure, c_map, c_err] = spec;
    let current = first_next.value;
    let path: DoPath | undefined;
    while (true) {
      if (
        current.bind !== c_bind ||
        (mode === 1 &&
          (current.map !== c_map || current.pure !== c_pure ||
            (current as unknown as Record<symbol, unknown>)[
                monad_error_typeclass
              ] !== c_err))
      ) return step(path, current, first_iterator);
      const raw = current.value() as readonly [string, unknown];
      if (mode === 0 && raw[0] === "Nothing") {
        return current as unknown as Data<dictionary, result>;
      }
      const thrown = mode === 1 && raw[0] === "Left";
      const payload = mode === 2 ? raw : raw[1];
      let next: IteratorResult<Data<dictionary, unknown>, result>;
      if (mode === 1) {
        try {
          next = thrown
            ? first_iterator.throw(payload)
            : first_iterator.next(payload);
        } catch (error) {
          return fail!(error) as Data<dictionary, result>;
        }
      } else next = first_iterator.next(payload);
      if (next.done) {
        return (current.pure === c_pure
          ? wrap(next.value)
          : current.pure(next.value)) as Data<dictionary, result>;
      }
      path = push_do_path(path, thrown, payload);
      current = next.value;
    }
  }

  return step(undefined, first_next.value, first_iterator);

  function replay(
    path: DoPath,
  ): {
    iterator: DoGenerator<dictionary, result>;
    next: IteratorResult<Data<dictionary, unknown>, result>;
  } {
    const iterator = run();
    let next = iterator.next();

    const nodes = nodes_from_path(path);

    for (let index = 0; index < nodes.length; index += 1) {
      if (next.done) {
        return { iterator, next };
      }

      const node = nodes[index];
      next = node.thrown
        ? iterator.throw(node.value)
        : iterator.next(node.value);
    }

    return { iterator, next };
  }

  function step(
    path: DoPath | undefined,
    current: Data<dictionary, unknown>,
    iterator: DoGenerator<dictionary, result>,
  ): Data<dictionary, result> {
    let calls = 0;
    const implementation = (current as Data<dictionary, unknown> & {
      [monad_error_typeclass]?: DoErrorMethods<dictionary>;
    })[monad_error_typeclass];

    function advance(
      thrown: boolean,
      value: unknown,
    ): Data<dictionary, result> {
      let next_path: DoPath | undefined;
      let next_iterator = iterator;
      let next_result: IteratorResult<Data<dictionary, unknown>, result>;
      try {
        if (calls++ === 0) {
          next_result = thrown ? iterator.throw(value) : iterator.next(value);
        } else {
          const replayed = replay(
            next_path = push_do_path(path, thrown, value),
          );
          next_iterator = replayed.iterator;
          next_result = replayed.next;
        }
      } catch (error) {
        if (implementation !== undefined) {
          return implementation.throw_error.call(current, error) as Data<
            dictionary,
            result
          >;
        }
        throw error;
      }
      return next_result.done ? current.pure(next_result.value) : step(
        next_path ?? push_do_path(path, thrown, value),
        next_result.value,
        next_iterator,
      );
    }

    if (implementation === undefined) {
      return current.bind((value) => advance(false, value));
    }

    // Catch only this yield, before binding the rest of the program. Otherwise
    // every enclosing step catches a descendant failure and resumes it again.
    const yielded = current.map((value): DoInput => ({ tag: "next", value }));
    const input = implementation.catch_error.call(
      yielded,
      (error) => current.pure<DoInput>({ tag: "throw", value: error }),
    );
    return input.bind((value) => {
      const boxed = value as DoInput;
      return advance(boxed.tag === "throw", boxed.value);
    });
  }
}

function nodes_from_path(path: DoPath): DoPath[] {
  const nodes: DoPath[] = [];
  for (
    let node: DoPath | undefined = path;
    node !== undefined;
    node = node.previous
  ) {
    nodes.push(node);
  }
  return nodes.reverse();
}
