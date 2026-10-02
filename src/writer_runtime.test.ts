import { ArrayT, type AsArray } from "./array.ts";
import { assert_equals } from "./assert.ts";
import { Do } from "./typeclasses.ts";
import { writer_cell } from "./writer.ts";

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
