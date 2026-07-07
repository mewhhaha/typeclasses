import {
  from_entries as map_from_entries,
  to_record as map_to_record,
} from "../src/map.ts";
import {
  from_entries as record_from_entries,
  to_record as record_to_record,
} from "../src/record.ts";
import { assert_equals } from "../src/assert.ts";
import { Just } from "../src/maybe.ts";
import { Functor } from "../src/typeclasses.ts";

export function lesson_06_functors() {
  const maybe = Functor.map(Just(20), (value) => value + 22);
  const record = record_from_entries<number>([["left", 20], ["right", 22]])
    .map((value) => value.toString());
  const map = map_from_entries<number>([["x", 1], ["y", 2]])
    .map((value) => value * 10);

  assert_equals(maybe.value(), Just(42).value());
  assert_equals(record_to_record(record), { left: "20", right: "22" });
  assert_equals(map_to_record(map), { x: 10, y: 20 });
}
