import { assert_equals } from "./assert.ts";
import { Either } from "./either.ts";
import { Fn } from "./fn.ts";
import * as Prelude from "./prelude.ts";
import { Tuple } from "./tuple.ts";
import { Validation } from "./validation.ts";

Deno.test("deprecated camel-case names forward to canonical snake-case APIs", () => {
  assert_equals(Prelude.throwError, Prelude.throw_error);
  assert_equals(Prelude.liftA, Prelude.lift_A);
  assert_equals(Prelude.liftA2, Prelude.lift_A2);
  assert_equals(Prelude.liftA3, Prelude.lift_A3);
  assert_equals(Prelude.liftA4, Prelude.lift_A4);
  assert_equals(Prelude.liftA5, Prelude.lift_A5);
  assert_equals(Prelude.apFirst, Prelude.ap_first);
  assert_equals(Prelude.apSecond, Prelude.ap_second);
  assert_equals(Prelude.foldMap, Prelude.fold_map);
  assert_equals(Prelude.toArray, Prelude.to_array);

  assert_equals(Either.withLeft, Either.with_left);
  assert_equals(Tuple.withLeft, Tuple.with_left);
  assert_equals(Tuple.withMonoid, Tuple.with_monoid);
  assert_equals(Validation.withError, Validation.with_error);
  assert_equals(Fn.withInput, Fn.with_input);
});
