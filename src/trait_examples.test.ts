import { assert_equals, assert_true } from "./assert.ts";
import {
  add_values,
  keep_positive,
  label_values,
  sum_values,
} from "./examples.ts";
import { List } from "./list.ts";
import { Option } from "./option.ts";
import { Result } from "./result.ts";
import { Equal, Format } from "./trait.ts";

Deno.test("Format and Equal traits dispatch through pseudo-trait helpers", () => {
  assert_equals(Format.fmt(Option, Option.some(42)), "Some(42)");
  assert_equals(Format.fmt(Option, Option.none()), "None");
  assert_true(Equal.eq(Option, Option.some("x"), Option.some("x")), "same");
  assert_true(!Equal.eq(Option, Option.some("x"), Option.some("y")), "diff");

  const list = List.from_array([1, 2, 3]);
  assert_equals(Format.fmt(List, list), "[1, 2, 3]");
  assert_true(Equal.eq(List, list, List.from_array([1, 2, 3])), "same list");

  assert_equals(Format.fmt(Result, Result.ok("done")), 'Ok("done")');
  assert_equals(Format.fmt(Result, Result.err("bad")), 'Err("bad")');
});

Deno.test("Functor maps values without leaving the context", () => {
  const some = Option.map(Option.some(2), (value) => value + 1);
  const none = Option.map(Option.none<number>(), (value) => value + 1);
  const list = List.map(List.from_array([1, 2, 3]), (value) => value * 2);
  const ok = Result.map(Result.ok(20), (value) => value + 1);
  const err = Result.map(Result.err<number>("missing"), (value) => value + 1);

  assert_equals(some, Option.some(3));
  assert_equals(none, Option.none());
  assert_equals(List.to_array(list), [2, 4, 6]);
  assert_equals(ok, Result.ok(21));
  assert_equals(err, Result.err("missing"));
});

Deno.test("Applicative applies contextual functions", () => {
  const option = Option.ap(
    Option.some((value: number) => value * 2),
    Option.some(21),
  );
  const none = Option.ap(
    Option.none<(value: number) => number>(),
    Option.some(21),
  );
  const list = List.ap(
    List.from_array([
      (value: number) => value + 1,
      (value: number) => value * 10,
    ]),
    List.from_array([1, 2]),
  );

  assert_equals(option, Option.some(42));
  assert_equals(none, Option.none());
  assert_equals(List.to_array(list), [2, 3, 10, 20]);
});

Deno.test("Monad chains computations that choose the next context", () => {
  function positive(value: number) {
    if (value > 0) {
      return Option.some(value);
    }

    return Option.none<number>();
  }

  const kept = Option.flat_map(Option.some(4), positive);
  const dropped = Option.flat_map(Option.some(-1), positive);
  const parsed = Result.flat_map(
    Result.ok("42"),
    (text) => Result.from_number(Number.parseInt(text, 10)),
  );

  assert_equals(kept, Option.some(4));
  assert_equals(dropped, Option.none());
  assert_equals(parsed, Result.ok(42));
});

Deno.test("Foldable reduces values inside different contexts", () => {
  const list = List.from_array([1, 2, 3, 4]);
  const some = Option.some(7);
  const none = Option.none<number>();
  const ok = Result.ok(9);
  const err = Result.err<number>("no value");

  assert_equals(List.fold(list, 0, (state, item) => state + item), 10);
  assert_equals(Option.fold(some, 1, (state, item) => state * item), 7);
  assert_equals(Option.fold(none, 1, (state, item) => state * item), 1);
  assert_equals(Result.fold(ok, 1, (state, item) => state + item), 10);
  assert_equals(Result.fold(err, 1, (state, item) => state + item), 1);
});

Deno.test("Generic helpers work against trait interfaces", () => {
  const option = label_values(Option, Option.some(5));
  const list = label_values(List, List.from_array([1, 2]));
  const result = label_values(Result, Result.ok(3));

  assert_equals(option, Option.some("value:5"));
  assert_equals(List.to_array(list), ["value:1", "value:2"]);
  assert_equals(result, Result.ok("value:3"));
  assert_equals(sum_values(List, List.from_array([1, 2, 3])), 6);
});

Deno.test("Generic applicative helper combines contextual values", () => {
  const option = add_values(Option, Option.some(20), Option.some(22));
  const none = add_values(Option, Option.some(20), Option.none<number>());
  const result = add_values(Result, Result.ok(40), Result.ok(2));
  const err = add_values(Result, Result.err<number>("missing"), Result.ok(2));
  const list = add_values(
    List,
    List.from_array([1, 10]),
    List.from_array([2, 20]),
  );

  assert_equals(option, Option.some(42));
  assert_equals(none, Option.none());
  assert_equals(result, Result.ok(42));
  assert_equals(err, Result.err("missing"));
  assert_equals(List.to_array(list), [3, 21, 12, 30]);
});

Deno.test("Generic monad helper lets each context define failure", () => {
  const option = keep_positive(
    Option,
    Option.some(-1),
    () => Option.none(),
  );
  const result = keep_positive(
    Result,
    Result.ok(-1),
    (value) => Result.err("negative: " + value.toString()),
  );
  const list = keep_positive(
    List,
    List.from_array([2, -1, 3]),
    () => List.nil(),
  );

  assert_equals(option, Option.none());
  assert_equals(result, Result.err("negative: -1"));
  assert_equals(List.to_array(list), [2, 3]);
});
