import { assert_equals } from "./assert.ts";
import {
  $slot,
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
  union,
} from "./typeclass.ts";
import {
  Applicative,
  type Applicative as ApplicativeDictionary,
  compare_unknown,
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

Deno.test("Monad.derive infers a tagged dictionary without constructor metadata", () => {
  const TaggedBox = Object.assign(data<AsBox>(union(["Box", $slot])), {
    description: "tagged monad",
  });
  const { derive } = Monad;

  derive(TaggedBox)({
    pure: TaggedBox.Box,
    bind(fn) {
      // @ts-expect-error constructor metadata does not change the value dictionary
      void this.description;
      // @ts-expect-error generated constructors do not change the value dictionary
      void this.Box;
      return fn(this.value()[1]);
    },
  });

  const mapped: Data<AsBox, number> = TaggedBox.Box(21)
    .map((value) => value * 2);
  const direct: Data<AsBox, number> = Applicative.pure(TaggedBox, 42);
  assert_equals(mapped.value(), ["Box", 42]);
  assert_equals(direct.value(), ["Box", 42]);

  // Explicit dictionary arguments remain accepted for existing applications.
  derive<AsBox>(TaggedBox)({
    pure: TaggedBox.Box,
    bind(fn) {
      return fn(this.value()[1]);
    },
  });
  assert_equals(
    TaggedBox.Box(20).bind((value) => TaggedBox.Box(value + 22)).value(),
    [
      "Box",
      42,
    ],
  );
});

Deno.test("Applicative.derive infers a tagged dictionary without constructor metadata", () => {
  const TaggedBox = Object.assign(data<AsApBox>(union(["Box", $slot])), {
    description: "tagged applicative",
  });

  Applicative.derive(TaggedBox)({
    pure: TaggedBox.Box,
    ap(value) {
      // @ts-expect-error constructor metadata does not change the value dictionary
      void this.description;
      const fn = this.value()[1];
      return TaggedBox.Box(fn(value.value()[1]));
    },
  });

  const mapped: Data<AsApBox, string> = TaggedBox.Box(42)
    .map((value) => value.toFixed(1));
  assert_equals(mapped.value(), ["Box", "42.0"]);
  assert_equals(
    TaggedBox.Box((value: number) => value + 1).ap(TaggedBox.Box(41)).value(),
    ["Box", 42],
  );

  Applicative.derive<AsApBox>(TaggedBox)({
    pure: TaggedBox.Box,
    ap(value) {
      return TaggedBox.Box(this.value()[1](value.value()[1]));
    },
  });
  assert_equals(Applicative.pure(TaggedBox, 42).value(), ["Box", 42]);
});

Deno.test("Ord.derive infers a tagged dictionary without constructor metadata", () => {
  const TaggedBox = Object.assign(data<AsOrdBox>(union(["Box", $slot])), {
    description: "tagged order",
  });

  Ord.derive(TaggedBox)({
    compare(right) {
      // @ts-expect-error generated constructors do not change the value dictionary
      void this.Box;
      return compare_unknown(this.value()[1], right.value()[1]);
    },
  });
  assert_equals(Eq.eq(TaggedBox.Box(42), TaggedBox.Box(42)), true);
  assert_equals(Ord.lt(TaggedBox.Box(20), TaggedBox.Box(22)), true);

  Ord.derive<AsOrdBox>(TaggedBox)({
    compare(right) {
      return compare_unknown(this.value()[1], right.value()[1]);
    },
  });
  const maximum: Data<AsOrdBox, number> = Ord.max(
    TaggedBox.Box(20),
    TaggedBox.Box(42),
  );
  assert_equals(maximum.value(), ["Box", 42]);
});
