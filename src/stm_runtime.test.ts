import { assert_equals, assert_true } from "./assert.ts";
import {
  abort,
  atomically,
  new_tvar,
  or_else,
  read_tvar,
  retry,
  StmError,
  type TVar,
  write_tvar,
} from "./stm.ts";
import { Do } from "./typeclasses.ts";

const tvar_is_nominal: object extends TVar<number> ? true : false = false;
void tvar_is_nominal;

Deno.test("STM abort isolates mutations made to a value read from TVar", () => {
  const state = new_tvar({ count: 1 });
  const transaction = Do(function* () {
    const current = yield* read_tvar(state);
    current.count += 1;
    return yield* abort("rollback");
  });

  let error: unknown;

  try {
    atomically(transaction);
  } catch (caught) {
    error = caught;
  }

  assert_true(
    error instanceof StmError,
    "the transaction aborts with StmError",
  );
  assert_equals(atomically(read_tvar(state)), { count: 1 });
});

Deno.test("STM reads do not expose the value stored inside TVar", () => {
  const state = new_tvar({ count: 1 });
  const outside = atomically(read_tvar(state));

  outside.count = 2;

  assert_equals(atomically(read_tvar(state)), { count: 1 });
});

Deno.test("STM writes isolate values from their caller after commit", () => {
  const state = new_tvar({ count: 1 });
  const replacement = { count: 2 };

  atomically(write_tvar(state, replacement));
  replacement.count = 3;

  assert_equals(atomically(read_tvar(state)), { count: 2 });
});

Deno.test("STM or_else restores read snapshots before its fallback", () => {
  const state = new_tvar({ count: 1 });
  const failed = Do(function* () {
    const current = yield* read_tvar(state);
    current.count += 1;
    return yield* retry<{ count: number }>();
  });
  const transaction = Do(function* () {
    yield* read_tvar(state);
    return yield* or_else(failed, read_tvar(state));
  });

  assert_equals(atomically(transaction), { count: 1 });
  assert_equals(atomically(read_tvar(state)), { count: 1 });
});

Deno.test("STM rejects nested atomically calls before they can escape rollback", () => {
  const state = new_tvar(1);
  const transaction = read_tvar(state).map(() => {
    atomically(write_tvar(state, 2));
    return 0;
  });
  let error: unknown;

  try {
    atomically(transaction);
  } catch (caught) {
    error = caught;
  }

  assert_true(error instanceof StmError, "nested atomically is rejected");
  assert_true(
    (error as Error).message.includes("Nested atomically"),
    "the error identifies the unsupported nesting",
  );
  assert_equals(atomically(read_tvar(state)), 1);
});

Deno.test("STM rejects values that cannot be isolated for rollback", () => {
  let error: unknown;

  try {
    new_tvar(() => 42);
  } catch (caught) {
    error = caught;
  }

  assert_true(error instanceof StmError, "uncloneable values are rejected");
  assert_true(
    (error as Error).message.includes("initial value for TVar"),
    "the error identifies the TVar boundary that rejected the value",
  );
});

Deno.test("STM prepares every committed value before changing any TVar", () => {
  const first = new_tvar(1);
  const second = new_tvar<{ count: number; invalid?: unknown }>({ count: 1 });
  const transaction = Do(function* () {
    yield* write_tvar(first, 2);
    yield* write_tvar(second, { count: 2 });
    const pending_second = yield* read_tvar(second);
    pending_second.invalid = () => 42;
  });
  let error: unknown;

  try {
    atomically(transaction);
  } catch (caught) {
    error = caught;
  }

  assert_true(
    error instanceof StmError,
    "an unsafe commit value aborts the transaction",
  );
  assert_equals(atomically(read_tvar(first)), 1);
  assert_equals(atomically(read_tvar(second)), { count: 1 });
});
