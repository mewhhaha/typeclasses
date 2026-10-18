type Clock = { version: bigint };
class VersionedEntries {
  readonly #clock: Clock;
  readonly #entries = new Map<number, number>();
  constructor(clock: Clock) {
    this.#clock = clock;
    Object.freeze(this);
  }
  set(key: number, value: number): this {
    this.#clock.version += 1n;
    this.#entries.set(key, value);
    return this;
  }
  delete(key: number): boolean {
    this.#clock.version += 1n;
    return this.#entries.delete(key);
  }
  clear(): void {
    this.#clock.version += 1n;
    this.#entries.clear();
  }
  has(key: number): boolean {
    return this.#entries.has(key);
  }
  get(key: number): number | undefined {
    return this.#entries.get(key);
  }
}
/** Mutation-aware prototype: parent links and the clock cannot be changed externally.
 * Entries deliberately expose a mutation facade rather than an escapable raw Map.
 */
export class Overlay {
  readonly parent?: Overlay;
  readonly entries: VersionedEntries;
  readonly #clock: Clock;
  readonly #cache = new Map<number, { version: bigint; value: number }>();
  constructor(parent?: Overlay) {
    this.parent = parent;
    let clock: Clock = { version: 0n };
    if (parent !== undefined) clock = parent.#clock;
    this.#clock = clock;
    this.entries = new VersionedEntries(this.#clock);
    Object.freeze(this);
  }
  cached(key: number): number {
    const cached = this.#cache.get(key);
    if (cached?.version === this.#clock.version) return cached.value;
    const value = lookup(this, key);
    this.#cache.set(key, { version: this.#clock.version, value });
    return value;
  }
}
export function overlay(parent?: Overlay): Overlay {
  return new Overlay(parent);
}
export function lookup(node: Overlay, key: number): number {
  for (
    let current: Overlay | undefined = node;
    current !== undefined;
    current = current.parent
  ) {
    if (current.entries.has(key)) return current.entries.get(key)!;
  }
  return 0;
}
export function cached_lookup(node: Overlay, key: number): number {
  return node.cached(key);
}

/** Numeric-only experiment. Ownership moves in both directions; no generic errors. */
export const packed_worker_source = `self.onmessage = (event) => {
  const values = event.data;
  for (let index = 0; index < values.length; index += 1) values[index] += 1;
  self.postMessage(values, [values.buffer]);
};`;
