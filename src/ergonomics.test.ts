import { ArrayT, to_array } from "./array.ts";
import { assert_equals } from "./assert.ts";
import { Either } from "./either.ts";
import { Just, Maybe } from "./maybe.ts";
import {
  Alternative,
  Applicative,
  Do,
  MonadError,
  Monoid,
  Traversable,
} from "./typeclasses.ts";
import { Writer } from "./writer.ts";

Deno.test("dictionaries witness context-free typeclass operations", () => {
  const direct = Maybe.pure(42);
  const lifted = Applicative.pure(Maybe, 42);
  const empty_maybe = Alternative.empty(Maybe);
  const empty_array = Monoid.empty(ArrayT);
  const failed = MonadError.throw_error(Either, "missing");
  const directly_failed = Either.throw_error("missing");

  assert_equals(direct.value(), ["Just", 42] as const);
  assert_equals(lifted.value(), ["Just", 42] as const);
  assert_equals(empty_maybe.value(), ["Nothing"] as const);
  assert_equals(empty_array.value(), []);
  assert_equals(failed.value(), ["Left", "missing"] as const);
  assert_equals(directly_failed.value(), ["Left", "missing"] as const);
});

Deno.test("Do accepts an explicit dictionary and yield-free blocks", () => {
  // deno-lint-ignore require-yield -- this is the behavior under test
  const returned = Do(Maybe, function* () {
    return 42;
  });
  const yielded = Do(Maybe, function* () {
    const value = yield* Just(41);
    return value + 1;
  });

  assert_equals(returned.value(), ["Just", 42] as const);
  assert_equals(yielded.value(), ["Just", 42] as const);
});

Deno.test("traverse accepts an applicative dictionary", () => {
  const traversed = Traversable.traverse(
    ArrayT([1, 2, 3]),
    Maybe,
    (value) => Just(value * 2),
  );
  const [tag, values] = traversed.value();

  assert_equals(tag, "Just" as const);
  assert_equals(values === undefined ? [] : to_array(values), [2, 4, 6]);
});

Deno.test("configured Writer dictionaries capture their empty output", () => {
  const LogWriter = Writer.with(ArrayT<string>([]));
  const written = LogWriter([1, ArrayT(["start"])] as const)
    .bind((value) => LogWriter([value + 1, ArrayT(["end"])] as const));
  const program = Do(LogWriter, function* () {
    const value = yield* written;
    return value * 2;
  });
  const [value, output] = program.value();

  assert_equals(value, 4);
  assert_equals(to_array(output), ["start", "end"]);
  assert_equals(LogWriter.pure(42).value()[1].value(), []);
});

function check_writer_requires_configuration(): void {
  // @ts-expect-error an unconfigured Writer has no output monoid for pure
  Writer.pure(42);
}

void check_writer_requires_configuration;
