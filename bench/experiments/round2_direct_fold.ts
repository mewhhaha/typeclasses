/** Rejected production experiment: faster than generator folding, far from manual-loop target. */
export type Stage =
  | { readonly tag: "map"; readonly fn: (item: unknown) => unknown }
  | { readonly tag: "filter"; readonly fn: (item: unknown) => boolean }
  | { readonly tag: "take"; readonly count: number };

/** Direct terminal interpreter retained to make the rejected alternative reproducible. */
export function direct_fold<item, state>(
  source: Iterable<unknown>,
  ordered: readonly Stage[],
  initial: state,
  fn: (state: state, item: item) => state,
): state {
  const remaining = ordered.map((stage) => {
    if (stage.tag === "take") return stage.count;
    return Infinity;
  });
  let state = initial;
  if (remaining.includes(0)) return state;
  for (const input of source) {
    let item = input;
    let keep = true;
    let stop = false;
    for (let index = 0; index < ordered.length; index += 1) {
      const operation = ordered[index];
      switch (operation.tag) {
        case "map":
          item = operation.fn(item);
          break;
        case "filter":
          keep = operation.fn(item);
          break;
        case "take":
          remaining[index] -= 1;
          if (remaining[index] === 0) stop = true;
          break;
      }
      if (!keep) break;
    }
    if (keep) state = fn(state, item as item);
    if (stop) return state;
  }
  return state;
}
