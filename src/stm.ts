import type { Runnable } from "./data_value.ts";
import {
  type As,
  as_data_cached,
  type Data,
  data,
  kind,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { register_traversal } from "./traversal.ts";
import {
  Applicative,
  applicative_lift_method,
  Functor,
  Monad,
  Show,
} from "./typeclasses.ts";
import { type CustomDoRunner, do_runner_method } from "./typeclasses/monad.ts";

/** @ignore */
export const stm_identity: unique symbol = /* @__PURE__ */ Symbol(
  "stm_identity",
);

/** @ignore */
export const tvar_brand: unique symbol = /* @__PURE__ */ Symbol("TVar.brand");
const tvar_id = Symbol("TVar.id");
const tvar_value = Symbol("TVar.value");
const tvar_immutable = Symbol("TVar.immutable");
const tvar_shape = Symbol("TVar.shape");
const tvar_reader = Symbol("TVar.reader");
let next_tvar_id = 0;
let transaction_depth = 0;
const immutable_values = new WeakSet<object>();

/** A transactional reference whose item type is invariant. */
export type TVar<item> = {
  readonly [tvar_brand]: (item: item) => item;
};

type TVarBox<item> = TVar<item> & {
  readonly [tvar_id]: number;
  [tvar_value]: item;
  readonly [tvar_immutable]?: boolean;
  readonly [tvar_shape]?: SnapshotShape;
  [tvar_reader]?: Stm<item>;
};

/** @ignore */
export type StmJournal = {
  readonly parent?: StmJournal;
  readonly reads: Map<TVar<unknown>, unknown>;
  readonly writes: Map<TVar<unknown>, unknown>;
};

const journal_inline_limit = 8;

class Journal implements StmJournal {
  parent?: StmJournal;
  escaped = false;
  reads_map?: Map<TVar<unknown>, unknown>;
  writes_map?: Map<TVar<unknown>, unknown>;
  exposed_map?: Set<TVar<unknown>>;
  r0_k?: TVar<unknown>;
  r0_v: unknown = undefined;
  w0_k?: TVar<unknown>;
  w0_v: unknown = undefined;
  w0_exp = false;
  r_keys?: TVar<unknown>[];
  r_vals?: unknown[];
  w_keys?: TVar<unknown>[];
  w_vals?: unknown[];
  w_exp?: boolean[];

  constructor(parent?: StmJournal) {
    this.parent = parent;
  }

  promote_reads(): Map<TVar<unknown>, unknown> {
    if (this.reads_map !== undefined) return this.reads_map;
    const map = new Map<TVar<unknown>, unknown>();
    if (this.r0_k !== undefined) {
      map.set(this.r0_k, this.r0_v);
      this.r0_k = undefined;
      this.r0_v = undefined;
    }
    if (this.r_keys !== undefined) {
      const keys = this.r_keys;
      const vals = this.r_vals!;
      for (let index = 0; index < keys.length; index += 1) {
        map.set(keys[index], vals[index]);
      }
      this.r_keys = undefined;
      this.r_vals = undefined;
    }
    this.reads_map = map;
    return map;
  }

  promote_writes(): Map<TVar<unknown>, unknown> {
    if (this.writes_map !== undefined) return this.writes_map;
    const map = new Map<TVar<unknown>, unknown>();
    if (this.w0_k !== undefined) {
      map.set(this.w0_k, this.w0_v);
      if (this.w0_exp) (this.exposed_map ??= new Set()).add(this.w0_k);
      this.w0_k = undefined;
      this.w0_v = undefined;
      this.w0_exp = false;
    }
    if (this.w_keys !== undefined) {
      const keys = this.w_keys;
      const vals = this.w_vals!;
      const exp = this.w_exp!;
      for (let index = 0; index < keys.length; index += 1) {
        map.set(keys[index], vals[index]);
        if (exp[index]) (this.exposed_map ??= new Set()).add(keys[index]);
      }
      this.w_keys = undefined;
      this.w_vals = undefined;
      this.w_exp = undefined;
    }
    this.writes_map = map;
    return map;
  }

  get reads(): Map<TVar<unknown>, unknown> {
    return this.promote_reads();
  }

  get writes(): Map<TVar<unknown>, unknown> {
    this.escaped = true;
    return this.promote_writes();
  }

  set_read(key: TVar<unknown>, value: unknown): void {
    if (this.reads_map !== undefined) {
      this.reads_map.set(key, value);
      return;
    }
    if (this.r0_k === undefined || this.r0_k === key) {
      this.r0_k = key;
      this.r0_v = value;
      return;
    }
    const keys = this.r_keys;
    const vals = this.r_vals;
    if (keys === undefined) {
      this.r_keys = [key];
      this.r_vals = [value];
      return;
    }
    for (let index = 0; index < keys.length; index += 1) {
      if (keys[index] === key) {
        vals![index] = value;
        return;
      }
    }
    if (keys.length >= journal_inline_limit) {
      this.promote_reads().set(key, value);
      return;
    }
    keys.push(key);
    vals!.push(value);
  }

  set_write(key: TVar<unknown>, value: unknown, mark_exposed = false): void {
    if (this.writes_map !== undefined) {
      this.writes_map.set(key, value);
      if (mark_exposed) (this.exposed_map ??= new Set()).add(key);
      return;
    }
    if (this.w0_k === undefined || this.w0_k === key) {
      this.w0_k = key;
      this.w0_v = value;
      if (mark_exposed) this.w0_exp = true;
      return;
    }
    const keys = this.w_keys;
    const vals = this.w_vals;
    const exp = this.w_exp;
    if (keys === undefined) {
      this.w_keys = [key];
      this.w_vals = [value];
      this.w_exp = [mark_exposed];
      return;
    }
    for (let index = 0; index < keys.length; index += 1) {
      if (keys[index] === key) {
        vals![index] = value;
        if (mark_exposed) exp![index] = true;
        return;
      }
    }
    if (keys.length >= journal_inline_limit) {
      const map = this.promote_writes();
      map.set(key, value);
      if (mark_exposed) (this.exposed_map ??= new Set()).add(key);
      return;
    }
    keys.push(key);
    vals!.push(value);
    exp!.push(mark_exposed);
  }

  has_write(key: TVar<unknown>): boolean {
    if (this.writes_map !== undefined) return this.writes_map.has(key);
    return this.w0_k === key || (this.w_keys?.includes(key) ?? false);
  }

  mark_exposed(key: TVar<unknown>): void {
    if (this.writes_map !== undefined) {
      (this.exposed_map ??= new Set()).add(key);
    } else if (this.w0_k === key) {
      this.w0_exp = true;
    } else if (this.w_keys !== undefined) {
      const idx = this.w_keys.indexOf(key);
      if (idx >= 0) this.w_exp![idx] = true;
    }
  }
}

let reusable_journal: Journal | undefined;
let reusable_child_journal: Journal | undefined;

function create_journal(parent?: StmJournal): Journal {
  if (parent === undefined) {
    if (reusable_journal !== undefined) {
      const journal = reusable_journal;
      reusable_journal = undefined;
      return journal;
    }
    return new Journal(undefined);
  }
  if (reusable_child_journal !== undefined) {
    const journal = reusable_child_journal;
    reusable_child_journal = undefined;
    journal.parent = parent;
    return journal;
  }
  return new Journal(parent);
}

function reset_journal(journal: Journal): void {
  journal.r0_k = undefined;
  journal.r0_v = undefined;
  journal.w0_k = undefined;
  journal.w0_v = undefined;
  journal.w0_exp = false;
  if (journal.r_keys !== undefined) {
    journal.r_keys.length = 0;
    journal.r_vals!.length = 0;
  }
  if (journal.w_keys !== undefined) {
    journal.w_keys.length = 0;
    journal.w_vals!.length = 0;
    journal.w_exp!.length = 0;
  }
  if (journal.reads_map !== undefined) journal.reads_map = undefined;
  if (journal.writes_map !== undefined) journal.writes_map = undefined;
  if (journal.exposed_map !== undefined) journal.exposed_map = undefined;
}

function release_journal(journal: Journal): void {
  if (journal.escaped || journal.parent !== undefined) return;
  reset_journal(journal);
  reusable_journal = journal;
}

function release_child_journal(journal: Journal): void {
  if (journal.escaped) return;
  journal.parent = undefined;
  reset_journal(journal);
  reusable_child_journal = journal;
}

function journal_of(journal: StmJournal): Journal | undefined {
  return journal instanceof Journal ? journal : undefined;
}

function reads_of(
  journal: StmJournal,
): Map<TVar<unknown>, unknown> | undefined {
  const internal = journal_of(journal);
  if (internal !== undefined) return internal.reads_map;
  return journal.reads;
}

function writes_of(
  journal: StmJournal,
): Map<TVar<unknown>, unknown> | undefined {
  const internal = journal_of(journal);
  if (internal !== undefined) return internal.writes_map;
  return journal.writes;
}

function expose(journal: StmJournal, variable: TVar<unknown>): void {
  const internal = journal_of(journal);
  if (internal !== undefined) internal.mark_exposed(variable);
}

/** A synchronous transaction evaluated against an isolated journal. */
export type RawStm<item> = (journal: StmJournal) => item;

/** @ignore */
export interface AsStmLambda {
  readonly [type_item]: unknown;
  readonly [type_data]: RawStm<this[typeof type_item]>;
}

/** The callable dictionary for STM transactions. */
export interface AsStm
  extends
    As<AsStmLambda, typeof stm_identity>,
    Show<AsStm>,
    Monad<AsStm>,
    Runnable {
}

/** A wrapped Stm value with its dictionary operations. */
export type Stm<item> = Data<AsStm, item>;

/** The STM dictionary and transaction constructor. */
export const Stm: AsStm = data<AsStm>(stm_identity, function (transaction) {
  return this.data((journal) => {
    // Arbitrary callbacks can retain the raw journal. They cannot establish the
    // ownership proof used by the closed set of built-in operations.
    const internal = journal_of(journal);
    if (internal !== undefined) internal.escaped = true;
    return transaction(journal);
  });
});
const trusted_stm = as_data_cached(Stm);

/** An expected transaction failure raised by `abort` or unsafe nesting. */
export class StmError extends Error {
  /** Creates an STM failure with diagnostic context. */
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StmError";
  }
}

/** Signals that a transaction should try an available alternative. */
export class StmRetry extends Error {
  /** Creates an STM retry signal. */
  constructor() {
    super("Stm retry has no alternative");
    this.name = "StmRetry";
  }
}

/** A checked fast snapshot shape. Values outside the shape use structuredClone. */
export type SnapshotShape =
  | "number"
  | "string"
  | "boolean"
  | "null"
  | { readonly array: SnapshotShape }
  | { readonly record: Readonly<Record<string, SnapshotShape>> };

/** Creates a TVar whose structured-clone-safe values are isolated by transaction. */
export function new_tvar<item>(
  value: item,
  options: { readonly shape?: SnapshotShape } = {},
): TVar<item> {
  const id = next_tvar_id;
  next_tvar_id += 1;

  const variable: TVarBox<item> = {
    [tvar_brand]: undefined as unknown as (item: item) => item,
    [tvar_id]: id,
    [tvar_value]: is_primitive_value(value) ? value : snapshot_value(
      value,
      `initial value for TVar ${id}`,
      options.shape,
    ),
    [tvar_shape]: options.shape,
    [tvar_reader]: undefined,
  };

  return variable;
}

/** Reads a TVar within a transaction. */
export function read_tvar<item>(variable: TVar<item>): Stm<item> {
  const box = variable as TVarBox<item>;
  let cached = box[tvar_reader];
  if (cached === undefined) {
    cached = trusted_stm((journal) => read_journal(journal, variable));
    box[tvar_reader] = cached;
  }
  return cached;
}

/** Stages a new TVar value within a transaction. */
export function write_tvar<item>(
  variable: TVar<item>,
  value: item,
): Stm<void> {
  return trusted_stm((journal) => {
    write_journal(journal, variable, value);
  });
}

/** Updates and returns a TVar value within a transaction. */
export function modify_tvar<item>(
  variable: TVar<item>,
  fn: (value: item) => item,
): Stm<item> {
  return trusted_stm((journal) => {
    const next = fn(read_journal(journal, variable));
    write_journal(journal, variable, next);

    return next;
  });
}

/** Aborts a transaction with an explanatory message. */
export function abort<item = never>(message: string): Stm<item> {
  return trusted_stm(() => {
    throw new StmError(message);
  });
}

/** Abandons the current branch so `or_else` can run its alternative. */
export function retry<item = never>(): Stm<item> {
  return trusted_stm(() => {
    throw new StmRetry();
  });
}

/** Runs the right transaction only when the left transaction retries. */
export function or_else<item>(
  left: Stm<item>,
  right: Stm<item>,
): Stm<item> {
  return trusted_stm((journal) => {
    // The branch gets its own values before it can mutate them. Restoring map
    // entries afterward cannot restore references held by the enclosing program.
    const branch = create_journal(journal);

    try {
      const value = run_stm(left, branch);
      merge_journal(journal, branch);
      return value;
    } catch (error) {
      if (!(error instanceof StmRetry)) {
        throw error;
      }

      return run_stm(right, journal);
    } finally {
      release_child_journal(branch);
    }
  });
}

/** @ignore Create a trusted Stm value from compiler-generated journal code without disabling journal pooling. */
export function stm_trusted<item>(transaction: RawStm<item>): Stm<item> {
  return trusted_stm(transaction);
}

/** @ignore Read a TVar directly from an active STM journal (for compiler-lowered transactions). */
export function stm_read_journal<item>(
  journal: StmJournal,
  variable: TVar<item>,
): item {
  return read_journal(journal, variable);
}

/** @ignore Write a TVar directly into an active STM journal (for compiler-lowered transactions). */
export function stm_write_journal<item>(
  journal: StmJournal,
  variable: TVar<item>,
  value: item,
): void {
  write_journal(journal, variable, value);
}

/** @ignore Modify a TVar directly in an active STM journal (for compiler-lowered transactions). */
export function stm_modify_journal<item>(
  journal: StmJournal,
  variable: TVar<item>,
  fn: (value: item) => item,
): item {
  const next = fn(read_journal(journal, variable));
  write_journal(journal, variable, next);
  return next;
}

/** @ignore Execute a compiler-lowered journal callback atomically without allocating a Stm wrapper. */
export function stm_atomically_direct<item>(transaction: RawStm<item>): item {
  if (transaction_depth !== 0) {
    throw new StmError(
      "Nested atomically calls cannot join the active transaction",
    );
  }

  const journal = create_journal();
  transaction_depth += 1;

  try {
    const value = transaction(journal);
    commit_journal(journal);
    return value;
  } finally {
    transaction_depth -= 1;
    release_journal(journal);
  }
}

/** Runs and commits a transaction as one synchronous atomic step. */
export function atomically<item>(transaction: Stm<item>): item {
  if (transaction_depth !== 0) {
    throw new StmError(
      "Nested atomically calls cannot join the active transaction",
    );
  }

  const journal = create_journal();
  transaction_depth += 1;

  try {
    const value = run_stm(transaction, journal);

    commit_journal(journal);

    return value;
  } finally {
    transaction_depth -= 1;
    release_journal(journal);
  }
}

Show.instance(Stm)({
  show() {
    return "Stm(?)";
  },
});

Functor.instance(Stm)({
  map(fn) {
    const raw = this.value();
    return trusted_stm((journal) => fn(raw(journal)));
  },
});

Applicative.instance(Stm)({
  pure(value) {
    return trusted_stm(() => value);
  },

  [applicative_lift_method](fn, rest) {
    const first = this.value();
    const len = rest.length;

    if (len === 0) {
      return trusted_stm((journal) => fn(first(journal)));
    }
    if (len === 1) {
      const second = rest[0].value();
      return trusted_stm((journal) => fn(first(journal), second(journal)));
    }
    if (len === 2) {
      const second = rest[0].value();
      const third = rest[1].value();
      return trusted_stm((journal) =>
        fn(first(journal), second(journal), third(journal))
      );
    }

    const transactions = rest.map((current) => current.value());
    return trusted_stm((journal) => {
      const values = new Array<unknown>(len + 1);
      values[0] = first(journal);

      for (let i = 0; i < len; i += 1) {
        values[i + 1] = transactions[i](journal);
      }

      return fn(...values);
    });
  },

  ap(value) {
    const first = this.value();
    const second = value.value();
    return trusted_stm((journal) => first(journal)(second(journal)));
  },
});

Monad.instance(Stm)({
  bind(fn) {
    const raw = this.value();
    return trusted_stm((journal) => fn(raw(journal)).value()(journal));
  },
});

const stm_kind = Stm[kind];
const canonical_stm_bind = Stm.bind;
const canonical_stm_pure = Stm.pure;
const stm_do: CustomDoRunner = (first_value, first_iterator, run) => {
  const first = first_value as Stm<unknown>;
  if (
    first[kind] !== stm_kind || first.bind !== canonical_stm_bind ||
    first.pure !== canonical_stm_pure
  ) return undefined;
  const first_raw = first.value();
  let first_claimed = false;
  return trusted_stm((journal) => {
    const v0 = first_raw(journal);
    let iter: Generator<unknown, unknown, unknown>;
    let next: IteratorResult<unknown, unknown>;
    if (!first_claimed) {
      first_claimed = true;
      iter = first_iterator;
      next = iter.next(v0);
    } else {
      iter = run();
      const skipped = iter.next();
      if (skipped.done) return skipped.value;
      next = iter.next(v0);
    }
    while (!next.done) {
      const val = (next.value as Stm<unknown>).value()(journal);
      next = iter.next(val);
    }
    return next.value;
  });
};
Object.defineProperty(Stm, do_runner_method, { value: stm_do });

register_traversal(
  Stm,
  <from, to, result>(
    items: Iterable<from>,
    fn: (item: from) => Data<AsStm, to>,
    build: (items: Iterable<to>) => result,
  ): Data<AsStm, result> => {
    let fns: RawStm<to>[];
    if (Array.isArray(items)) {
      fns = new Array<RawStm<to>>(items.length);
      for (let i = 0; i < items.length; i += 1) {
        fns[i] = fn(items[i]).value();
      }
    } else {
      fns = [];
      for (const item of items) fns.push(fn(item).value());
    }
    return trusted_stm((journal) => {
      const out = new Array<to>(fns.length);
      for (let i = 0; i < fns.length; i += 1) out[i] = fns[i](journal);
      return build(out);
    });
  },
  <from, to>(
    items: readonly from[],
    fn: (item: from) => Data<AsStm, to>,
  ): Data<AsStm, to[]> => {
    const snapshot = items.slice();
    return trusted_stm((journal) => {
      const out = new Array<to>(snapshot.length);
      for (let i = 0; i < snapshot.length; i += 1) {
        out[i] = fn(snapshot[i]).value()(journal);
      }
      return out;
    });
  },
);

function run_stm<item>(
  transaction: Stm<item>,
  journal: StmJournal,
): item {
  return transaction.value()(journal);
}

const journal_miss = Symbol("Journal.miss");

function find_in_journal(
  internal: Journal,
  key: TVar<unknown>,
  mark_write_exposed: boolean,
): unknown {
  if (internal.writes_map !== undefined) {
    if (internal.writes_map.has(key)) {
      if (mark_write_exposed) (internal.exposed_map ??= new Set()).add(key);
      return internal.writes_map.get(key);
    }
  } else if (internal.w0_k !== undefined) {
    if (internal.w0_k === key) {
      if (mark_write_exposed) internal.w0_exp = true;
      return internal.w0_v;
    }
    const w_keys = internal.w_keys;
    if (w_keys !== undefined) {
      const idx = w_keys.indexOf(key);
      if (idx >= 0) {
        if (mark_write_exposed) internal.w_exp![idx] = true;
        return internal.w_vals![idx];
      }
    }
  }
  if (internal.reads_map !== undefined) {
    if (internal.reads_map.has(key)) return internal.reads_map.get(key);
  } else if (internal.r0_k !== undefined) {
    if (internal.r0_k === key) return internal.r0_v;
    const r_keys = internal.r_keys;
    if (r_keys !== undefined) {
      const idx = r_keys.indexOf(key);
      if (idx >= 0) return internal.r_vals![idx];
    }
  }
  return journal_miss;
}

function is_primitive_value(value: unknown): boolean {
  return (typeof value !== "object" && typeof value !== "function") ||
    value === null;
}

function read_journal<item>(
  journal: StmJournal,
  variable: TVar<item>,
): item {
  const key = variable as TVar<unknown>;
  const internal = journal_of(journal);
  if (internal !== undefined) {
    const found = find_in_journal(internal, key, true);
    if (found !== journal_miss) return found as item;
    const raw = (journal.parent === undefined
      ? read_current(variable)
      : lookup_journal(journal.parent, key, read_current(variable))) as item;
    const value = is_primitive_value(raw) ? raw : isolate_tvar(
      variable,
      raw,
      `value read from TVar ${read_tvar_id(variable)}`,
    );
    internal.set_read(key, value);
    return value;
  }

  const writes = writes_of(journal);
  if (writes?.has(key)) {
    expose(journal, key);
    return writes.get(key) as item;
  }
  const reads = reads_of(journal);
  if (reads?.has(key)) return reads.get(key) as item;

  const raw =
    (journal.parent === undefined
      ? read_current(variable)
      : lookup_journal(journal.parent, key, read_current(variable))) as item;
  const value = is_primitive_value(raw) ? raw : isolate_tvar(
    variable,
    raw,
    `value read from TVar ${read_tvar_id(variable)}`,
  );
  journal.reads.set(key, value);

  return value;
}

function write_journal<item>(
  journal: StmJournal,
  variable: TVar<item>,
  value: item,
): void {
  const isolated = is_primitive_value(value) ? value : isolate_tvar(
    variable,
    value,
    `value written to TVar ${read_tvar_id(variable)}`,
  );
  const internal = journal_of(journal);
  if (internal !== undefined) {
    internal.set_write(variable as TVar<unknown>, isolated);
    return;
  }
  journal.writes.set(variable as TVar<unknown>, isolated);
}

function isolate_commit(variable: TVar<unknown>, value: unknown): unknown {
  if (is_primitive_value(value)) return value;
  return isolate_tvar(
    variable,
    value,
    `commit value for TVar ${read_tvar_id(variable)}`,
  );
}

function commit_journal(journal: StmJournal): void {
  const internal = journal_of(journal);
  if (internal !== undefined && internal.writes_map === undefined) {
    if (internal.w0_k === undefined) return;
    const esc = internal.escaped;
    const v0 = esc || internal.w0_exp
      ? isolate_commit(internal.w0_k, internal.w0_v)
      : internal.w0_v;
    const keys = internal.w_keys;
    if (keys === undefined) {
      write_current(internal.w0_k, v0);
      return;
    }
    const vals = internal.w_vals!;
    const exp = internal.w_exp!;
    for (let index = 0; index < keys.length; index += 1) {
      if (esc || exp[index]) {
        vals[index] = isolate_commit(keys[index], vals[index]);
      }
    }
    write_current(internal.w0_k, v0);
    for (let index = 0; index < keys.length; index += 1) {
      write_current(keys[index], vals[index]);
    }
    return;
  }
  const writes = internal !== undefined
    ? internal.writes_map
    : writes_of(journal);
  if (writes === undefined) return;
  const esc = internal === undefined || internal.escaped;
  const commits: [TVar<unknown>, unknown][] = [];
  for (const [variable, value] of writes) {
    commits.push([
      variable,
      esc || internal.exposed_map?.has(variable)
        ? isolate_commit(variable, value)
        : value,
    ]);
  }
  for (const [variable, value] of commits) write_current(variable, value);
}

function lookup_journal(
  journal: StmJournal | undefined,
  variable: TVar<unknown>,
  fallback: unknown,
): unknown {
  for (let current = journal; current !== undefined; current = current.parent) {
    const internal = journal_of(current);
    if (internal !== undefined) {
      const found = find_in_journal(internal, variable, false);
      if (found !== journal_miss) return found;
      continue;
    }
    const writes = writes_of(current);
    if (writes?.has(variable)) return writes.get(variable);
    const reads = reads_of(current);
    if (reads?.has(variable)) return reads.get(variable);
  }
  return fallback;
}

function merge_journal_read(
  journal: StmJournal,
  target: Journal | undefined,
  variable: TVar<unknown>,
  value: unknown,
): void {
  if (target !== undefined) {
    if (target.has_write(variable)) target.set_write(variable, value, true);
    else target.set_read(variable, value);
  } else if (writes_of(journal)?.has(variable)) {
    journal.writes.set(variable, value);
    expose(journal, variable);
  } else {
    journal.reads.set(variable, value);
  }
}

function merge_journal_write(
  journal: StmJournal,
  target: Journal | undefined,
  variable: TVar<unknown>,
  value: unknown,
  is_exposed: boolean,
): void {
  if (target !== undefined) {
    target.set_write(variable, value, is_exposed);
  } else {
    journal.writes.set(variable, value);
    if (is_exposed) expose(journal, variable);
  }
}

function merge_journal(journal: StmJournal, branch: StmJournal): void {
  const target = journal_of(journal);
  const source = journal_of(branch);
  if (source !== undefined) {
    if (source.reads_map !== undefined) {
      for (const [variable, value] of source.reads_map) {
        merge_journal_read(journal, target, variable, value);
      }
    } else if (source.r0_k !== undefined) {
      merge_journal_read(journal, target, source.r0_k, source.r0_v);
      const r_keys = source.r_keys;
      if (r_keys !== undefined) {
        const r_vals = source.r_vals!;
        for (let index = 0; index < r_keys.length; index += 1) {
          merge_journal_read(journal, target, r_keys[index], r_vals[index]);
        }
      }
    }
    if (source.writes_map !== undefined) {
      for (const [variable, value] of source.writes_map) {
        merge_journal_write(
          journal,
          target,
          variable,
          value,
          source.escaped || (source.exposed_map?.has(variable) ?? false),
        );
      }
    } else if (source.w0_k !== undefined) {
      merge_journal_write(
        journal,
        target,
        source.w0_k,
        source.w0_v,
        source.escaped || source.w0_exp,
      );
      const w_keys = source.w_keys;
      if (w_keys !== undefined) {
        const w_vals = source.w_vals!;
        const w_exp = source.w_exp!;
        for (let index = 0; index < w_keys.length; index += 1) {
          merge_journal_write(
            journal,
            target,
            w_keys[index],
            w_vals[index],
            source.escaped || w_exp[index],
          );
        }
      }
    }
    return;
  }
  const reads = reads_of(branch);
  if (reads !== undefined) {
    for (const [variable, value] of reads) {
      merge_journal_read(journal, target, variable, value);
    }
  }
  const writes = writes_of(branch);
  if (writes !== undefined) {
    for (const [variable, value] of writes) {
      merge_journal_write(journal, target, variable, value, true);
    }
  }
}

function read_current<item>(variable: TVar<item>): item {
  return (variable as TVarBox<item>)[tvar_value];
}

function write_current<item>(variable: TVar<item>, value: item): void {
  (variable as TVarBox<item>)[tvar_value] = value;
}

function read_tvar_id<item>(variable: TVar<item>): number {
  return (variable as TVarBox<unknown>)[tvar_id];
}

function isolate_value<item>(value: item, operation: string): item {
  if (
    (typeof value !== "object" && typeof value !== "function") || value === null
  ) {
    return value;
  }

  let isolated: item;

  try {
    isolated = structuredClone(value);
  } catch (cause) {
    const evidence = cause instanceof Error ? cause.message : String(cause);
    throw new StmError(`${operation} is not rollback-safe: ${evidence}`, {
      cause,
    });
  }

  if (contains_shared_memory(isolated, new WeakSet())) {
    throw new StmError(
      `${operation} is not rollback-safe: SharedArrayBuffer memory cannot be isolated`,
    );
  }

  return isolated;
}

function contains_shared_memory(
  value: unknown,
  seen: WeakSet<object>,
): boolean {
  if (
    typeof SharedArrayBuffer !== "undefined" &&
    value instanceof SharedArrayBuffer
  ) {
    return true;
  }

  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (seen.has(value)) {
    return false;
  }

  seen.add(value);

  if (ArrayBuffer.isView(value)) {
    return typeof SharedArrayBuffer !== "undefined" &&
      value.buffer instanceof SharedArrayBuffer;
  }

  if (value instanceof Map) {
    for (const [key, current] of value) {
      if (
        contains_shared_memory(key, seen) ||
        contains_shared_memory(current, seen)
      ) {
        return true;
      }
    }

    return false;
  }

  if (value instanceof Set) {
    for (const current of value) {
      if (contains_shared_memory(current, seen)) {
        return true;
      }
    }

    return false;
  }

  for (const current of Object.values(value)) {
    if (contains_shared_memory(current, seen)) {
      return true;
    }
  }

  return false;
}

/** Creates a reference whose isolated plain records and arrays are deeply frozen.
 * Mutable built-ins, accessors, functions and symbol properties are rejected.
 */
export function new_immutable_tvar<item>(value: item): TVar<item> {
  validate_immutable(value, new WeakSet());
  const variable = new_tvar(value) as TVarBox<item>;
  Object.defineProperty(variable, tvar_immutable, { value: true });
  freeze_immutable(variable[tvar_value], new WeakSet());
  return variable;
}

function isolate_tvar<item>(
  variable: TVar<item>,
  value: item,
  operation: string,
): item {
  if ((variable as TVarBox<item>)[tvar_immutable]) {
    if (typeof value !== "object" || value === null) {
      if (typeof value !== "function") return value;
    } else if (immutable_values.has(value)) return value;
    validate_immutable(value, new WeakSet());
    if (is_deeply_frozen(value, new WeakSet())) return value;
    const isolated = isolate_value(value, operation);
    freeze_immutable(isolated, new WeakSet());
    return isolated;
  }
  return snapshot_value(
    value,
    operation,
    (variable as TVarBox<item>)[tvar_shape],
  );
}

const shape_mismatch = Symbol("snapshot shape mismatch");
const record_shape_keys = new WeakMap<object, readonly string[]>();
function record_shape_key_count(record: Record<string, SnapshotShape>): number {
  let keys = record_shape_keys.get(record);
  if (keys === undefined) {
    keys = Object.keys(record);
    record_shape_keys.set(record, keys);
  }
  return keys.length;
}
function snapshot_value<item>(
  value: item,
  operation: string,
  shape?: SnapshotShape,
): item {
  if (shape !== undefined) {
    if (typeof shape === "string") {
      if (
        (shape === "null" && value === null) ||
        (shape === "number" && typeof value === "number") ||
        (shape === "string" && typeof value === "string") ||
        (shape === "boolean" && typeof value === "boolean")
      ) return value;
    } else {
      const copy = clone_shape(value, shape, new Map());
      if (copy !== shape_mismatch) return copy as item;
    }
  }
  return isolate_value(value, operation);
}

function clone_shape(
  value: unknown,
  shape: SnapshotShape,
  copies: Map<object, unknown>,
): unknown {
  if (typeof shape === "string") {
    switch (shape) {
      case "null":
        if (value === null) return null;
        break;
      case "number":
        if (typeof value === "number") return value;
        break;
      case "string":
        if (typeof value === "string") return value;
        break;
      case "boolean":
        if (typeof value === "boolean") return value;
        break;
    }
    return shape_mismatch;
  }
  if (typeof value !== "object" || value === null) return shape_mismatch;
  if (copies.has(value)) return copies.get(value);
  if ("array" in shape) {
    if (!Array.isArray(value)) return shape_mismatch;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1) return shape_mismatch;
    const copy: unknown[] = new Array(value.length);
    copies.set(value, copy);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined || !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return shape_mismatch;
      }
      const child = clone_shape(descriptor.value, shape.array, copies);
      if (child === shape_mismatch) return shape_mismatch;
      copy[index] = child;
    }
    return copy;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return shape_mismatch;
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== record_shape_key_count(shape.record)) {
    return shape_mismatch;
  }
  const copy: Record<string, unknown> = {};
  copies.set(value, copy);
  for (const key of keys) {
    if (typeof key !== "string" || !Object.hasOwn(shape.record, key)) {
      return shape_mismatch;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !("value" in descriptor)) {
      return shape_mismatch;
    }
    const child = clone_shape(descriptor.value, shape.record[key], copies);
    if (child === shape_mismatch) return shape_mismatch;
    if (key === "__proto__") {
      Object.defineProperty(copy, key, {
        value: child,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    } else copy[key] = child;
  }
  return copy;
}

/** Updates one path in a deeply frozen plain-data TVar, sharing other branches.
 * The callback receives a frozen value. Its replacement is isolated before use.
 */
export function update_immutable_path<item>(
  variable: TVar<item>,
  path: readonly (string | number)[],
  update: (value: unknown) => unknown,
): Stm<item> {
  if (!(variable as TVarBox<item>)[tvar_immutable]) {
    throw new StmError("Path updates require an immutable TVar");
  }
  return trusted_stm((journal) => {
    const current = read_journal(journal, variable);
    const replace = (value: unknown, depth: number): unknown => {
      if (depth === path.length) {
        return isolate_tvar(
          variable as TVar<unknown>,
          update(value),
          "immutable path update",
        );
      }
      if (typeof value !== "object" || value === null) {
        throw new StmError("Immutable path crosses a non-container value");
      }
      const key = path[depth];
      if (
        !Object.hasOwn(value, key) || (Array.isArray(value) && key === "length")
      ) {
        throw new StmError("Immutable path does not exist or is array length");
      }
      const child = replace(
        (value as Record<string | number, unknown>)[key],
        depth + 1,
      );
      if (child === (value as Record<string | number, unknown>)[key]) {
        return value;
      }
      let copy: Record<string | number, unknown> | unknown[];
      if (Array.isArray(value)) {
        copy = new Array(value.length);
        for (const key of Object.keys(value)) {
          Object.defineProperty(copy, key, {
            value: (value as unknown as Record<string, unknown>)[key],
            enumerable: true,
            configurable: true,
            writable: true,
          });
        }
      } else copy = { ...value };
      Object.defineProperty(copy, key, {
        value: child,
        enumerable: true,
        configurable: true,
        writable: true,
      });
      Object.freeze(copy);
      immutable_values.add(copy);
      return copy;
    };
    const next = replace(current, 0) as item;
    write_journal(journal, variable, next);
    return next;
  });
}

function validate_immutable(value: unknown, seen: WeakSet<object>): void {
  if (typeof value === "function") {
    throw new StmError("Immutable TVars require plain data");
  }
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  const prototype = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value) && prototype !== Object.prototype &&
    prototype !== null
  ) {
    throw new StmError("Immutable TVars require plain records and arrays");
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") {
      throw new StmError("Immutable TVars reject symbol properties");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in descriptor)) {
      throw new StmError("Immutable TVars reject accessors");
    }
    if (!descriptor.enumerable && !(Array.isArray(value) && key === "length")) {
      throw new StmError("Immutable TVars reject non-enumerable properties");
    }
    validate_immutable(descriptor.value, seen);
  }
}

function freeze_immutable(value: unknown, seen: WeakSet<object>): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  for (const child of Object.values(value)) freeze_immutable(child, seen);
  Object.freeze(value);
  immutable_values.add(value);
}

function is_deeply_frozen(value: unknown, seen: WeakSet<object>): boolean {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return true;
  }
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  for (const child of Object.values(value)) {
    if (!is_deeply_frozen(child, seen)) return false;
  }
  return true;
}
