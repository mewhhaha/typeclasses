import { assert_equals } from "./assert.ts";
import { Just, Maybe, type MaybeValue } from "./maybe.ts";
import {
  type As,
  call_typeclass_method,
  type Data,
  data,
  type Dictionary,
  type type_data,
  type type_item,
  typeclass,
  TypeclassDefinition,
  type TypeclassDictionary,
} from "./typeclass.ts";
import { Applicative, Functor, Monad, Show } from "./typeclasses.ts";

Deno.test("typeclass operations retain inference when destructured or passed as callbacks", () => {
  const { map } = Functor;
  const { pure, lift } = Applicative;
  const { bind } = Monad;
  const { show } = Show;
  const mapped: MaybeValue<string> = map(Just(42), (value) => value.toFixed(1));
  const bound: MaybeValue<number> = bind(Just(21), (value) => Just(value * 2));
  const lifted: MaybeValue<number> = lift(
    (left, right) => left + right,
    Just(20),
    Just(22),
  );
  const direct: MaybeValue<number> = pure(Maybe, 42);

  assert_equals(mapped.value(), ["Just", "42.0"]);
  assert_equals(bound.value(), ["Just", 42]);
  assert_equals(lifted.value(), ["Just", 42]);
  assert_equals(direct.value(), ["Just", 42]);
  assert_equals([Just(1), Just(2)].map(show), ["Just(1)", "Just(2)"]);
});

function shared_prototype_requires_a_definition(): void {
  const { instance_for } = TypeclassDefinition;
  // @ts-expect-error the unbound shared prototype has no selected token
  instance_for(Just(42));
}
void shared_prototype_requires_a_definition;

const size_token = Symbol("Detached size");
const doubled_size = Symbol("Doubled size");
declare const box_identity: unique symbol;

interface Size<dictionary extends Dictionary> extends
  TypeclassDictionary<
    dictionary,
    typeof size_token,
    { size<item>(this: Data<dictionary, item>): number }
  > {}

interface AsBox extends As<AsBox, typeof box_identity>, Size<AsBox> {
  readonly [type_item]: unknown;
  readonly [type_data]: readonly this[typeof type_item][];
}

const Size = typeclass(size_token, {
  context: Maybe,
  construct: Just,
  size<dictionary extends Size<dictionary>, item>(
    value: Data<dictionary, item>,
  ): number {
    return call_typeclass_method(this.instance_for(value).size<item>, value);
  },
  [doubled_size]<dictionary extends Size<dictionary>, item>(
    value: Data<dictionary, item>,
  ): number {
    return this.size(value) * 2;
  },
});

Deno.test("custom typeclasses support detached installation, lookup, and derived operations", () => {
  const Box = data<AsBox>();
  const { instance, instance_for, size, [doubled_size]: double } = Size;
  const methods = instance(Box)({
    size() {
      return this.value().length;
    },
  });
  const value = Box([1, 2, 3]);

  assert_equals(size(value), 3);
  assert_equals(double(value), 6);
  assert_equals(value.size(), 3);
  assert_equals(instance_for(value) === methods, true);
  assert_equals(instance_for(Box) === methods, true);
  assert_equals(Size.context === Maybe, true);
  assert_equals(Size.context.Just(42).value(), ["Just", 42]);
  assert_equals(Size.construct.is(Size.construct(42).value()), true);
});
