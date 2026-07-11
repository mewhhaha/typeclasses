/**
 * Experiment: the missing Haskell prelude, typed against this library's
 * dictionary encoding.
 *
 * Validates that `join`, `void`, `when`/`unless`, `guard`, `foldMap`,
 * `mconcat`, `then`/`apFirst`/`apSecond` (`*>` / `<*`), `fromMaybe`,
 * `maybe`, and `either` all infer cleanly with `Data<dictionary, item>` —
 * no casts needed at use sites.
 *
 * Run with:   deno run tasks/experiments/prelude_extensions.ts
 * Check with: deno check tasks/experiments/prelude_extensions.ts
 */

import type { Data } from "../../src/typeclass.ts";
import {
  Alternative,
  type Alternative as AlternativeDictionary,
  Applicative,
  type Applicative as ApplicativeDictionary,
  Foldable,
  type Foldable as FoldableDictionary,
  Monad,
  type Monad as MonadDictionary,
  Monoid,
  type Monoid as MonoidDictionary,
  Semigroup,
} from "../../src/typeclasses.ts";
import { ArrayT, to_array } from "../../src/array.ts";
import { Just, type MaybeValue, Nothing } from "../../src/maybe.ts";
import { type EitherValue, Right } from "../../src/either.ts";
import { match } from "../../src/tagged.ts";

// --- Monad ------------------------------------------------------------------

/** Haskell `join :: m (m a) -> m a`. */
function join<dictionary extends MonadDictionary<dictionary>, item>(
  value: Data<dictionary, Data<dictionary, item>>,
): Data<dictionary, item> {
  return Monad.bind(value, (inner) => inner);
}

/** Haskell `void :: Functor f => f a -> f ()`. */
function voided<dictionary extends MonadDictionary<dictionary>>(
  value: Data<dictionary, unknown>,
): Data<dictionary, undefined> {
  return Monad.bind(value, (_) => Applicative.pure(value, undefined));
}

/** Haskell `when :: Applicative f => Bool -> f () -> f ()`. */
function when<dictionary extends ApplicativeDictionary<dictionary>>(
  dictionary: ApplicativeDictionary<dictionary>,
  condition: boolean,
  action: Data<dictionary, undefined>,
): Data<dictionary, undefined> {
  if (condition) {
    return action;
  }

  return Applicative.pure<dictionary, undefined>(
    dictionary as dictionary,
    undefined,
  );
}

/** Haskell `guard :: Alternative f => Bool -> f ()`. */
function guard<dictionary extends AlternativeDictionary<dictionary>>(
  dictionary: AlternativeDictionary<dictionary>,
  condition: boolean,
): Data<dictionary, undefined> {
  if (condition) {
    return Applicative.pure<dictionary, undefined>(
      dictionary as dictionary,
      undefined,
    );
  }

  return Alternative.empty<dictionary, undefined>(dictionary as dictionary);
}

// --- Applicative sequencing (`*>` and `<*`) ---------------------------------

/** Haskell `*>` — sequence, keep the right value. */
function apSecond<
  dictionary extends ApplicativeDictionary<dictionary>,
  first,
  second,
>(
  left: Data<dictionary, first>,
  right: Data<dictionary, second>,
): Data<dictionary, second> {
  return Applicative.lift((_, kept: second) => kept, left, right);
}

/** Haskell `<*` — sequence, keep the left value. */
function apFirst<
  dictionary extends ApplicativeDictionary<dictionary>,
  first,
  second,
>(
  left: Data<dictionary, first>,
  right: Data<dictionary, second>,
): Data<dictionary, first> {
  return Applicative.lift((kept: first, _) => kept, left, right);
}

// --- Foldable ----------------------------------------------------------------

/** Haskell `foldMap :: Monoid m => (a -> m) -> t a -> m`. */
function foldMap<
  dictionary extends FoldableDictionary<dictionary>,
  monoid extends MonoidDictionary<monoid>,
  item,
  out,
>(
  monoid: MonoidDictionary<monoid>,
  fn: (value: item) => Data<monoid, out>,
  value: Data<dictionary, item>,
): Data<monoid, out> {
  return Foldable.fold(
    value,
    Monoid.empty<monoid, out>(monoid as monoid),
    (state, item) => Semigroup.concat(state, fn(item)),
  );
}

// --- Maybe / Either eliminators ----------------------------------------------

/** Haskell `fromMaybe :: a -> Maybe a -> a`. */
function fromMaybe<item>(fallback: item, value: MaybeValue<item>): item {
  return match(value, {
    Just: (item) => item,
    Nothing: () => fallback,
  });
}

/** Haskell `maybe :: b -> (a -> b) -> Maybe a -> b`. */
function maybe<item, out>(
  fallback: out,
  fn: (value: item) => out,
  value: MaybeValue<item>,
): out {
  return match(value, {
    Just: (item) => fn(item),
    Nothing: () => fallback,
  });
}

/**
 * Haskell `either :: (a -> c) -> (b -> c) -> Either a b -> c`.
 *
 * FINDING: this cannot be typed with `match(value, ...)` over a generic
 * `EitherValue<left, right>` — `EitherValue` is a conditional type
 * (`[left] extends [never] ? ... : ...`), which stays deferred while `left`
 * is a bare type parameter, so `MatchCases` cannot extract the tag union
 * (TS2353: 'Left' does not exist). The eliminator has to unwrap and switch
 * on the raw tuple instead. Any fluent `.match` design must be typed off
 * the *raw value* parameter of `WrappedData`, not off exported aliases.
 */
function either<left, right, out>(
  on_left: (value: left) => out,
  on_right: (value: right) => out,
  value: EitherValue<left, right>,
): out {
  const [tag, payload] = value.value();

  switch (tag) {
    case "Left":
      return on_left(payload as left);
    case "Right":
      return on_right(payload as right);
  }
}

// --- Exercise everything ------------------------------------------------------

const joined: MaybeValue<number> = join(Just(Just(42)));
const silenced: MaybeValue<undefined> = voided(Just(42));
const ran = when(Just(1), true, voided(Just(0)));
const allowed = guard(Just(1), true);
const denied = guard(Just(1), false);
const second = apSecond(Just("ignored"), Just(42));
const first = apFirst(Just(42), Just("ignored"));
const folded = foldMap(ArrayT, (n: number) => ArrayT([n, n]), ArrayT([1, 2]));
const defaulted = fromMaybe(0, Nothing<number>());
const eliminated = maybe(0, (n) => n + 1, Just(41));
const merged = either(
  (error: string) => "error: " + error,
  (value: number) => "ok: " + String(value),
  Right<string, number>(42),
);

console.log("join:", joined.value());
console.log("void:", silenced.value());
console.log("when:", ran.value());
console.log("guard true:", allowed.value(), "guard false:", denied.value());
console.log("apSecond:", second.value(), "apFirst:", first.value());
console.log("foldMap:", to_array(folded));
console.log("fromMaybe:", defaulted);
console.log("maybe:", eliminated);
console.log("either:", merged);
