import { assert_equals } from "./assert.ts";
import {
  $slot,
  type As,
  data,
  type type_data,
  type type_item,
  union,
} from "./typeclass.ts";

type Tiny<item> =
  | readonly ["One", item]
  | readonly ["None"];

interface AsTiny extends As<AsTiny> {
  readonly [type_item]: unknown;
  readonly [type_data]: Tiny<this[typeof type_item]>;
}

Deno.test("union definitions use the tagged tuple shape", () => {
  const Tiny = data<AsTiny>(union(["One", $slot], ["None"]));
  const value: Tiny<number> = ["One", 1];

  assert_equals(Tiny.One(1).value(), ["One", 1]);
  assert_equals(Tiny.None().value(), ["None"]);
  assert_equals(Object.is(Tiny.None(), Tiny.None()), true);
  assert_equals(Object.is(Tiny.None().value(), Tiny.None().value()), true);

  if (Tiny.is_One(value)) {
    assert_equals(value[1], 1);
  }

  assert_equals(Tiny.is_None(["None"]), true);
});

function check_union_definition_types(): void {
  // @ts-expect-error One needs one payload slot.
  data<AsTiny>(union(["One"], ["None"]));

  // @ts-expect-error variant tuple must start with the matching tag.
  data<AsTiny>(union(["None", $slot], ["None"]));

  // @ts-expect-error extra variants are not part of the data type.
  data<AsTiny>(union(["One", $slot], ["None"], ["Extra"]));

  // @ts-expect-error every variant in the data type must be listed.
  data<AsTiny>(union(["One", $slot]));
}

void check_union_definition_types;
