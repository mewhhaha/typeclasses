import {
  type As,
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
export declare const stm_identity: unique symbol;

/** @ignore */
export const tvar_brand: unique symbol = Symbol("TVar.brand");
const tvar_id = Symbol("TVar.id");
const tvar_value = Symbol("TVar.value");
const tvar_immutable = Symbol("TVar.immutable");
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
};

/** @ignore */
export type StmJournal = {
  readonly parent?: StmJournal;
  readonly reads: Map<TVar<unknown>, unknown>;
  readonly writes: Map<TVar<unknown>, unknown>;
};

/** A synchronous transaction evaluated against an isolated journal. */
export type Stm<item> = (journal: StmJournal) => item;

/** The callable dictionary for STM transactions. */
export interface AsStm
  extends As<AsStm, typeof stm_identity>, Show<AsStm>, Monad<AsStm> {
  /** The item produced by an STM transaction. */
  readonly [type_item]: unknown;
  /** The journal-dependent computation represented by an STM value. */
  readonly [type_data]: Stm<this[typeof type_item]>;
}

/** @ignore */
export type StmValue<item> = Data<AsStm, item>;

/** The STM dictionary and transaction constructor. */
export const Stm: AsStm = data<AsStm>();

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

/** Creates a TVar whose structured-clone-safe values are isolated by transaction. */
export function new_tvar<item>(value: item): TVar<item> {
  const id = next_tvar_id;
  next_tvar_id += 1;

  const variable: TVarBox<item> = {
    [tvar_brand]: undefined as unknown as (item: item) => item,
    [tvar_id]: id,
    [tvar_value]: isolate_value(value, `initial value for TVar ${id}`),
  };

  return variable;
}

/** Reads a TVar within a transaction. */
export function read_tvar<item>(variable: TVar<item>): StmValue<item> {
  return Stm((journal) => read_journal(journal, variable));
}

/** Stages a new TVar value within a transaction. */
export function write_tvar<item>(
  variable: TVar<item>,
  value: item,
): StmValue<void> {
  return Stm((journal) => {
    write_journal(journal, variable, value);
  });
}

/** Updates and returns a TVar value within a transaction. */
export function modify_tvar<item>(
  variable: TVar<item>,
  fn: (value: item) => item,
): StmValue<item> {
  return Stm((journal) => {
    const next = fn(read_journal(journal, variable));
    write_journal(journal, variable, next);

    return next;
  });
}

/** Aborts a transaction with an explanatory message. */
export function abort<item = never>(message: string): StmValue<item> {
  return Stm(() => {
    throw new StmError(message);
  });
}

/** Abandons the current branch so `or_else` can run its alternative. */
export function retry<item = never>(): StmValue<item> {
  return Stm(() => {
    throw new StmRetry();
  });
}

/** Runs the right transaction only when the left transaction retries. */
export function or_else<item>(
  left: StmValue<item>,
  right: StmValue<item>,
): StmValue<item> {
  return Stm((journal) => {
    // The branch gets its own values before it can mutate them. Restoring map
    // entries afterward cannot restore references held by the enclosing program.
    const branch: StmJournal = {
      parent: journal,
      reads: new Map(),
      writes: new Map(),
    };

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
export function atomically<item>(transaction: StmValue<item>): item {
  if (transaction_depth !== 0) {
    throw new StmError(
      "Nested atomically calls cannot join the active transaction",
    );
  }

  const journal: StmJournal = { reads: new Map(), writes: new Map() };
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
    return Stm((journal) => fn(run_stm(this, journal)));
  },
});

Applicative.instance(Stm)({
  pure(value) {
    return Stm(() => value);
  },

  [applicative_lift_method](fn, rest) {
    const first = this.value();
    const transactions = rest.map((current) => current.value());

    return Stm((journal) => {
      const values = [first(journal)];

      for (const transaction of transactions) {
        values.push(transaction(journal));
      }

      return fn(...values);
    });
  },

  ap(value) {
    return Stm((journal) => {
      const fn = run_stm(this, journal);
      return fn(run_stm(value, journal));
    });
  },
});

Monad.instance(Stm)({
  bind(fn) {
    return Stm((journal) => {
      const value = run_stm(this, journal);
      return run_stm(fn(value), journal);
    });
  },
});

function run_stm<item>(
  transaction: StmValue<item>,
  journal: StmJournal,
): item {
  return transaction.value()(journal);
}

function read_journal<item>(
  journal: StmJournal,
  variable: TVar<item>,
): item {
  const key = variable as TVar<unknown>;

  if (journal.writes.has(key)) {
    return journal.writes.get(key) as item;
  }

  if (journal.reads.has(key)) {
    return journal.reads.get(key) as item;
  }

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
  journal.writes.set(
    variable as TVar<unknown>,
    isolate_tvar(
      variable,
      value,
      `value written to TVar ${read_tvar_id(variable)}`,
    ),
  );
}

function commit_journal(journal: StmJournal): void {
  const commits = snapshot_tvar_values(journal.writes, "commit value");

  for (const [variable, value] of commits) {
    write_current(variable, value);
  }
}

function lookup_journal(
  journal: StmJournal | undefined,
  variable: TVar<unknown>,
  fallback: unknown,
): unknown {
  for (let current = journal; current !== undefined; current = current.parent) {
    if (current.writes.has(variable)) return current.writes.get(variable);
    if (current.reads.has(variable)) return current.reads.get(variable);
  }
  return fallback;
}

function merge_journal(journal: StmJournal, branch: StmJournal): void {
  for (const [variable, value] of branch.reads) {
    if (journal.writes.has(variable)) journal.writes.set(variable, value);
    else journal.reads.set(variable, value);
  }
  for (const [variable, value] of branch.writes) {
    journal.writes.set(variable, value);
  }
}

function snapshot_tvar_values(
  values: ReadonlyMap<TVar<unknown>, unknown>,
  operation: string,
): Map<TVar<unknown>, unknown> {
  const snapshot = new Map<TVar<unknown>, unknown>();

  for (const [variable, value] of values) {
    snapshot.set(
      variable,
      isolate_tvar(
        variable,
        value,
        `${operation} for TVar ${read_tvar_id(variable)}`,
      ),
    );
  }

  return snapshot;
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
  return isolate_value(value, operation);
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
