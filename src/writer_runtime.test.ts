import { ArrayT, type AsArray } from "./array.ts";
import { assert_equals, assert_true } from "./assert.ts";
import { Effect, Program, type Uses } from "./effects.ts";
import { kind } from "./typeclass.ts";
import { Do } from "./typeclasses.ts";
import {
  type AsWriterCell,
  run_writer_terminal,
  writer_cell,
} from "./writer.ts";

Deno.test("Writer cells capture an empty log for pure and yield-free Do", () => {
  const audit = writer_cell<"writer-runtime-audit", AsArray, string>(
    ArrayT<string>([]),
  );
  const [value, empty] = audit.pure(42).value();
  assert_equals(value, 42);
  assert_equals(empty.value(), []);
  // deno-lint-ignore require-yield
  const empty_program = function* () {
    return 7;
  };
  assert_equals(Do(audit, empty_program).value()[1].value(), []);
  const written = audit.tell(ArrayT(["event"])).bind(() => audit.pure(8));
  assert_equals(written.value()[0], 8);
  assert_equals(written.value()[1].value(), ["event"]);
});

Deno.test("Writer cells infer the literal key and output types from their arguments", () => {
  const audit: AsWriterCell<"writer-inferred-audit", AsArray, string> =
    writer_cell("writer-inferred-audit", ArrayT<string>([]));
  const written = audit.tell(ArrayT(["first"])).bind(() =>
    audit.write(42, ArrayT(["second"]))
  );
  assert_equals(written.value()[0], 42);
  assert_equals(written.value()[1].value(), ["first", "second"]);
  assert_equals(audit.pure(7).value()[1].value(), []);

  const program = Program.scope<Uses<typeof audit>>()(function* () {
    yield* audit.tell(ArrayT(["program"]));
    return 8;
  });
  const [value, output] = run_writer_terminal(
    audit,
    program,
    ArrayT<string>([]),
  );
  assert_equals(value, 8);
  assert_equals(output.value(), ["program"]);

  const sibling = writer_cell("writer-inferred-audit", ArrayT<string>([]));
  assert_true(
    audit[kind] !== sibling[kind],
    "every declaration has its own kind",
  );
  assert_equals(
    run_writer_terminal(
      sibling,
      Effect.lift(sibling.pure(9)),
      ArrayT<string>([]),
    )[0],
    9,
  );
});

function inferred_cell_type_checks(key: string) {
  const audit = writer_cell("writer-type-audit", ArrayT<string>([]));
  // @ts-expect-error the inferred log item type stays fixed
  audit.tell(ArrayT([1]));
  // @ts-expect-error widened keys cannot identify a cell
  writer_cell(key, ArrayT<string>([])).tell(ArrayT(["event"]));
}

void inferred_cell_type_checks;
