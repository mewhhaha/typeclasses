// Rejected production experiment: representative eight-yield workloads did not
// meet the half-runtime target. Kept for reproducible comparisons only.
// Rejected production experiment: representative eight-yield workloads did not
// meet the half-runtime target. Kept for reproducible comparisons only.
import type { Data, Dictionary } from "../../src/typeclass.ts";
import type { DoGenerator, Monad } from "../../src/typeclasses/monad.ts";
import { monad_error_typeclass } from "../../src/typeclasses/monad_error.ts";
type DoInput = { readonly tag: "next" | "throw"; readonly value: unknown };
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
/** One-shot generator notation for dictionaries that resume each bind at most once.
 * Reusing a suspended continuation throws instead of replaying the generator.
 */
export function Do_once<dictionary extends Monad<dictionary>, result>(
  dictionary: Monad<dictionary>,
  run: () => DoGenerator<dictionary, result>,
): Data<dictionary, result>;
/** Infers the dictionary from the first yield. */
export function Do_once<dictionary extends Monad<dictionary>, result>(
  run: () => DoGenerator<dictionary, result>,
): Data<dictionary, result>;
export function Do_once<dictionary extends Monad<dictionary>, result>(
  dictionary_or_run: dictionary | (() => DoGenerator<dictionary, result>),
  explicit_run?: () => DoGenerator<dictionary, result>,
): Data<dictionary, result> {
  let dictionary: dictionary | undefined;
  let run: () => DoGenerator<dictionary, result>;
  if (explicit_run === undefined) {
    run = dictionary_or_run as () => DoGenerator<dictionary, result>;
  } else {
    dictionary = dictionary_or_run as dictionary;
    run = explicit_run;
  }
  const iterator = run();
  const first = iterator.next();
  if (first.done) {
    if (dictionary !== undefined) return dictionary.pure(first.value);
    throw new TypeError("Do_once requires at least one yielded value");
  }
  return step(first.value);

  function step(current: Data<dictionary, unknown>): Data<dictionary, result> {
    let resumed = false;
    const implementation = (current as Data<dictionary, unknown> & {
      [monad_error_typeclass]?: DoErrorMethods<dictionary>;
    })[monad_error_typeclass];
    function advance(
      value: unknown,
      failed: boolean,
    ): Data<dictionary, result> {
      if (resumed) {
        throw new TypeError("Do_once continuation resumed more than once");
      }
      resumed = true;
      let next: IteratorResult<Data<dictionary, unknown>, result>;
      try {
        if (failed) next = iterator.throw(value);
        else next = iterator.next(value);
      } catch (error) {
        if (implementation !== undefined) {
          return implementation.throw_error.call(current, error) as Data<
            dictionary,
            result
          >;
        }
        throw error;
      }
      if (next.done) return current.pure(next.value);
      return step(next.value);
    }
    if (implementation === undefined) {
      return current.bind((value) => advance(value, false));
    }
    const yielded = current.map((value): DoInput => ({ tag: "next", value }));
    const input = implementation.catch_error.call(
      yielded,
      (error) => current.pure<DoInput>({ tag: "throw", value: error }),
    );
    return input.bind((value) => {
      const input = value as DoInput;
      return advance(input.value, input.tag === "throw");
    });
  }
}
