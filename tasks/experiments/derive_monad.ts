/**
 * Experiment: Haskell-style default methods ("minimal complete definition").
 *
 * Goal: define a new monadic data type by providing ONLY `pure` and `bind`,
 * and derive Functor.map and Applicative.ap at install time, the way GHC
 * fills in default methods from a minimal definition.
 *
 * Run with:   deno run tasks/experiments/derive_monad.ts
 * Check with: deno check tasks/experiments/derive_monad.ts
 */

import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "../../src/typeclass.ts";
import {
  Applicative,
  Do,
  Functor,
  Monad,
  type Monad as MonadDictionary,
} from "../../src/typeclasses.ts";

/**
 * The minimal complete definition for a Monad: pure + bind.
 * Everything else (map, ap) has a lawful default in terms of these.
 */
type MinimalMonad<dictionary extends MonadDictionary<dictionary>> = {
  pure: <item>(this: dictionary, value: item) => Data<dictionary, item>;
  bind: <from, to>(
    this: Data<dictionary, from>,
    fn: (value: from) => Data<dictionary, to>,
  ) => Data<dictionary, to>;
};

/**
 * Install Functor, Applicative, and Monad instances from pure + bind.
 *
 *   map f   = bind (pure . f)
 *   ap mv   = bind (\f -> mv >>= (pure . f))
 */
function derive_monad<dictionary extends MonadDictionary<dictionary>>(
  dictionary: dictionary,
  minimal: MinimalMonad<dictionary>,
): void {
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
}

// --- A brand new data type defined with the minimal definition only ---

type Box<item> = readonly ["Box", item];

interface AsBox extends As<AsBox>, MonadDictionary<AsBox> {
  readonly [type_item]: unknown;
  readonly [type_data]: Box<this[typeof type_item]>;
}

const Box = data<AsBox>();

derive_monad(Box, {
  // NOTE: `this` is not callable inside instance methods (the receiver is the
  // wrapped value, not the dictionary function) — close over `Box` instead.
  pure(value) {
    return Box(["Box", value]);
  },

  bind(fn) {
    const [, payload] = this.value();
    return fn(payload);
  },
});

// --- Exercise every derived method, fluent and dictionary-passing style ---

const doubled = Box(["Box", 21]).map((value) => value * 2);
const applied = Box(["Box", (value: number) => value + 1]).ap(
  Box(["Box", 41]),
);
const bound = Box(["Box", 6]).bind((value) => Box(["Box", value * 7]));
const lifted = Applicative.lift(
  (a: number, b: number) => a + b,
  Box(["Box", 40]),
  Box(["Box", 2]),
);
const done = Do(Box, function* () {
  const a = yield* Box(["Box", 20]);
  const b = yield* Box(["Box", 22]);
  return a + b;
});

console.log("map:", doubled.value());
console.log("ap:", applied.value());
console.log("bind:", bound.value());
console.log("lift:", lifted.value());
console.log("Do:", done.value());
