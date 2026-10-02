import { assert_equals } from "./assert.ts";
import { Either, type EitherValue, Left, Right } from "./either.ts";
import { run_task, succeed, Task, type TaskValue } from "./task.ts";
import { MonadError } from "./typeclasses.ts";

Deno.test("bottom-valued Either failures infer their recovery result", () => {
  const fluent = Left("missing").catch_error((error) => {
    expect_type<string>(error);
    // @ts-expect-error a fixed string error cannot become an untyped error
    expect_type<number>(error);
    return Right(error.length);
  });
  const generic = MonadError.catch_error(
    Left("missing"),
    (error) => Right(error.length),
  );

  expect_type<EitherValue<string, number>>(fluent);
  expect_type<EitherValue<string, number>>(generic);
  assert_equals(fluent.value(), ["Right", 7]);
  assert_equals(generic.value(), ["Right", 7]);
});

Deno.test("recovery preserves ordinary successes and rethrows", () => {
  let calls = 0;
  const successful = Right<string, number>(1).catch_error(() => {
    calls += 1;
    return Right(2);
  });
  const generic_success = MonadError.catch_error(
    Right<string, number>(1),
    () => {
      calls += 1;
      return Right(2);
    },
  );
  const rethrown = Left<string, number>("missing").catch_error((error) =>
    Left(error.toUpperCase())
  );
  const generic_rethrow = MonadError.catch_error(
    Left<string, number>("missing"),
    (error) => Left(error.toUpperCase()),
  );

  expect_type<EitherValue<string, number>>(successful);
  expect_type<EitherValue<string, number>>(generic_success);
  expect_type<EitherValue<string, number>>(rethrown);
  expect_type<EitherValue<string, number>>(generic_rethrow);
  assert_equals(successful.value(), ["Right", 1]);
  assert_equals(generic_success.value(), ["Right", 1]);
  assert_equals(rethrown.value(), ["Left", "MISSING"]);
  assert_equals(generic_rethrow.value(), ["Left", "MISSING"]);
  assert_equals(calls, 0);
});

Deno.test("bottom-valued Task failures infer recovery without running it early", async () => {
  let calls = 0;
  const failed = Task.throw_error<never>("missing");
  const fluent = failed.catch_error(() => {
    calls += 1;
    return succeed(7);
  });
  const generic = MonadError.catch_error(failed, () => {
    calls += 1;
    return succeed(7);
  });
  const ordinary = succeed(1).catch_error(() => {
    calls += 1;
    return succeed(2);
  });

  expect_type<TaskValue<number>>(fluent);
  expect_type<TaskValue<number>>(generic);
  expect_type<TaskValue<number>>(ordinary);
  assert_equals(calls, 0);
  assert_equals(await run_task(fluent), 7);
  assert_equals(await run_task(generic), 7);
  assert_equals(await run_task(ordinary), 1);
  assert_equals(calls, 2);
});

function rejected_recovery_types(): void {
  // @ts-expect-error recovery cannot replace an existing numeric success with a string
  Right<string, number>(1).catch_error(() => Right("wrong"));
  // @ts-expect-error generic recovery keeps the same successful item type
  MonadError.catch_error(Right<string, number>(1), () => Right("wrong"));
  Either.with_left<string>().Left<number>("missing").catch_error(() =>
    // @ts-expect-error a configured dictionary's fixed error type cannot change
    Left<number, number>(1)
  );
  MonadError.catch_error(
    Left<string, number>("missing"),
    // @ts-expect-error generic recovery cannot change a fixed error type
    () => Left<number, number>(1),
  );
  // @ts-expect-error recovery cannot change dictionary families
  Left<string, number>("missing").catch_error(() => succeed(1));
  // @ts-expect-error generic recovery cannot change dictionary families
  MonadError.catch_error(Left<string, number>("missing"), () => succeed(1));
  // @ts-expect-error Task recovery cannot change an existing numeric success type
  succeed(1).catch_error(() => succeed("wrong"));
  // @ts-expect-error generic Task recovery keeps the same item type
  MonadError.catch_error(succeed(1), () => succeed("wrong"));
}
void rejected_recovery_types;

function expect_type<expected>(_value: expected): void {}
