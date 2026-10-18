// Rejected ancestor-miss cache: writes invalidate its stored lookup result.
export type Overlay = { parent?: Overlay; entries: Map<number, number> };
export function lookup(overlay: Overlay | undefined, key: number): number {
  for (let current = overlay; current !== undefined; current = current.parent) {
    if (current.entries.has(key)) return current.entries.get(key)!;
  }
  return 0;
}
export function cached_lookup() {
  const caches = new WeakMap<Overlay, Map<number, number>>();
  return (overlay: Overlay, key: number): number => {
    const own = caches.get(overlay);
    if (own?.has(key)) return own.get(key)!;
    const value = lookup(overlay, key);
    if (own === undefined) caches.set(overlay, new Map([[key, value]]));
    else own.set(key, value);
    return value;
  };
}
export function stale_cache_observation() {
  const parent: Overlay = { entries: new Map() };
  const branch: Overlay = { parent, entries: new Map() };
  const find = cached_lookup();
  find(branch, 1);
  parent.entries.set(1, 7);
  return { direct: lookup(branch, 1), cached: find(branch, 1) };
}
