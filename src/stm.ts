import type { Runnable } from "./data_value.ts";
import {
  type As,
  as_data_cached,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import {
  Applicative,
  applicative_lift_method,
  Functor,
  Monad,
  Show,
} from "./typeclasses.ts";

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
};

/** @ignore */
export type StmJournal = {
  readonly parent?: StmJournal;
  readonly reads: Map<TVar<unknown>, unknown>;
  readonly writes: Map<TVar<unknown>, unknown>;
};

type JournalStorage = {
  reads?: Map<TVar<unknown>, unknown>;
  writes?: Map<TVar<unknown>, unknown>;
  exposed?: Set<TVar<unknown>>;
  escaped: boolean;
};
class Journal implements StmJournal {
  readonly parent?: StmJournal;
  readonly storage: JournalStorage = { escaped: false };
  constructor(parent?: StmJournal) {
    this.parent = parent;
  }
  get reads(): Map<TVar<unknown>, unknown> {
    return this.storage.reads ??= new Map();
  }
  get writes(): Map<TVar<unknown>, unknown> {
    this.storage.escaped = true;
    return this.storage.writes ??= new Map();
  }
}
function create_journal(parent?: StmJournal): StmJournal {
  return new Journal(parent);
}
function storage_of(journal: StmJournal): JournalStorage | undefined {
  if (journal instanceof Journal) return journal.storage;
}

function reads_of(
  journal: StmJournal,
): Map<TVar<unknown>, unknown> | undefined {
  const storage = storage_of(journal);
  if (storage !== undefined) return storage.reads;
  return journal.reads;
}

function writes_of(
  journal: StmJournal,
): Map<TVar<unknown>, unknown> | undefined {
  const storage = storage_of(journal);
  if (storage !== undefined) return storage.writes;
  return journal.writes;
}

function writable(journal: StmJournal): Map<TVar<unknown>, unknown> {
  const storage = storage_of(journal);
  if (storage !== undefined) return storage.writes ??= new Map();
  return journal.writes;
}

function expose(journal: StmJournal, variable: TVar<unknown>): void {
  const storage = storage_of(journal);
  if (storage !== undefined) (storage.exposed ??= new Set()).add(variable);
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
    const storage = storage_of(journal);
    if (storage !== undefined) storage.escaped = true;
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
    [tvar_value]: snapshot_value(
      value,
      `initial value for TVar ${id}`,
      options.shape,
    ),
    [tvar_shape]: options.shape,
  };

  return variable;
}

/** Reads a TVar within a transaction. */
export function read_tvar<item>(variable: TVar<item>): Stm<item> {
  return trusted_stm((journal) => read_journal(journal, variable));
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
    }
  });
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
  }
}

Show.instance(Stm)({
  show() {
    return "Stm(?)";
  },
});

Functor.instance(Stm)({
  map(fn) {
    return trusted_stm((journal) => fn(run_stm(this, journal)));
  },
});

Applicative.instance(Stm)({
  pure(value) {
    return trusted_stm(() => value);
  },

  [applicative_lift_method](fn, rest) {
    const first = this.value();
    const transactions = rest.map((current) => current.value());

    return trusted_stm((journal) => {
      const values = [first(journal)];

      for (const transaction of transactions) {
        values.push(transaction(journal));
      }

      return fn(...values);
    });
  },

  ap(value) {
    return trusted_stm((journal) => {
      const fn = run_stm(this, journal);
      return fn(run_stm(value, journal));
    });
  },
});

Monad.instance(Stm)({
  bind(fn) {
    return trusted_stm((journal) => {
      const value = run_stm(this, journal);
      return run_stm(fn(value), journal);
    });
  },
});

function run_stm<item>(
  transaction: Stm<item>,
  journal: StmJournal,
): item {
  return transaction.value()(journal);
}

function read_journal<item>(
  journal: StmJournal,
  variable: TVar<item>,
): item {
  const key = variable as TVar<unknown>;

  const writes = writes_of(journal);
  if (writes?.has(key)) {
    expose(journal, key);
    return writes.get(key) as item;
  }
  const reads = reads_of(journal);
  if (reads?.has(key)) return reads.get(key) as item;

  const value = isolate_tvar(
    variable,
    lookup_journal(journal.parent, key, read_current(variable)) as item,
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
  writable(journal).set(
    variable as TVar<unknown>,
    isolate_tvar(
      variable,
      value,
      `value written to TVar ${read_tvar_id(variable)}`,
    ),
  );
}

function commit_journal(journal: StmJournal): void {
  const writes = writes_of(journal);
  if (writes === undefined) return;
  const storage = storage_of(journal);
  // Private staged clones have never escaped. Only exposed snapshots need a
  // second clone. Prepare every clone before publishing any TVar value.
  if (storage !== undefined && !storage.escaped) {
    // Preparation can reuse the private map: it cannot be retained by callbacks.
    for (const [variable, value] of writes) {
      if (storage.exposed?.has(variable)) {
        writes.set(
          variable,
          isolate_tvar(
            variable,
            value,
            `commit value for TVar ${read_tvar_id(variable)}`,
          ),
        );
      }
    }
    for (const [variable, value] of writes) write_current(variable, value);
    return;
  }
  const commits: [TVar<unknown>, unknown][] = [];
  for (const [variable, value] of writes) {
    commits.push([
      variable,
      isolate_tvar(
        variable,
        value,
        `commit value for TVar ${read_tvar_id(variable)}`,
      ),
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
    const writes = writes_of(current);
    if (writes?.has(variable)) return writes.get(variable);
    const reads = reads_of(current);
    if (reads?.has(variable)) return reads.get(variable);
  }
  return fallback;
}

function merge_journal(journal: StmJournal, branch: StmJournal): void {
  const reads = reads_of(branch);
  if (reads !== undefined) {
    for (const [variable, value] of reads) {
      if (writes_of(journal)?.has(variable)) {
        writable(journal).set(variable, value);
        expose(journal, variable);
      } else journal.reads.set(variable, value);
    }
  }
  const writes = writes_of(branch);
  if (writes !== undefined) {
    const branch_storage = storage_of(branch);
    for (const [variable, value] of writes) {
      writable(journal).set(variable, value);
      if (
        branch_storage === undefined || branch_storage.escaped ||
        branch_storage.exposed?.has(variable)
      ) expose(journal, variable);
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
function snapshot_value<item>(
  value: item,
  operation: string,
  shape?: SnapshotShape,
): item {
  if (shape !== undefined) {
    const copy = clone_shape(value, shape, new Map());
    if (copy !== shape_mismatch) return copy as item;
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
  if (keys.length !== Object.keys(shape.record).length) return shape_mismatch;
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
