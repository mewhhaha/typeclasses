/**
 * Experiment: fluent, exhaustive `.match()` on wrapped tagged values.
 *
 * Today users either call the standalone `match(value, cases)` helper from
 * `src/tagged.ts` or hand-roll `const [tag, payload] = x.value(); switch`.
 * This experiment shows that a fluent `.match` can be installed on a data
 * dictionary (so every wrapped value inherits it through the prototype
 * chain, exactly like typeclass methods) and typed exhaustively from the
 * wrapped value's raw tuple type.
 *
 * Run with:   deno run tasks/experiments/fluent_match.ts
 * Check with: deno check tasks/experiments/fluent_match.ts
 */

import { Just, type MaybeValue, Maybe, Nothing } from "../../src/maybe.ts";
import { Either, Left, Right } from "../../src/either.ts";
import {
  match,
  type MatchCases,
  type MatchValue,
} from "../../src/tagged.ts";
import type { WrappedData } from "../../src/typeclass.ts";

// --- Type-level shape a built-in `.match` method would have ---------------

/**
 * What `WrappedDataBase` could expose: available only when the raw value is
 * a tagged tuple, typed exhaustively over its tags, with payload inference.
 */
type FluentMatch<value> = value extends MatchValue
  ? <out>(cases: MatchCases<value, out>) => out
  : never;

// --- Runtime: install `match` once on the dictionary ----------------------

function install_match(dictionary: object): void {
  Object.defineProperty(dictionary, "match", {
    value: function fluent_match(
      this: MatchValue,
      cases: MatchCases<MatchValue, unknown>,
    ): unknown {
      return match(this, cases);
    },
  });
}

install_match(Maybe);
install_match(Either);

// Cast helper standing in for the real typed method on WrappedData.
function with_match<dictionary, value, item>(
  data: WrappedData<dictionary, value, item>,
): WrappedData<dictionary, value, item> & { match: FluentMatch<value> } {
  return data as WrappedData<dictionary, value, item> & {
    match: FluentMatch<value>;
  };
}

// --- Exercise it -----------------------------------------------------------

const present: MaybeValue<number> = Just(41);
const absent: MaybeValue<number> = Nothing<number>();

const doubled = with_match(present).match({
  Just: (value) => value + 1,
  Nothing: () => 0,
});

const defaulted = with_match(absent).match({
  Just: (value) => value + 1,
  Nothing: () => 0,
});

const described = with_match(Right<string, number>(42).map((n) => n + 0))
  .match({
    Right: (value) => "got " + String(value),
    Left: (error) => "failed with " + error,
  });

const failed = with_match(Left<string, number>("missing")).match({
  Right: (value) => "got " + String(value),
  Left: (error) => "failed with " + error,
});

console.log("Just:", doubled);
console.log("Nothing:", defaulted);
console.log("Right:", described);
console.log("Left:", failed);

// --- Exhaustiveness check: omitting a case is a type error ----------------

// @ts-expect-error missing the Nothing case must not typecheck
with_match(present).match({ Just: (value: number) => value });
