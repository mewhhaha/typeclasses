import { assert_equals, assert_true } from "./assert.ts";
import {
  add_values,
  keep_positive,
  label_values,
  sum_values,
} from "./examples.ts";
import {
  from_array as list_from_array,
  nil as list_nil,
  to_array as list_to_array,
} from "./list.ts";
import { none as option_none, Option, some as option_some } from "./option.ts";
import {
  err as result_err,
  from_number as result_from_number,
  ok as result_ok,
  Result,
} from "./result.ts";
import {
  Applicative,
  Equal,
  Foldable,
  Format,
  Functor,
  Monad,
} from "./traits.ts";

Deno.test("Format and Equal traits dispatch through pseudo-trait helpers", () => {
  assert_equals(Format.fmt(option_some(42)), "Some(42)");
  assert_equals(Format.fmt(option_none()), "None");
  assert_true(Equal.eq(option_some("x"), option_some("x")), "boxed same");
  assert_true(!Equal.eq(option_some("x"), option_some("y")), "boxed diff");

  const list = list_from_array([1, 2, 3]);
  assert_equals(Format.fmt(list), "[1, 2, 3]");
  assert_true(
    Equal.eq(list, list_from_array([1, 2, 3])),
    "boxed list",
  );

  assert_equals(Format.fmt(result_ok("done")), 'Ok("done")');
  assert_equals(Format.fmt(result_err("bad")), 'Err("bad")');
  assert_true(
    Equal.eq(result_ok("done"), result_ok("done")),
    "boxed result",
  );
});

Deno.test("Functor maps values without leaving the context", () => {
  const some = Functor.map(option_some(2), (value: number) => value + 1);
  const none = Functor.map(
    option_none<number>(),
    (value: number) => value + 1,
  );
  const list = Functor.map(
    list_from_array([1, 2, 3]),
    (value: number) => value * 2,
  );
  const ok = Functor.map(
    result_ok(20),
    (value: number) => value + 1,
  );
  const err = Functor.map(
    result_err<number>("missing"),
    (value: number) => value + 1,
  );

  assert_equals(some.value(), option_some(3).value());
  assert_equals(none.value(), option_none().value());
  assert_equals(list_to_array(list), [2, 4, 6]);
  assert_equals(ok.value(), result_ok(21).value());
  assert_equals(err.value(), result_err("missing").value());
});

Deno.test("Applicative applies contextual functions", () => {
  const option = Applicative.ap(
    option_some((value: number) => value * 2),
    option_some(21),
  );
  const none = Applicative.ap(
    option_none<(value: number) => number>(),
    option_some(21),
  );
  const list = Applicative.ap(
    list_from_array([
      (value: number) => value + 1,
      (value: number) => value * 10,
    ]),
    list_from_array([1, 2]),
  );

  assert_equals(option.value(), option_some(42).value());
  assert_equals(none.value(), option_none().value());
  assert_equals(list_to_array(list), [2, 3, 10, 20]);
});

Deno.test("Option callable wrapper traits option values for fluent methods", () => {
  const value = option_some(41)
    .map((item) => item + 1);
  const none = option_none<number>()
    .map((item) => item + 1);

  assert_equals(value.value(), option_some(42).value());
  assert_equals(none.value(), option_none().value());
  assert_equals(value.fmt(), "Some(42)");
  assert_true(value.eq(option_some(42)), "option compares");
  assert_true(
    Option({ tag: "some", value: 42 }).eq(option_some(42)),
    "constructor boxes raw option",
  );
  assert_true(option_none().eq(option_none()), "None compares");
});

Deno.test("Option callable wrapper chains applicative ap through this", () => {
  const direct = option_some((value: number) => value + 22)
    .ap(option_some(20));
  const sum = option_some((left: number) => {
    return (right: number) => left + right;
  })
    .ap(option_some(20))
    .ap(option_some(22));

  const missing = option_some((left: number) => {
    return (right: number) => left + right;
  })
    .ap(option_none<number>())
    .ap(option_some(22));

  assert_equals(direct.value(), option_some(42).value());
  assert_equals(sum.value(), option_some(42).value());
  assert_equals(missing.value(), option_none().value());
});

Deno.test("Trait dictionary methods assert a missing receiver at runtime", () => {
  const map = Option.map;

  assert_trait_receiver_error(
    () => map((value: number) => value + 1),
    "Option.map requires a trait receiver",
  );
});

Deno.test("Result callable wrapper derives fluent methods from its dictionary", () => {
  const value = result_ok(40)
    .map((item) => item + 2);
  const parsed = result_ok("42")
    .flat_map((text) => result_from_number(Number.parseInt(text, 10)));
  const sum = result_ok((left: number) => {
    return (right: number) => left + right;
  })
    .ap(result_ok(40))
    .ap(result_ok(2));
  const missing = result_err<number>("missing")
    .map((item) => item + 1);

  assert_equals(value.value(), result_ok(42).value());
  assert_equals(value.fmt(), "Ok(42)");
  assert_true(value.eq(result_ok(42)), "result compares");
  assert_true(
    value.eq(Result({ tag: "ok", value: 42 })),
    "constructor boxes raw result",
  );
  assert_equals(parsed.value(), result_ok(42).value());
  assert_equals(parsed.fmt(), "Ok(42)");
  assert_equals(sum.value(), result_ok(42).value());
  assert_equals(missing.value(), result_err("missing").value());
});

Deno.test("List callable wrapper derives fluent methods from its dictionary", () => {
  const values = list_from_array([1, 2, 3])
    .map((item) => item * 2);
  const applied = list_from_array([
    (value: number) => value + 1,
    (value: number) => value * 10,
  ])
    .ap(list_from_array([1, 2]));
  const total = values.fold(0, (state, item) => state + item);

  assert_equals(values.value(), list_from_array([2, 4, 6]).value());
  assert_equals(values.fmt(), "[2, 4, 6]");
  assert_true(
    values.eq(list_from_array([2, 4, 6])),
    "wrapped list compares",
  );
  assert_equals(list_to_array(applied), [2, 3, 10, 20]);
  assert_equals(total, 12);
});

Deno.test("Monad chains computations that choose the next context", () => {
  function positive(value: number) {
    if (value > 0) {
      return option_some(value);
    }

    return option_none<number>();
  }

  const kept = Monad.flat_map(option_some(4), positive);
  const dropped = Monad.flat_map(option_some(-1), positive);
  const parsed = Monad.flat_map(
    result_ok("42"),
    (text: string) => result_from_number(Number.parseInt(text, 10)),
  );

  assert_equals(kept.value(), option_some(4).value());
  assert_equals(dropped.value(), option_none().value());
  assert_equals(parsed.value(), result_ok(42).value());
});

Deno.test("Foldable reduces values inside different contexts", () => {
  const list = list_from_array([1, 2, 3, 4]);
  const some = option_some(7);
  const none = option_none<number>();
  const ok = result_ok(9);
  const err = result_err<number>("no value");

  assert_equals(
    Foldable.fold(
      list,
      0,
      (state: number, item: number) => state + item,
    ),
    10,
  );
  assert_equals(
    Foldable.fold(some, 1, (state: number, item: number) => state * item),
    7,
  );
  assert_equals(
    Foldable.fold(none, 1, (state: number, item: number) => state * item),
    1,
  );
  assert_equals(
    Foldable.fold(ok, 1, (state: number, item: number) => state + item),
    10,
  );
  assert_equals(
    Foldable.fold(
      err,
      1,
      (state: number, item: number) => state + item,
    ),
    1,
  );
});

Deno.test("Generic helpers work against trait interfaces", () => {
  const option = label_values(option_some(5));
  const list = label_values(list_from_array([1, 2]));
  const result = label_values(result_ok(3));

  assert_equals(option.value(), option_some("value:5").value());
  assert_equals(list_to_array(list), ["value:1", "value:2"]);
  assert_equals(result.value(), result_ok("value:3").value());
  assert_equals(sum_values(list_from_array([1, 2, 3])), 6);
});

Deno.test("Generic applicative helper combines contextual values", () => {
  const option = add_values(option_some(20), option_some(22));
  const none = add_values(option_some(20), option_none<number>());
  const result = add_values(result_ok(40), result_ok(2));
  const err = add_values(result_err<number>("missing"), result_ok(2));
  const list = add_values(
    list_from_array([1, 10]),
    list_from_array([2, 20]),
  );

  assert_equals(option.value(), option_some(42).value());
  assert_equals(none.value(), option_none().value());
  assert_equals(result.value(), result_ok(42).value());
  assert_equals(err.value(), result_err("missing").value());
  assert_equals(list_to_array(list), [3, 21, 12, 30]);
});

Deno.test("Generic monad helper lets each context define failure", () => {
  const option = keep_positive(
    option_some(-1),
    () => option_none(),
  );
  const result = keep_positive(
    result_ok(-1),
    (value) => result_err("negative: " + value.toString()),
  );
  const list = keep_positive(
    list_from_array([2, -1, 3]),
    () => list_nil(),
  );

  assert_equals(option.value(), option_none().value());
  assert_equals(result.value(), result_err("negative: -1").value());
  assert_equals(list_to_array(list), [2, 3]);
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
