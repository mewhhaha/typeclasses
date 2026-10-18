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

/** Snapshots one chunk of log items. */
export function chunk_log<item>(items: readonly item[]): ChunkLog<item> {
  if (items.length === 0) return ChunkLog.empty<item>();
  return ChunkLog({ tag: "leaf", items: items.slice() });
}
/** Materializes a log in append order without recursion. */
export function flatten_chunk_log<item>(log: ChunkLog<item>): readonly item[] {
  const pending = [log.value()];
  const output: item[] = [];
  while (pending.length > 0) {
    const current = pending.pop()!;
    switch (current.tag) {
      case "empty":
        break;
      case "leaf":
        for (const item of current.items) output.push(item);
        break;
      case "concat":
        pending.push(current.right, current.left);
        break;
    }
  }
  return output;
}
Semigroup.instance(ChunkLog)({
  concat(right) {
    const left = this.value();
    if (left.tag === "empty") return right;
    const other = right.value();
    if (other.tag === "empty") return this;
    return ChunkLog({ tag: "concat", left, right: other });
  },
});
Monoid.instance(ChunkLog)({
  empty() {
    return ChunkLog({ tag: "empty" });
  },
});
