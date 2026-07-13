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
let next_tvar_id = 0;
let transaction_depth = 0;

/** A transactional reference whose item type is invariant. */
export type TVar<item> = {
  readonly [tvar_brand]: (item: item) => item;
};

type TVarBox<item> = TVar<item> & {
  readonly [tvar_id]: number;
  [tvar_value]: item;
};

/** @ignore */
export type StmJournal = {
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
    const snapshot = snapshot_journal(journal);

    try {
      return run_stm(left, journal);
    } catch (error) {
      if (!(error instanceof StmRetry)) {
        throw error;
      }

      restore_journal(journal, snapshot);
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

  const value = isolate_value(
    read_current(variable),
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
    isolate_value(value, `value written to TVar ${read_tvar_id(variable)}`),
  );
}

function commit_journal(journal: StmJournal): void {
  const commits = snapshot_tvar_values(journal.writes, "commit value");

  for (const [variable, value] of commits) {
    write_current(variable, value);
  }
}

function restore_journal(
  journal: StmJournal,
  snapshot: StmJournal,
): void {
  journal.reads.clear();
  journal.writes.clear();

  for (const [variable, value] of snapshot.reads) {
    journal.reads.set(variable, value);
  }

  for (const [variable, value] of snapshot.writes) {
    journal.writes.set(variable, value);
  }
}

function snapshot_journal(journal: StmJournal): StmJournal {
  return {
    reads: snapshot_tvar_values(journal.reads, "read snapshot"),
    writes: snapshot_tvar_values(journal.writes, "write snapshot"),
  };
}

function snapshot_tvar_values(
  values: ReadonlyMap<TVar<unknown>, unknown>,
  operation: string,
): Map<TVar<unknown>, unknown> {
  const snapshot = new Map<TVar<unknown>, unknown>();

  for (const [variable, value] of values) {
    snapshot.set(
      variable,
      isolate_value(value, `${operation} for TVar ${read_tvar_id(variable)}`),
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
