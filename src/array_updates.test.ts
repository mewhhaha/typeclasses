import { map_in_place, map_into } from "./array.ts";
import { assert_equals, assert_true } from "./assert.ts";

Deno.test("in-place array mapping updates aliases, skips holes, and captures the initial length", () => {
  const items = [1, , 3] as number[];
  const alias = items;
  const visited: number[] = [];
  map_in_place(items, (item, index) => {
    visited.push(index);
    if (index === 0) items.push(99);
    return item * 2;
  });
  assert_true(
    items === alias,
    "in-place mapping must retain the array identity",
  );
  assert_equals(alias, [2, , 6, 99]);
  assert_equals(visited, [0, 2]);
  assert_equals(1 in alias, false);
});

Deno.test("mapping into an array reuses and resizes the destination while removing stale holes", () => {
  const source = ["1", , "3"] as string[];
  const destination = [9, 9, 9, 9];
  const alias = destination;
  map_into(source, destination, (item) => Number(item));
  assert_true(destination === alias, "mapping must retain the output buffer");
  assert_equals(destination, [1, , 3]);
  assert_equals(1 in destination, false);
  assert_equals(source, ["1", , "3"]);
  map_into(["5"], destination, (item) => Number(item));
  assert_equals(alias, [5]);
  map_into(destination, destination, (item) => item + 1);
  assert_equals(alias, [6]);
});

Deno.test("array update failures expose completed writes and preserve the callback error", () => {
  const failure = new Error("stop update");
  for (const into of [false, true]) {
    const source = [1, 2, 3];
    const destination = into ? [0, 0, 0, 0] : source;
    let caught: unknown;
    const update = (item: number) => {
      if (item === 2) throw failure;
      return item * 10;
    };
    try {
      if (into) map_into(source, destination, update);
      else map_in_place(source, update);
    } catch (error) {
      caught = error;
    }
    assert_true(
      caught === failure,
      "updates must propagate the callback error",
    );
    assert_equals(destination, into ? [10, 0, 0] : [10, 2, 3]);
    if (into) assert_equals(source, [1, 2, 3]);
  }
});

function updater_type_errors() {
  const numbers: number[] = [1];
  // @ts-expect-error in-place mapping cannot change numbers into strings
  map_in_place(numbers, (item) => item.toString());
  const literals: 1[] = [1];
  // @ts-expect-error callback results must not widen the input element type
  map_in_place(literals, () => 2);
  const destination: string[] = [];
  // @ts-expect-error output must match the existing destination element type
  map_into(numbers, destination, (item) => item);
}

// Compile-time checks; the rejected calls must never execute.
void updater_type_errors;
