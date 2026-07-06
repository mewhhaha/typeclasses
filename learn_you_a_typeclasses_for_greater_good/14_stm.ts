import { assert_equals } from "../src/assert.ts";
import {
  atomically,
  modify_tvar,
  new_tvar,
  or_else,
  read_tvar,
  retry,
  write_tvar,
} from "../src/stm.ts";
import { Do } from "../src/typeclasses.ts";

export function lesson_14_stm() {
  const checking = new_tvar(40);
  const savings = new_tvar(2);
  const transfer = Do(function* () {
    const checking_before = yield* read_tvar(checking);

    yield* write_tvar(checking, checking_before - 5);
    yield* modify_tvar(savings, (value) => value + 5);

    const checking_after = yield* read_tvar(checking);
    const savings_after = yield* read_tvar(savings);

    return checking_after + savings_after;
  });
  const fallback = or_else(retry<number>(), read_tvar(savings));

  assert_equals(atomically(transfer), 42);
  assert_equals(atomically(read_tvar(checking)), 35);
  assert_equals(atomically(read_tvar(savings)), 7);
  assert_equals(atomically(fallback), 7);
}
