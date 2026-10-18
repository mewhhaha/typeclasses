import { ArrayT } from "../../src/array.ts";
function product<result>(
  fn: (...values: unknown[]) => result,
  first: readonly unknown[],
  rest: readonly ArrayT<unknown>[],
  preallocate: boolean,
): ArrayT<result> {
  const sources = [first, ...rest.map((value) => value.value())];
  const values: unknown[] = [];
  if (sources.some((source) => source.length === 0)) return ArrayT([]);
  let length = 1;
  for (const source of sources) {
    length *= source.length;
    if (!Number.isSafeInteger(length) || length > 0xffff_ffff) {
      throw new RangeError("Array product exceeds maximum array length");
    }
  }
  let out: result[] = [];
  if (preallocate) out = new Array<result>(length);
  let out_index = 0;
  const positions = new Array<number>(sources.length).fill(0);
  let depth = 0;
  while (depth >= 0) {
    if (depth === sources.length) {
      out[out_index++] = fn(...values);
      depth -= 1;
      continue;
    }
    const position = positions[depth];
    if (position === sources[depth].length) {
      positions[depth] = 0;
      depth -= 1;
      continue;
    }
    values[depth] = sources[depth][position];
    positions[depth] += 1;
    depth += 1;
  }
  out.length = out_index;
  return ArrayT(out);
}

export function preallocated_product<result>(
  fn: (...values: unknown[]) => result,
  first: readonly unknown[],
  rest: readonly ArrayT<unknown>[],
): ArrayT<result> {
  return product(fn, first, rest, true);
}
export function growing_product<result>(
  fn: (...values: unknown[]) => result,
  first: readonly unknown[],
  rest: readonly ArrayT<unknown>[],
): ArrayT<result> {
  return product(fn, first, rest, false);
}
