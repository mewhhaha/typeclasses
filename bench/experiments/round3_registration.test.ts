import { assert_equals, assert_true } from "../../src/assert.ts";
import { install_instance } from "../../src/typeclass.ts";

// Rejected: preparing frozen implementations avoids reflection, but loses the
// ownership and all-or-nothing validation of the open instance API.
function prepare_frozen_registration<methods extends object>(
  implementation: methods,
) {
  if (!Object.isFrozen(implementation)) {
    throw new TypeError("Expected frozen methods");
  }
  return (
    dictionary: Record<PropertyKey, unknown>,
    token: PropertyKey,
  ): methods => {
    Object.assign(dictionary, implementation);
    dictionary[token] = implementation;
    return implementation;
  };
}

Deno.test("prepared frozen registration is rejected because method ownership can be overwritten", () => {
  const a = Symbol("a"), b = Symbol("b");
  const first = Object.freeze({
    map() {
      return 1;
    },
  });
  const second = Object.freeze({
    map() {
      return 2;
    },
  });
  const safe: Record<PropertyKey, unknown> = {};
  install_instance(safe, a, first);
  let rejected = false;
  try {
    install_instance(safe, b, second);
  } catch {
    rejected = true;
  }
  assert_true(rejected, "open installer must reject conflicting method owners");
  const fast: Record<PropertyKey, unknown> = {};
  prepare_frozen_registration(first)(fast, a);
  prepare_frozen_registration(second)(fast, b);
  assert_equals((fast.map as () => number)(), 2);
});

Deno.test("prepared registration is rejected because a failed install can leave partial writes", () => {
  const methods = Object.freeze({
    first() {
      return 1;
    },
    last() {
      return 2;
    },
  });
  function target(): Record<PropertyKey, unknown> {
    return Object.defineProperty({}, "last", { value: 0, writable: false });
  }
  const safe = target(), fast = target();
  try {
    install_instance(safe, Symbol("methods"), methods);
  } catch { /* expected */ }
  try {
    prepare_frozen_registration(methods)(fast, Symbol("methods"));
  } catch { /* expected */ }
  assert_equals(Object.hasOwn(safe, "first"), false);
  assert_equals(Object.hasOwn(fast, "first"), true);
});
