import { ArrayT, to_array } from "../src/array.ts";
import { assert_equals } from "../src/assert.ts";
import { left, right } from "../src/either.ts";
import { just, nothing } from "../src/maybe.ts";
import { Alternative, Traversable } from "../src/typeclasses.ts";

export function lesson_13_alternative_and_traversable() {
  const fallback = Alternative.alt(nothing<number>(), just(42));
  const combined = Alternative.alt(
    ArrayT([1, 2]),
    ArrayT([3]),
  );
  const parsed = Traversable.traverse(
    ArrayT(["1", "2", "x"]),
    right(undefined),
    parse_int,
  );

  assert_equals(fallback.value(), just(42).value());
  assert_equals(to_array(combined), [1, 2, 3]);
  assert_equals(parsed.value(), left("expected integer: x").value());
}

function parse_int(text: string) {
  const value = Number.parseInt(text, 10);

  if (Number.isFinite(value)) {
    return right(value);
  }

  return left("expected integer: " + text);
}
