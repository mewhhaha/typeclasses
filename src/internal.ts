import { type Data, type Dictionary, kind } from "./typeclass.ts";

/** Cast a value whose context is unchanged. */
export function same_context<result>(value: unknown): result {
  return value as result;
}

/** Return a new array with item appended without mutating values. */
export function append_item<item>(
  values: readonly item[],
  item: item,
): item[] {
  const next = new Array<item>(values.length + 1);

  for (let index = 0; index < values.length; index += 1) {
    next[index] = values[index];
  }

  next[values.length] = item;

  return next;
}

/** Check whether a wrapped value was constructed by dictionary's runtime kind. */
export function is_kind_of<dictionary extends Dictionary>(
  value: unknown,
  dictionary: dictionary,
): value is Data<dictionary, unknown> {
  return typeof value === "object" && value !== null &&
    (value as Dictionary)[kind] === dictionary[kind];
}

/** Retag a configured dictionary so it shares its base dictionary's runtime kind. */
export function configured_dictionary<
  base extends Dictionary,
  configured extends Dictionary,
>(base: base, dictionary: configured): configured {
  Object.defineProperty(dictionary, kind, { value: base[kind] });
  return dictionary;
}
