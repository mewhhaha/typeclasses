import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { Monoid, Semigroup } from "./typeclasses.ts";

/** @ignore */
export const chunk_log_identity: unique symbol = Symbol("chunk_log_identity");
/** Persistent append tree. Flatten explicitly at the observation boundary. */
export type RawChunkLog<item> =
  | { readonly tag: "empty" }
  | { readonly tag: "leaf"; readonly items: readonly item[] }
  | {
    readonly tag: "concat";
    readonly left: RawChunkLog<item>;
    readonly right: RawChunkLog<item>;
  };
/** @ignore */
export interface AsChunkLogLambda {
  readonly [type_item]: unknown;
  readonly [type_data]: RawChunkLog<this[typeof type_item]>;
}
/** A monoid of persistent log chunks with constant-time append. */
export interface AsChunkLog
  extends As<AsChunkLogLambda, typeof chunk_log_identity>, Monoid<AsChunkLog> {}
/** A wrapped persistent log. */
export type ChunkLog<item> = Data<AsChunkLog, item>;
/** Persistent log dictionary; use chunk_log to snapshot input items. */
export const ChunkLog: AsChunkLog = data<AsChunkLog>(chunk_log_identity);
const empty_chunk_log = /* @__PURE__ */ ChunkLog({ tag: "empty" });

/** Snapshots one chunk of log items. */
export function chunk_log<item>(items: readonly item[]): ChunkLog<item> {
  const len = items.length;
  if (len === 0) return empty_chunk_log as ChunkLog<item>;
  return ChunkLog({
    tag: "leaf",
    items: len === 1 ? [items[0]] : items.slice(),
  });
}
/** Materializes a log in append order without recursion. */
export function flatten_chunk_log<item>(log: ChunkLog<item>): readonly item[] {
  const root = log.value();
  if (root.tag === "empty") return [];
  if (root.tag === "leaf") {
    const items = root.items;
    return items.length === 1 ? [items[0]] : items.slice();
  }
  const output: item[] = [];
  const pending: RawChunkLog<item>[] = [];
  let current: RawChunkLog<item> | undefined = root;
  while (current !== undefined) {
    switch (current.tag) {
      case "empty":
        current = pending.pop();
        break;
      case "leaf": {
        const items = current.items;
        const len = items.length;
        if (len === 1) {
          output.push(items[0]);
        } else {
          for (let i = 0; i < len; i += 1) output.push(items[i]);
        }
        current = pending.pop();
        break;
      }
      case "concat":
        pending.push(current.right);
        current = current.left;
        break;
    }
  }
  return output;
}
Semigroup.instance(ChunkLog)({
  concat(right) {
    if (this === empty_chunk_log) return right;
    if (right === empty_chunk_log) return this;
    const left = this.value();
    if (left.tag === "empty") return right;
    const other = right.value();
    if (other.tag === "empty") return this;
    return ChunkLog({ tag: "concat", left, right: other });
  },
});
Monoid.instance(ChunkLog)({
  empty() {
    return empty_chunk_log as ChunkLog<never>;
  },
});
