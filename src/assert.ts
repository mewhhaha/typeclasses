export function assert_equals<value>(
  actual: value,
  expected: value,
  message?: string,
): void {
  if (deep_equal(actual, expected)) {
    return;
  }

  let prefix = "Values are not equal";

  if (message !== undefined) {
    prefix = message;
  }

  throw new Error(
    prefix + "\nactual: " + format(actual) + "\nexpected: " + format(expected),
  );
}

export function assert_true(value: boolean, message: string): void {
  if (value) {
    return;
  }

  throw new Error(message);
}

function deep_equal(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (typeof left !== typeof right) {
    return false;
  }

  if (typeof left !== "object") {
    return false;
  }

  if (left === null || right === null) {
    return false;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return false;
    }

    if (left.length !== right.length) {
      return false;
    }

    for (let index = 0; index < left.length; index += 1) {
      if (!deep_equal(left[index], right[index])) {
        return false;
      }
    }

    return true;
  }

  const left_record = left as Record<string, unknown>;
  const right_record = right as Record<string, unknown>;
  const left_keys = Object.keys(left_record);
  const right_keys = Object.keys(right_record);

  if (left_keys.length !== right_keys.length) {
    return false;
  }

  for (const key of left_keys) {
    if (!Object.hasOwn(right_record, key)) {
      return false;
    }

    if (!deep_equal(left_record[key], right_record[key])) {
      return false;
    }
  }

  return true;
}

function format(value: unknown): string {
  return inspect(value);
}
import { inspect } from "./inspect.ts";
