import { assert_equals } from "./assert.ts";
import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import {
  Applicative,
  type Applicative as ApplicativeDictionary,
  Do,
  Eq,
  Functor,
  Monad,
  type Monad as MonadDictionary,
  Ord,
  type Ord as OrdDictionary,
} from "./typeclasses.ts";

type Box<item> = readonly ["Box", item];

declare const box_identity: unique symbol;

interface AsBox extends As<AsBox, typeof box_identity>, MonadDictionary<AsBox> {
  readonly [type_item]: unknown;
  readonly [type_data]: Box<this[typeof type_item]>;
}

const Box = data<AsBox>();

Monad.derive(Box)({
  pure(value) {
    return Box(["Box", value]);
  },

  bind(fn) {
    const [, value] = this.value();
    return fn(value);
  },
});

function box_value<item>(value: Data<AsBox, item>): Box<item> {
  return value.value();
}

Deno.test("Monad.derive installs lawful Functor and Applicative defaults", () => {
  assert_equals(box_value(Box(["Box", 21]).map((value) => value * 2)), [
    "Box",
    42,
  ]);
  assert_equals(
    box_value(
      Box(["Box", (value: number) => value + 1]).ap(Box(["Box", 41])),
    ),
    ["Box", 42],
  );
  assert_equals(
    box_value(Box(["Box", 6]).bind((value) => Box(["Box", value * 7]))),
    ["Box", 42],
  );

  assert_equals(
    box_value(Functor.map(Box(["Box", 20]), (value) => value + 22)),
    ["Box", 42],
  );
  assert_equals(
    box_value(
      Applicative.ap(
        Applicative.pure(Box, (value: number) => value * 2),
        Applicative.pure(Box, 21),
      ),
    ),
    ["Box", 42],
  );
  assert_equals(
    box_value(
      Monad.bind(Box(["Box", 20]), (value) => Box(["Box", value + 22])),
    ),
    ["Box", 42],
  );
  assert_equals(
    box_value(
      Applicative.lift(
        (left: number, right: number) => left + right,
        Box(["Box", 20]),
        Box(["Box", 22]),
      ),
    ),
    ["Box", 42],
  );
  assert_equals(
    box_value(Do(Box, function* () {
      const left = yield* Box(["Box", 20]);
      const right = yield* Box(["Box", 22]);
      return left + right;
    })),
    ["Box", 42],
  );
});

declare const ap_box_identity: unique symbol;

interface AsApBox
  extends As<AsApBox, typeof ap_box_identity>, ApplicativeDictionary<AsApBox> {
  readonly [type_item]: unknown;
  readonly [type_data]: Box<this[typeof type_item]>;
}

const ApBox = data<AsApBox>();

Applicative.derive(ApBox)({
  pure(value) {
    return ApBox(["Box", value]);
  },

  ap(value) {
    const [, fn] = this.value();
    const [, item] = value.value();
    return ApBox(["Box", fn(item)]);
  },
});

Deno.test("Applicative.derive installs its Functor default", () => {
  assert_equals(
    ApBox(["Box", 20]).map((value) => value + 22).value(),
    ["Box", 42],
  );
  assert_equals(
    Functor.map(ApBox(["Box", 21]), (value) => value * 2).value(),
    ["Box", 42],
  );
});

declare const ord_box_identity: unique symbol;

interface AsOrdBox
  extends As<AsOrdBox, typeof ord_box_identity>, OrdDictionary<AsOrdBox> {
  readonly [type_item]: unknown;
  readonly [type_data]: Box<this[typeof type_item]>;
}

const OrdBox = data<AsOrdBox>();

Ord.derive(OrdBox)({
  compare(right) {
    const [, left_value] = this.value();
    const [, right_value] = right.value();

    if (left_value < right_value) {
      return "lt";
    }

    if (left_value > right_value) {
      return "gt";
    }

    return "eq";
  },
});

Deno.test("Ord.derive installs Eq from compare", () => {
  assert_equals(Eq.eq(OrdBox(["Box", 42]), OrdBox(["Box", 42])), true);
  assert_equals(Ord.lt(OrdBox(["Box", 20]), OrdBox(["Box", 22])), true);
});
