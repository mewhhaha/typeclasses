import { ArrayT, to_array } from "../src/array.ts";
import { assert_equals } from "../src/assert.ts";
import { Left, Right } from "../src/either.ts";
import { Just, Nothing } from "../src/maybe.ts";
import { Alternative, Traversable } from "../src/typeclasses.ts";

export function lesson_13_alternative_and_traversable() {
  const fallback = Alternative.alt(Nothing<number>(), Just(42));
  const combined = Alternative.alt(
    ArrayT([1, 2]),
    ArrayT([3]),
  );
  const parsed = Traversable.traverse(
    ArrayT(["1", "2", "x"]),
    Right(undefined),
    parse_int,
  );

  assert_equals(fallback.value(), Just(42).value());
  assert_equals(to_array(combined), [1, 2, 3]);
  assert_equals(parsed.value(), Left("expected integer: x").value());
}

function parse_int(text: string) {
  const value = Number.parseInt(text, 10);

  if (Number.isFinite(value)) {
    return Right(value);
  }

  return Left("expected integer: " + text);
}
