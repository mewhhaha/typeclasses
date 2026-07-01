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
import {
  Applicative,
  Equal,
  Foldable,
  Format,
  Functor,
  Monad,
} from "./trait.ts";

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
  const some = Functor.map(Option, Option.some(2), (value: number) => {
    return value + 1;
  });
  const none = Functor.map(
    Option,
    Option.none<number>(),
    (value: number) => value + 1,
  );
  const list = Functor.map(
    List,
    List.from_array([1, 2, 3]),
    (value: number) => value * 2,
  );
  const ok = Functor.map(Result, Result.ok(20), (value: number) => value + 1);
  const err = Functor.map(
    Result,
    Result.err<number>("missing"),
    (value: number) => value + 1,
  );

  assert_equals(some, Option.some(3));
  assert_equals(none, Option.none());
  assert_equals(List.to_array(list), [2, 4, 6]);
  assert_equals(ok, Result.ok(21));
  assert_equals(err, Result.err("missing"));
});

Deno.test("Applicative applies contextual functions", () => {
  const option = Applicative.ap(
    Option,
    Option.some((value: number) => value * 2),
    Option.some(21),
  );
  const none = Applicative.ap(
    Option,
    Option.none<(value: number) => number>(),
    Option.some(21),
  );
  const list = Applicative.ap(
    List,
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

Deno.test("Option callable wrapper traits option values for fluent methods", () => {
  const value = Option(Option.some(41))
    .map((item) => item + 1);
  const none = Option(Option.none<number>())
    .map((item) => item + 1);

  assert_equals(value.value(), Option.some(42));
  assert_equals(none.value(), Option.none());
  assert_equals(value.fmt(), "Some(42)");
  assert_true(value.eq(Option.some(42)), "static option compares");
  assert_true(value.eq(Option(Option.some(42))), "wrapped option compares");
  assert_true(Option(Option.none()).eq(Option.none()), "None compares");
});

Deno.test("Option callable wrapper chains applicative ap through this", () => {
  const sum = Option(Option.some((left: number) => {
    return (right: number) => left + right;
  }))
    .ap(Option.some(20))
    .ap(Option.some(22));

  const missing = Option(Option.some((left: number) => {
    return (right: number) => left + right;
  }))
    .ap(Option.none<number>())
    .ap(Option.some(22));

  assert_equals(sum.value(), Option.some(42));
  assert_equals(missing.value(), Option.none());
});

Deno.test("Trait dictionary methods assert a missing receiver at runtime", () => {
  const map = Option.map;

  assert_trait_receiver_error(
    () => map((value: number) => value + 1),
    "Option.map requires a trait receiver",
  );
});

Deno.test("Result callable wrapper derives fluent methods from its dictionary", () => {
  const value = Result(Result.ok(40))
    .map((item) => item + 2);
  const parsed = Result(Result.ok("42"))
    .flat_map((text) => Result.from_number(Number.parseInt(text, 10)));
  const sum = Result(Result.ok((left: number) => {
    return (right: number) => left + right;
  }))
    .ap(Result.ok(40))
    .ap(Result(Result.ok(2)));
  const missing = Result(Result.err<number>("missing"))
    .map((item) => item + 1);

  assert_equals(value.value(), Result.ok(42));
  assert_equals(value.fmt(), "Ok(42)");
  assert_true(value.eq(Result.ok(42)), "static result compares");
  assert_true(value.eq(Result(Result.ok(42))), "wrapped result compares");
  assert_equals(parsed.value(), Result.ok(42));
  assert_equals(parsed.fmt(), "Ok(42)");
  assert_equals(sum.value(), Result.ok(42));
  assert_equals(missing.value(), Result.err("missing"));
});

Deno.test("List callable wrapper derives fluent methods from its dictionary", () => {
  const values = List(List.from_array([1, 2, 3]))
    .map((item) => item * 2);
  const applied = List(
    List.from_array([
      (value: number) => value + 1,
      (value: number) => value * 10,
    ]),
  )
    .ap(List(List.from_array([1, 2])));
  const raw_applied = List(
    List.from_array([
      (value: number) => value + 1,
      (value: number) => value * 10,
    ]),
  )
    .ap(List.from_array([1, 2]));
  const total = values.fold(0, (state, item) => state + item);

  assert_equals(values.value(), List.from_array([2, 4, 6]));
  assert_equals(values.fmt(), "[2, 4, 6]");
  assert_true(
    values.eq(List(List.from_array([2, 4, 6]))),
    "wrapped list compares",
  );
  assert_equals(List.to_array(applied.value()), [2, 3, 10, 20]);
  assert_equals(List.to_array(raw_applied.value()), [2, 3, 10, 20]);
  assert_equals(total, 12);
});

Deno.test("Monad chains computations that choose the next context", () => {
  function positive(value: number) {
    if (value > 0) {
      return Option.some(value);
    }

    return Option.none<number>();
  }

  const kept = Monad.flat_map(Option, Option.some(4), positive);
  const dropped = Monad.flat_map(Option, Option.some(-1), positive);
  const parsed = Monad.flat_map(
    Result,
    Result.ok("42"),
    (text: string) => Result.from_number(Number.parseInt(text, 10)),
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

  assert_equals(
    Foldable.fold(List, list, 0, (state: number, item: number) => state + item),
    10,
  );
  assert_equals(
    Foldable.fold(
      Option,
      some,
      1,
      (state: number, item: number) => state * item,
    ),
    7,
  );
  assert_equals(
    Foldable.fold(
      Option,
      none,
      1,
      (state: number, item: number) => state * item,
    ),
    1,
  );
  assert_equals(
    Foldable.fold(
      Result,
      ok,
      1,
      (state: number, item: number) => state + item,
    ),
    10,
  );
  assert_equals(
    Foldable.fold(
      Result,
      err,
      1,
      (state: number, item: number) => state + item,
    ),
    1,
  );
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

function assert_trait_receiver_error(
  fn: () => unknown,
  message: string,
): void {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw new Error("Expected TypeError");
    }

    assert_equals(error.message, message);
    return;
  }

  throw new Error("Expected a missing trait receiver error");
}
