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
const tvar_compiled_shape = Symbol("TVar.compiled_shape");
const tvar_flags = Symbol("TVar.flags");
const tvar_reader = Symbol("TVar.reader");
const stm_direct_read = Symbol("Stm.direct_read");
const stm_direct_write_var = Symbol("Stm.direct_write_var");
const stm_direct_write_val = Symbol("Stm.direct_write_val");
const stm_plan_sym = Symbol("Stm.plan");

const FLAG_NONE = 0;
const FLAG_SHAPE_VALID = 1;
const FLAG_PLAIN_TREE = 2;
const FLAG_PLAIN_GRAPH = 4;
const FLAG_PLAIN_FLAT_RECORD = 8;
const FLAG_PLAIN_PRIM_ARRAY = 16;

const has_sab = typeof SharedArrayBuffer !== "undefined";

let next_tvar_id = 0;
let transaction_depth = 0;
let or_else_depth = 0;
let last_isolate_flags = FLAG_NONE;
const immutable_values = new WeakSet<object>();
const exotic_immutable_arrays = new WeakSet<object>();
const primitive_arrays = new WeakSet<object>();

/** A transactional reference whose item type is invariant. */
export type TVar<item> = {
  readonly [tvar_brand]: (item: item) => item;
};

type TVarBox<item> = TVar<item> & {
  readonly [tvar_id]: number;
  [tvar_value]: item;
  readonly [tvar_immutable]: boolean;
  readonly [tvar_shape]: SnapshotShape | undefined;
  readonly [tvar_compiled_shape]: CompiledShape | undefined;
  [tvar_flags]: number;
  [tvar_reader]: Stm<item> | undefined;
};

type DirectStm<item> = Stm<item> & {
  [stm_direct_read]?: TVar<item>;
  [stm_direct_write_var]?: TVar<unknown>;
  [stm_direct_write_val]?: unknown;
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
  flags_map?: Map<TVar<unknown>, number>;
  r0_k?: TVar<unknown>;
  r0_v: unknown = undefined;
  w0_k?: TVar<unknown>;
  w0_v: unknown = undefined;
  w0_exp = false;
  w0_flags = FLAG_NONE;
  r_keys?: TVar<unknown>[];
  r_vals?: unknown[];
  w_keys?: TVar<unknown>[];
  w_vals?: unknown[];
  w_exp?: boolean[];
  w_flags?: number[];

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
      if (this.w0_flags !== FLAG_NONE) {
        (this.flags_map ??= new Map()).set(this.w0_k, this.w0_flags);
      }
      this.w0_k = undefined;
      this.w0_v = undefined;
      this.w0_exp = false;
      this.w0_flags = FLAG_NONE;
    }
    if (this.w_keys !== undefined) {
      const keys = this.w_keys;
      const vals = this.w_vals!;
      const exp = this.w_exp!;
      const flags = this.w_flags!;
      for (let index = 0; index < keys.length; index += 1) {
        const k = keys[index];
        map.set(k, vals[index]);
        if (exp[index]) (this.exposed_map ??= new Set()).add(k);
        if (flags[index] !== FLAG_NONE) {
          (this.flags_map ??= new Map()).set(k, flags[index]);
        }
      }
      this.w_keys = undefined;
      this.w_vals = undefined;
      this.w_exp = undefined;
      this.w_flags = undefined;
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

  set_write(
    key: TVar<unknown>,
    value: unknown,
    mark_exposed = false,
    flags = FLAG_NONE,
  ): void {
    if (this.writes_map !== undefined) {
      this.writes_map.set(key, value);
      if (mark_exposed) (this.exposed_map ??= new Set()).add(key);
      if (flags !== FLAG_NONE) {
        (this.flags_map ??= new Map()).set(key, flags);
      } else if (this.flags_map !== undefined) {
        this.flags_map.delete(key);
      }
      return;
    }
    if (this.w0_k === undefined || this.w0_k === key) {
      this.w0_k = key;
      this.w0_v = value;
      if (mark_exposed) this.w0_exp = true;
      this.w0_flags = flags;
      return;
    }
    const keys = this.w_keys;
    const vals = this.w_vals;
    const exp = this.w_exp;
    const w_flags = this.w_flags;
    if (keys === undefined) {
      this.w_keys = [key];
      this.w_vals = [value];
      this.w_exp = [mark_exposed];
      this.w_flags = [flags];
      return;
    }
    for (let index = 0; index < keys.length; index += 1) {
      if (keys[index] === key) {
        vals![index] = value;
        if (mark_exposed) exp![index] = true;
        w_flags![index] = flags;
        return;
      }
    }
    if (keys.length >= journal_inline_limit) {
      const map = this.promote_writes();
      map.set(key, value);
      if (mark_exposed) (this.exposed_map ??= new Set()).add(key);
      if (flags !== FLAG_NONE) {
        (this.flags_map ??= new Map()).set(key, flags);
      }
      return;
    }
    keys.push(key);
    vals!.push(value);
    exp!.push(mark_exposed);
    w_flags!.push(flags);
  }

  merge_read(key: TVar<unknown>, value: unknown): void {
    if (this.writes_map !== undefined) {
      if (this.writes_map.has(key)) {
        this.writes_map.set(key, value);
        (this.exposed_map ??= new Set()).add(key);
        this.flags_map?.delete(key);
        return;
      }
    } else if (this.w0_k !== undefined) {
      if (this.w0_k === key) {
        this.w0_v = value;
        this.w0_exp = true;
        this.w0_flags = FLAG_NONE;
        return;
      }
      const w_keys = this.w_keys;
      if (w_keys !== undefined && w_keys.length > 0) {
        const idx = w_keys.indexOf(key);
        if (idx >= 0) {
          this.w_vals![idx] = value;
          this.w_exp![idx] = true;
          this.w_flags![idx] = FLAG_NONE;
          return;
        }
      }
    }
    this.set_read(key, value);
  }

  mark_exposed(key: TVar<unknown>): void {
    if (this.writes_map !== undefined) {
      (this.exposed_map ??= new Set()).add(key);
    } else if (this.w0_k === key) {
      this.w0_exp = true;
    } else if (this.w_keys !== undefined && this.w_keys.length > 0) {
      const idx = this.w_keys.indexOf(key);
      if (idx >= 0) this.w_exp![idx] = true;
    }
  }
}

let reusable_journal: Journal | undefined;
const child_journal_pool: Journal[] = [];
const child_journal_pool_limit = 8;

function create_journal(parent?: StmJournal): Journal {
  if (parent === undefined) {
    if (reusable_journal !== undefined) {
      const journal = reusable_journal;
      reusable_journal = undefined;
      return journal;
    }
    return new Journal(undefined);
  }
  if (child_journal_pool.length > 0) {
    const journal = child_journal_pool.pop()!;
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
  journal.w0_flags = FLAG_NONE;
  if (journal.r_keys !== undefined) {
    journal.r_keys.length = 0;
    journal.r_vals!.length = 0;
  }
  if (journal.w_keys !== undefined) {
    journal.w_keys.length = 0;
    journal.w_vals!.length = 0;
    journal.w_exp!.length = 0;
    journal.w_flags!.length = 0;
  }
  if (journal.reads_map !== undefined) journal.reads_map = undefined;
  if (journal.writes_map !== undefined) journal.writes_map = undefined;
  if (journal.exposed_map !== undefined) journal.exposed_map = undefined;
  if (journal.flags_map !== undefined) journal.flags_map = undefined;
}

function release_journal(journal: Journal): void {
  if (journal.escaped || journal.parent !== undefined) return;
  reset_journal(journal);
  reusable_journal = journal;
}

function release_child_journal(journal: Journal): void {
  if (journal.escaped) return;
  journal.parent = undefined;
  if (child_journal_pool.length >= child_journal_pool_limit) return;
  reset_journal(journal);
  child_journal_pool.push(journal);
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

const stm_retry_sentinel: StmRetry = Object.create(StmRetry.prototype);
Object.defineProperties(stm_retry_sentinel, {
  name: {
    value: "StmRetry",
    writable: true,
    enumerable: false,
    configurable: true,
  },
  message: {
    value: "Stm retry has no alternative",
    writable: true,
    enumerable: false,
    configurable: true,
  },
});

const retry_stm: Stm<never> = trusted_stm(() => {
  throw or_else_depth > 0 ? stm_retry_sentinel : new StmRetry();
});

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
  options?: { readonly shape?: SnapshotShape },
): TVar<item> {
  const id = next_tvar_id;
  next_tvar_id += 1;
  const shape = options?.shape;
  const compiled = shape !== undefined ? compile_shape(shape) : undefined;
  let stored: item;
  let flags = FLAG_NONE;
  if (is_primitive_value(value)) {
    stored = value;
  } else {
    stored = snapshot_untrusted(
      value,
      "initial value for TVar",
      id,
      compiled,
    );
    flags = last_isolate_flags;
  }

  const variable: TVarBox<item> = {
    [tvar_brand]: undefined as unknown as (item: item) => item,
    [tvar_id]: id,
    [tvar_value]: stored,
    [tvar_immutable]: false,
    [tvar_shape]: shape,
    [tvar_compiled_shape]: compiled,
    [tvar_flags]: flags,
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
    (cached as DirectStm<item>)[stm_direct_read] = variable;
    box[tvar_reader] = cached;
  }
  return cached;
}

/** Stages a new TVar value within a transaction. */
export function write_tvar<item>(
  variable: TVar<item>,
  value: item,
): Stm<void> {
  const action = trusted_stm((journal) => {
    write_journal(journal, variable, value);
  });
  (action as DirectStm<void>)[stm_direct_write_var] = variable as TVar<unknown>;
  (action as DirectStm<void>)[stm_direct_write_val] = value;
  return action;
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
  return retry_stm as Stm<item>;
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

    or_else_depth += 1;
    try {
      const value = run_stm(left, branch);
      merge_journal(journal, branch);
      return value;
    } catch (error) {
      if (error !== stm_retry_sentinel && !(error instanceof StmRetry)) {
        throw error;
      }
    } finally {
      or_else_depth -= 1;
      release_child_journal(branch);
    }

    return run_stm(right, journal);
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

  const direct = transaction as DirectStm<item>;
  const read_var = direct[stm_direct_read];
  if (read_var !== undefined) {
    const box = read_var as TVarBox<item>;
    const raw = box[tvar_value];
    if (is_primitive_value(raw) || box[tvar_immutable]) {
      return raw;
    }
    return read_trusted_current(box, raw);
  }

  const write_var = direct[stm_direct_write_var];
  if (write_var !== undefined) {
    const val = direct[stm_direct_write_val];
    const box = write_var as TVarBox<unknown>;
    if (is_primitive_value(val)) {
      box[tvar_value] = val;
      box[tvar_flags] = FLAG_NONE;
      return undefined as item;
    }
    transaction_depth += 1;
    try {
      const isolated = isolate_tvar(write_var, val, "value written to TVar");
      box[tvar_value] = isolated;
      box[tvar_flags] = last_isolate_flags;
      return undefined as item;
    } finally {
      transaction_depth -= 1;
    }
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

type StmPlan =
  | {
    readonly tag: 0;
    readonly apply: (value: unknown) => unknown;
    readonly source: RawStm<unknown>;
    runs: number;
  }
  | {
    readonly tag: 1;
    readonly apply: (value: unknown) => Stm<unknown>;
    readonly source: RawStm<unknown>;
    runs: number;
  };

type CompiledStmPlan = {
  readonly source: RawStm<unknown>;
  readonly frames: readonly StmPlan[];
};

type PlannedRawStm = RawStm<unknown> & { [stm_plan_sym]?: StmPlan };

function stm_plan_of(fn: RawStm<unknown>): StmPlan | undefined {
  return (fn as PlannedRawStm)[stm_plan_sym];
}

function compose_stm_plan(plan: StmPlan): RawStm<unknown> {
  const composed: PlannedRawStm = (journal) => run_stm_plan(plan, journal);
  composed[stm_plan_sym] = plan;
  return composed;
}

const hot_stm_plans = new Map<StmPlan, CompiledStmPlan>();
let hot_stm_frames = 0;

function retain_hot_stm(plan: StmPlan, segment: CompiledStmPlan): void {
  if (hot_stm_plans.has(plan) || segment.frames.length > 4096) return;
  hot_stm_plans.set(plan, segment);
  hot_stm_frames += segment.frames.length;
  while (hot_stm_frames > 4096) {
    const oldest = hot_stm_plans.entries().next().value!;
    hot_stm_plans.delete(oldest[0]);
    hot_stm_frames -= oldest[1].frames.length;
  }
}

function compile_stm_plan(plan: StmPlan): CompiledStmPlan {
  const cached = hot_stm_plans.get(plan);
  if (cached !== undefined) return cached;
  const frames: StmPlan[] = [plan];
  let source = plan.source;
  let nested = stm_plan_of(source);
  while (nested !== undefined) {
    frames.push(nested);
    source = nested.source;
    nested = stm_plan_of(source);
  }
  frames.reverse();
  const result: CompiledStmPlan = { source, frames };
  plan.runs += 1;
  if (frames.length >= 16 || plan.runs >= 2) {
    retain_hot_stm(plan, result);
  }
  return result;
}

function run_stm_plan(initial_plan: StmPlan, journal: StmJournal): unknown {
  let plan = initial_plan;
  while (true) {
    const source_plan = stm_plan_of(plan.source);
    if (source_plan !== undefined) {
      return evaluate_stm_plan(compile_stm_plan(plan), journal);
    }
    if (plan.tag === 0) {
      return plan.apply(plan.source(journal));
    }
    const next = plan.apply(plan.source(journal)).value();
    const next_plan = stm_plan_of(next);
    if (next_plan === undefined) return next(journal);
    plan = next_plan;
  }
}

function evaluate_stm_plan(
  initial_segment: CompiledStmPlan,
  journal: StmJournal,
): unknown {
  let segment = initial_segment;
  let pending: { segment: CompiledStmPlan; index: number }[] | undefined;
  let index = 0;
  let value = segment.source(journal);
  while (true) {
    const frames = segment.frames;
    if (index === frames.length) {
      const previous = pending?.pop();
      if (previous === undefined) return value;
      segment = previous.segment;
      index = previous.index;
      continue;
    }
    const frame = frames[index++];
    if (frame.tag === 0) {
      value = frame.apply(value);
      continue;
    }
    const source = frame.apply(value).value();
    const plan = stm_plan_of(source);
    if (plan === undefined) {
      value = source(journal);
    } else if (stm_plan_of(plan.source) === undefined && plan.tag === 0) {
      value = plan.apply(plan.source(journal));
    } else {
      if (index < frames.length) {
        pending ??= [];
        pending.push({ segment, index });
      }
      segment = compile_stm_plan(plan);
      index = 0;
      value = segment.source(journal);
    }
  }
}

Show.instance(Stm)({
  show() {
    return "Stm(?)";
  },
});

Functor.instance(Stm)({
  map(fn) {
    return trusted_stm(
      compose_stm_plan({
        tag: 0,
        apply: fn as (value: unknown) => unknown,
        source: this.value() as RawStm<unknown>,
        runs: 0,
      }) as RawStm<ReturnType<typeof fn>>,
    );
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
    return trusted_stm(
      compose_stm_plan({
        tag: 1,
        apply: fn as (value: unknown) => Stm<unknown>,
        source: this.value() as RawStm<unknown>,
        runs: 0,
      }) as RawStm<unknown>,
    ) as Stm<never>;
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
    if (w_keys !== undefined && w_keys.length > 0) {
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
    if (r_keys !== undefined && r_keys.length > 0) {
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

function read_trusted_current<item>(box: TVarBox<item>, raw: item): item {
  const flags = box[tvar_flags];
  if ((flags & FLAG_PLAIN_FLAT_RECORD) !== 0) {
    return { ...(raw as Record<string, unknown>) } as item;
  }
  if ((flags & FLAG_PLAIN_PRIM_ARRAY) !== 0) {
    return (raw as unknown[]).slice() as item;
  }
  if ((flags & FLAG_SHAPE_VALID) !== 0) {
    const compiled = box[tvar_compiled_shape]!;
    return clone_trusted_shape(
      raw,
      compiled,
      compiled.needs_copies ? new Map() : undefined,
    ) as item;
  }
  if ((flags & FLAG_PLAIN_TREE) !== 0) {
    return clone_plain_tree(raw) as item;
  }
  if ((flags & FLAG_PLAIN_GRAPH) !== 0) {
    return clone_plain_graph(raw, new Map()) as item;
  }
  return clone_sab_free_fallback(raw, "value read from TVar", box[tvar_id]);
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
    let value: item;
    if (journal.parent === undefined) {
      const box = variable as TVarBox<item>;
      const raw = box[tvar_value];
      if (is_primitive_value(raw) || box[tvar_immutable]) {
        value = raw;
      } else {
        value = read_trusted_current(box, raw);
      }
    } else {
      const raw = lookup_journal(
        journal.parent,
        key,
        read_current(variable),
      ) as item;
      value = is_primitive_value(raw)
        ? raw
        : isolate_tvar(variable, raw, "value read from TVar");
    }
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

  let value: item;
  if (journal.parent === undefined) {
    const box = variable as TVarBox<item>;
    const raw = box[tvar_value];
    if (is_primitive_value(raw) || box[tvar_immutable]) {
      value = raw;
    } else {
      value = read_trusted_current(box, raw);
    }
  } else {
    const raw = lookup_journal(
      journal.parent,
      key,
      read_current(variable),
    ) as item;
    value = is_primitive_value(raw)
      ? raw
      : isolate_tvar(variable, raw, "value read from TVar");
  }
  journal.reads.set(key, value);

  return value;
}

function write_journal<item>(
  journal: StmJournal,
  variable: TVar<item>,
  value: item,
): void {
  let isolated: item;
  let flags = FLAG_NONE;
  if (is_primitive_value(value)) {
    isolated = value;
  } else {
    isolated = isolate_tvar(variable, value, "value written to TVar");
    flags = last_isolate_flags;
  }
  const internal = journal_of(journal);
  if (internal !== undefined) {
    internal.set_write(variable as TVar<unknown>, isolated, false, flags);
    return;
  }
  journal.writes.set(variable as TVar<unknown>, isolated);
}

function stage_immutable_write<item>(
  journal: StmJournal,
  variable: TVar<item>,
  value: item,
): void {
  const internal = journal_of(journal);
  if (internal !== undefined) {
    internal.set_write(variable as TVar<unknown>, value, false, FLAG_NONE);
    return;
  }
  journal.writes.set(variable as TVar<unknown>, value);
}

function isolate_commit(variable: TVar<unknown>, value: unknown): unknown {
  if (is_primitive_value(value)) {
    last_isolate_flags = FLAG_NONE;
    return value;
  }
  return isolate_tvar(variable, value, "commit value for TVar");
}

function commit_journal(journal: StmJournal): void {
  const internal = journal_of(journal);
  if (internal !== undefined && internal.writes_map === undefined) {
    const w0_k = internal.w0_k;
    if (w0_k === undefined) return;
    const esc = internal.escaped;
    let v0 = internal.w0_v;
    let f0 = internal.w0_flags;
    if (
      esc || (internal.w0_exp && !(w0_k as TVarBox<unknown>)[tvar_immutable])
    ) {
      v0 = isolate_commit(w0_k, v0);
      f0 = last_isolate_flags;
    }
    const keys = internal.w_keys;
    if (keys === undefined || keys.length === 0) {
      write_current(w0_k, v0, f0);
      return;
    }
    const vals = internal.w_vals!;
    const exp = internal.w_exp!;
    const flags = internal.w_flags!;
    const len = keys.length;
    if (esc) {
      const committed_vals = new Array<unknown>(len);
      const committed_flags = new Array<number>(len);
      for (let index = 0; index < len; index += 1) {
        committed_vals[index] = isolate_commit(keys[index], vals[index]);
        committed_flags[index] = last_isolate_flags;
      }
      write_current(w0_k, v0, f0);
      for (let index = 0; index < len; index += 1) {
        write_current(
          keys[index],
          committed_vals[index],
          committed_flags[index],
        );
      }
      return;
    }
    for (let index = 0; index < len; index += 1) {
      if (exp[index] && !(keys[index] as TVarBox<unknown>)[tvar_immutable]) {
        vals[index] = isolate_commit(keys[index], vals[index]);
        flags[index] = last_isolate_flags;
      }
    }
    write_current(w0_k, v0, f0);
    for (let index = 0; index < len; index += 1) {
      write_current(keys[index], vals[index], flags[index]);
    }
    return;
  }
  const writes = internal !== undefined
    ? internal.writes_map
    : writes_of(journal);
  if (writes === undefined || writes.size === 0) return;
  const esc = internal === undefined || internal.escaped;
  if (!esc) {
    const exposed = internal.exposed_map;
    let flags_map = internal.flags_map;
    if (exposed !== undefined) {
      for (const variable of exposed) {
        if (!writes.has(variable)) continue;
        if ((variable as TVarBox<unknown>)[tvar_immutable]) continue;
        const isolated = isolate_commit(variable, writes.get(variable));
        writes.set(variable, isolated);
        const f = last_isolate_flags;
        if (f !== FLAG_NONE) {
          (flags_map ??= new Map()).set(variable, f);
        } else if (flags_map !== undefined) {
          flags_map.delete(variable);
        }
      }
    }
    if (flags_map === undefined) {
      for (const [variable, value] of writes) {
        write_current(variable, value, FLAG_NONE);
      }
    } else {
      for (const [variable, value] of writes) {
        write_current(
          variable,
          value,
          flags_map.get(variable) ?? FLAG_NONE,
        );
      }
    }
    return;
  }
  const size = writes.size;
  const vars = new Array<TVar<unknown>>(size);
  const vals = new Array<unknown>(size);
  const flags = new Array<number>(size);
  let i = 0;
  for (const [variable, value] of writes) {
    vars[i] = variable;
    if (is_primitive_value(value)) {
      vals[i] = value;
      flags[i] = FLAG_NONE;
    } else {
      vals[i] = isolate_commit(variable, value);
      flags[i] = last_isolate_flags;
    }
    i += 1;
  }
  for (let j = 0; j < size; j += 1) {
    write_current(vars[j], vals[j], flags[j]);
  }
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
    target.merge_read(variable, value);
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
  flags: number,
): void {
  if (target !== undefined) {
    target.set_write(
      variable,
      value,
      is_exposed,
      is_exposed ? FLAG_NONE : flags,
    );
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
      if (r_keys !== undefined && r_keys.length > 0) {
        const r_vals = source.r_vals!;
        for (let index = 0; index < r_keys.length; index += 1) {
          merge_journal_read(journal, target, r_keys[index], r_vals[index]);
        }
      }
    }
    if (source.writes_map !== undefined) {
      const source_esc = source.escaped;
      const source_exp = source.exposed_map;
      const source_flags = source.flags_map;
      for (const [variable, value] of source.writes_map) {
        const exp = source_esc || (source_exp?.has(variable) ?? false);
        merge_journal_write(
          journal,
          target,
          variable,
          value,
          exp,
          exp ? FLAG_NONE : (source_flags?.get(variable) ?? FLAG_NONE),
        );
      }
    } else if (source.w0_k !== undefined) {
      const exp0 = source.escaped || source.w0_exp;
      merge_journal_write(
        journal,
        target,
        source.w0_k,
        source.w0_v,
        exp0,
        exp0 ? FLAG_NONE : source.w0_flags,
      );
      const w_keys = source.w_keys;
      if (w_keys !== undefined && w_keys.length > 0) {
        const w_vals = source.w_vals!;
        const w_exp = source.w_exp!;
        const w_flags = source.w_flags!;
        for (let index = 0; index < w_keys.length; index += 1) {
          const exp_i = source.escaped || w_exp[index];
          merge_journal_write(
            journal,
            target,
            w_keys[index],
            w_vals[index],
            exp_i,
            exp_i ? FLAG_NONE : w_flags[index],
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
      merge_journal_write(journal, target, variable, value, true, FLAG_NONE);
    }
  }
}

function read_current<item>(variable: TVar<item>): item {
  return (variable as TVarBox<item>)[tvar_value];
}

function write_current<item>(
  variable: TVar<item>,
  value: item,
  flags: number,
): void {
  const box = variable as TVarBox<item>;
  box[tvar_value] = value;
  box[tvar_flags] = flags;
}

function clone_sab_free_fallback<item>(
  value: item,
  op_prefix: string,
  id: number,
): item {
  try {
    return structuredClone(value);
  } catch (cause) {
    const evidence = cause instanceof Error ? cause.message : String(cause);
    throw new StmError(
      `${op_prefix} ${id} is not rollback-safe: ${evidence}`,
      { cause },
    );
  }
}

// Single-pass scan on a freshly structuredCloned object: checks for
// SharedArrayBuffer AND determines whether the graph is plain-cloneable
// (tree vs aliased/cyclic graph) and records dense primitive arrays.
let scan_is_plain = true;
let scan_has_alias = false;
let scan_has_child_object = false;

function scan_isolated_node(
  value: unknown,
  seen: WeakSet<object> | undefined,
): boolean {
  if (typeof value !== "object" || value === null) return false;
  if (seen !== undefined) {
    if (seen.has(value)) {
      scan_has_alias = true;
      return false;
    }
    seen.add(value);
  }
  if (Array.isArray(value)) {
    const len = value.length;
    const vals = Object.values(value);
    if (vals.length === len) {
      let all_prim = true;
      for (let i = 0; i < len; i += 1) {
        const el = value[i];
        if (el === undefined && !(i in value)) {
          // Sparse array with compensating custom keys: must scan all values!
          scan_is_plain = false;
          all_prim = false;
          for (let j = 0; j < vals.length; j += 1) {
            const v = vals[j];
            if (typeof v === "object" && v !== null) {
              scan_has_child_object = true;
              if (seen === undefined) {
                seen = new WeakSet();
                seen.add(value);
              }
              if (scan_isolated_node(v, seen)) return true;
            }
          }
          return false;
        }
        if (typeof el === "object" && el !== null) {
          all_prim = false;
          scan_has_child_object = true;
          if (seen === undefined) {
            seen = new WeakSet();
            seen.add(value);
          }
          if (scan_isolated_node(el, seen)) return true;
        }
      }
      if (all_prim && len >= 8) {
        primitive_arrays.add(value);
      }
      return false;
    }
    // Sparse array or array with custom enumerable properties
    scan_is_plain = false;
    for (let j = 0; j < vals.length; j += 1) {
      const v = vals[j];
      if (typeof v === "object" && v !== null) {
        scan_has_child_object = true;
        if (seen === undefined) {
          seen = new WeakSet();
          seen.add(value);
        }
        if (scan_isolated_node(v, seen)) return true;
      }
    }
    return false;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto === Object.prototype) {
    const obj = value as Record<string, unknown>;
    for (const key in obj) {
      if (!Object.hasOwn(obj, key)) continue;
      if (key === "__proto__") scan_is_plain = false;
      const v = obj[key];
      if (typeof v === "object" && v !== null) {
        scan_has_child_object = true;
        if (seen === undefined) {
          seen = new WeakSet();
          seen.add(value);
        }
        if (scan_isolated_node(v, seen)) return true;
      }
    }
    return false;
  }

  scan_is_plain = false;
  if (has_sab && value instanceof SharedArrayBuffer) {
    return true;
  }
  if (ArrayBuffer.isView(value)) {
    return has_sab && value.buffer instanceof SharedArrayBuffer;
  }
  if (
    value instanceof ArrayBuffer || value instanceof Date ||
    value instanceof RegExp
  ) {
    return false;
  }
  if (value instanceof Map) {
    for (const [k, v] of value) {
      if (typeof k === "object" && k !== null) {
        if (seen === undefined) {
          seen = new WeakSet();
          seen.add(value);
        }
        if (scan_isolated_node(k, seen)) return true;
      }
      if (typeof v === "object" && v !== null) {
        if (seen === undefined) {
          seen = new WeakSet();
          seen.add(value);
        }
        if (scan_isolated_node(v, seen)) return true;
      }
    }
    return false;
  }
  if (value instanceof Set) {
    for (const v of value) {
      if (typeof v === "object" && v !== null) {
        if (seen === undefined) {
          seen = new WeakSet();
          seen.add(value);
        }
        if (scan_isolated_node(v, seen)) return true;
      }
    }
    return false;
  }
  const obj = value as Record<string, unknown>;
  for (const key in obj) {
    if (!Object.hasOwn(obj, key)) continue;
    const v = obj[key];
    if (typeof v === "object" && v !== null) {
      if (seen === undefined) {
        seen = new WeakSet();
        seen.add(value);
      }
      if (scan_isolated_node(v, seen)) return true;
    }
  }
  return false;
}

function isolate_value<item>(
  value: item,
  op_prefix: string,
  id: number,
  compiled_shape?: CompiledShape,
): item {
  if (is_primitive_value(value)) {
    last_isolate_flags = FLAG_NONE;
    return value;
  }

  let isolated: item;

  try {
    isolated = structuredClone(value);
  } catch (cause) {
    const evidence = cause instanceof Error ? cause.message : String(cause);
    throw new StmError(
      `${op_prefix} ${id} is not rollback-safe: ${evidence}`,
      { cause },
    );
  }

  if (
    compiled_shape !== undefined && !compiled_shape.is_cyclic &&
    validate_cloned_shape(isolated, compiled_shape)
  ) {
    if (
      compiled_shape.kind === SHAPE_RECORD &&
      compiled_shape.all_primitive_fields
    ) {
      last_isolate_flags = FLAG_PLAIN_FLAT_RECORD | FLAG_SHAPE_VALID;
    } else if (
      compiled_shape.kind === SHAPE_ARRAY && compiled_shape.is_primitive_element
    ) {
      last_isolate_flags = FLAG_PLAIN_PRIM_ARRAY | FLAG_SHAPE_VALID;
    } else {
      last_isolate_flags = FLAG_SHAPE_VALID;
    }
    return isolated;
  }

  scan_is_plain = true;
  scan_has_alias = false;
  scan_has_child_object = false;
  if (scan_isolated_node(isolated, undefined)) {
    throw new StmError(
      `${op_prefix} ${id} is not rollback-safe: SharedArrayBuffer memory cannot be isolated`,
    );
  }

  if (scan_is_plain) {
    if (!scan_has_child_object) {
      last_isolate_flags = Array.isArray(isolated)
        ? FLAG_PLAIN_PRIM_ARRAY
        : FLAG_PLAIN_FLAT_RECORD;
    } else {
      last_isolate_flags = scan_has_alias ? FLAG_PLAIN_GRAPH : FLAG_PLAIN_TREE;
    }
  } else {
    last_isolate_flags = FLAG_NONE;
  }
  return isolated;
}

function clone_plain_tree(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) {
    const len = value.length;
    if (len >= 8 && primitive_arrays.has(value)) {
      return value.slice();
    }
    const copy = new Array<unknown>(len);
    for (let i = 0; i < len; i += 1) {
      const el = value[i];
      copy[i] = typeof el === "object" && el !== null
        ? clone_plain_tree(el)
        : el;
    }
    return copy;
  }
  const obj = value as Record<string, unknown>;
  const copy: Record<string, unknown> = {};
  for (const key in obj) {
    if (!Object.hasOwn(obj, key)) continue;
    const v = obj[key];
    copy[key] = typeof v === "object" && v !== null ? clone_plain_tree(v) : v;
  }
  return copy;
}

function clone_plain_graph(
  value: unknown,
  copies: Map<object, unknown>,
): unknown {
  if (typeof value !== "object" || value === null) return value;
  const existing = copies.get(value);
  if (existing !== undefined) return existing;
  if (Array.isArray(value)) {
    const len = value.length;
    if (len >= 8 && primitive_arrays.has(value)) {
      const copy = value.slice();
      copies.set(value, copy);
      return copy;
    }
    const copy = new Array<unknown>(len);
    copies.set(value, copy);
    for (let i = 0; i < len; i += 1) {
      const el = value[i];
      copy[i] = typeof el === "object" && el !== null
        ? clone_plain_graph(el, copies)
        : el;
    }
    return copy;
  }
  const obj = value as Record<string, unknown>;
  const copy: Record<string, unknown> = {};
  copies.set(value, copy);
  for (const key in obj) {
    if (!Object.hasOwn(obj, key)) continue;
    const v = obj[key];
    copy[key] = typeof v === "object" && v !== null
      ? clone_plain_graph(v, copies)
      : v;
  }
  return copy;
}

/** Creates a reference whose isolated plain records and arrays are deeply frozen.
 * Mutable built-ins, accessors, functions and symbol properties are rejected.
 */
export function new_immutable_tvar<item>(value: item): TVar<item> {
  const id = next_tvar_id;
  next_tvar_id += 1;
  const stored = isolate_immutable(value);
  const variable: TVarBox<item> = {
    [tvar_brand]: undefined as unknown as (item: item) => item,
    [tvar_id]: id,
    [tvar_value]: stored,
    [tvar_immutable]: true,
    [tvar_shape]: undefined,
    [tvar_compiled_shape]: undefined,
    [tvar_flags]: FLAG_NONE,
    [tvar_reader]: undefined,
  };
  return variable;
}

function isolate_tvar<item>(
  variable: TVar<item>,
  value: item,
  op_prefix: string,
): item {
  const box = variable as TVarBox<item>;
  if (box[tvar_immutable]) {
    last_isolate_flags = FLAG_NONE;
    return isolate_immutable(value);
  }
  return snapshot_untrusted(
    value,
    op_prefix,
    box[tvar_id],
    box[tvar_compiled_shape],
  );
}

const SHAPE_NUMBER = 0;
const SHAPE_STRING = 1;
const SHAPE_BOOLEAN = 2;
const SHAPE_NULL = 3;
const SHAPE_ARRAY = 4;
const SHAPE_RECORD = 5;

type CompiledPrimitiveShape = {
  readonly kind: 0 | 1 | 2 | 3;
  readonly has_container: false;
  readonly needs_copies: false;
  readonly is_cyclic: false;
};

type CompiledArrayShape = {
  readonly kind: 4;
  readonly has_container: true;
  element: CompiledShape;
  is_primitive_element: boolean;
  needs_copies: boolean;
  is_cyclic: boolean;
};

type CompiledRecordShape = {
  readonly kind: 5;
  readonly has_container: true;
  keys: readonly string[];
  children: readonly CompiledShape[];
  container_keys: readonly string[];
  container_children: readonly CompiledShape[];
  key_map: Record<string, CompiledShape>;
  has_proto_key: boolean;
  all_primitive_fields: boolean;
  needs_copies: boolean;
  is_cyclic: boolean;
};

type CompiledShape =
  | CompiledPrimitiveShape
  | CompiledArrayShape
  | CompiledRecordShape;

const compiled_number: CompiledPrimitiveShape = {
  kind: SHAPE_NUMBER,
  has_container: false,
  needs_copies: false,
  is_cyclic: false,
};
const compiled_string: CompiledPrimitiveShape = {
  kind: SHAPE_STRING,
  has_container: false,
  needs_copies: false,
  is_cyclic: false,
};
const compiled_boolean: CompiledPrimitiveShape = {
  kind: SHAPE_BOOLEAN,
  has_container: false,
  needs_copies: false,
  is_cyclic: false,
};
const compiled_null: CompiledPrimitiveShape = {
  kind: SHAPE_NULL,
  has_container: false,
  needs_copies: false,
  is_cyclic: false,
};

const compiled_shapes = new WeakMap<object, CompiledShape>();
const shape_mismatch = Symbol("snapshot shape mismatch");

function compile_shape(
  shape: SnapshotShape,
  visiting?: Set<object>,
): CompiledShape {
  if (typeof shape === "string") {
    switch (shape) {
      case "number":
        return compiled_number;
      case "string":
        return compiled_string;
      case "boolean":
        return compiled_boolean;
      case "null":
        return compiled_null;
    }
  }
  const existing = compiled_shapes.get(shape);
  if (existing !== undefined) {
    if (visiting !== undefined && visiting.has(shape)) {
      if (existing.kind === SHAPE_ARRAY || existing.kind === SHAPE_RECORD) {
        existing.is_cyclic = true;
        existing.needs_copies = true;
      }
    }
    return existing;
  }
  const active = visiting ?? new Set<object>();
  active.add(shape);
  if ("array" in shape) {
    const compiled: CompiledArrayShape = {
      kind: SHAPE_ARRAY,
      has_container: true,
      element: compiled_null,
      is_primitive_element: true,
      needs_copies: false,
      is_cyclic: false,
    };
    compiled_shapes.set(shape, compiled);
    const elem = compile_shape(shape.array, active);
    compiled.element = elem;
    compiled.is_primitive_element = !elem.has_container;
    compiled.needs_copies = elem.has_container || compiled.is_cyclic;
    if (elem.is_cyclic) compiled.is_cyclic = true;
    active.delete(shape);
    return compiled;
  }
  const keys = Object.keys(shape.record);
  const children = new Array<CompiledShape>(keys.length);
  const container_keys: string[] = [];
  const container_children_list: CompiledShape[] = [];
  const key_map: Record<string, CompiledShape> = Object.create(null);
  const compiled: CompiledRecordShape = {
    kind: SHAPE_RECORD,
    has_container: true,
    keys,
    children,
    container_keys,
    container_children: container_children_list,
    key_map,
    has_proto_key: false,
    all_primitive_fields: true,
    needs_copies: false,
    is_cyclic: false,
  };
  compiled_shapes.set(shape, compiled);
  let child_needs_copies = false;
  let has_proto = false;
  let cyclic = false;
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i];
    if (k === "__proto__") has_proto = true;
    const child = compile_shape(shape.record[k], active);
    children[i] = child;
    key_map[k] = child;
    if (child.has_container) {
      container_keys.push(k);
      container_children_list.push(child);
      if (child.needs_copies) child_needs_copies = true;
      if (child.is_cyclic) cyclic = true;
    }
  }
  compiled.has_proto_key = has_proto;
  compiled.all_primitive_fields = container_keys.length === 0;
  compiled.is_cyclic = compiled.is_cyclic || cyclic;
  compiled.needs_copies = compiled.needs_copies || compiled.is_cyclic ||
    container_keys.length > 1 || child_needs_copies;
  active.delete(shape);
  return compiled;
}

function snapshot_untrusted<item>(
  value: item,
  op_prefix: string,
  id: number,
  compiled?: CompiledShape,
): item {
  if (compiled !== undefined) {
    if (!compiled.has_container) {
      if (matches_primitive_shape(value, compiled.kind)) {
        last_isolate_flags = FLAG_NONE;
        return value;
      }
    } else {
      const copy = clone_untrusted_shape(
        value,
        compiled,
        compiled.needs_copies ? new Map() : undefined,
      );
      if (copy !== shape_mismatch) {
        if (compiled.is_cyclic) {
          last_isolate_flags = FLAG_NONE;
        } else if (
          compiled.kind === SHAPE_RECORD && compiled.all_primitive_fields
        ) {
          last_isolate_flags = FLAG_PLAIN_FLAT_RECORD | FLAG_SHAPE_VALID;
        } else if (
          compiled.kind === SHAPE_ARRAY && compiled.is_primitive_element
        ) {
          last_isolate_flags = FLAG_PLAIN_PRIM_ARRAY | FLAG_SHAPE_VALID;
        } else {
          last_isolate_flags = FLAG_SHAPE_VALID;
        }
        return copy as item;
      }
    }
  }
  return isolate_value(value, op_prefix, id, compiled);
}

function matches_primitive_shape(value: unknown, kind: 0 | 1 | 2 | 3): boolean {
  switch (kind) {
    case SHAPE_NUMBER:
      return typeof value === "number";
    case SHAPE_STRING:
      return typeof value === "string";
    case SHAPE_BOOLEAN:
      return typeof value === "boolean";
    case SHAPE_NULL:
      return value === null;
  }
}

function clone_untrusted_shape(
  value: unknown,
  shape: CompiledShape,
  copies: Map<object, unknown> | undefined,
): unknown {
  switch (shape.kind) {
    case SHAPE_NUMBER:
      return typeof value === "number" ? value : shape_mismatch;
    case SHAPE_STRING:
      return typeof value === "string" ? value : shape_mismatch;
    case SHAPE_BOOLEAN:
      return typeof value === "boolean" ? value : shape_mismatch;
    case SHAPE_NULL:
      return value === null ? null : shape_mismatch;
    case SHAPE_ARRAY: {
      if (!Array.isArray(value)) return shape_mismatch;
      if (copies !== undefined) {
        const existing = copies.get(value);
        if (existing !== undefined) return existing;
      }
      const len = value.length;
      if (len > 32) return shape_mismatch;
      const own_keys = Reflect.ownKeys(value);
      if (own_keys.length !== len + 1) return shape_mismatch;
      const copy = new Array<unknown>(len);
      if (copies !== undefined) copies.set(value, copy);
      const elem = shape.element;
      for (let index = 0; index < len; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (
          descriptor === undefined || !descriptor.enumerable ||
          !("value" in descriptor)
        ) {
          return shape_mismatch;
        }
        const child = clone_untrusted_shape(descriptor.value, elem, copies);
        if (child === shape_mismatch) return shape_mismatch;
        copy[index] = child;
      }
      return copy;
    }
    case SHAPE_RECORD: {
      if (typeof value !== "object" || value === null) return shape_mismatch;
      if (copies !== undefined) {
        const existing = copies.get(value);
        if (existing !== undefined) return existing;
      }
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        return shape_mismatch;
      }
      const own_keys = Reflect.ownKeys(value);
      if (own_keys.length !== shape.keys.length) return shape_mismatch;
      const copy: Record<string, unknown> = {};
      if (copies !== undefined) copies.set(value, copy);
      const key_map = shape.key_map;
      for (let i = 0; i < own_keys.length; i += 1) {
        const key = own_keys[i];
        if (typeof key !== "string") return shape_mismatch;
        const child_shape = key_map[key];
        if (child_shape === undefined) return shape_mismatch;
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!descriptor.enumerable || !("value" in descriptor)) {
          return shape_mismatch;
        }
        const child = clone_untrusted_shape(
          descriptor.value,
          child_shape,
          copies,
        );
        if (child === shape_mismatch) return shape_mismatch;
        if (key === "__proto__") {
          Object.defineProperty(copy, key, {
            value: child,
            enumerable: true,
            configurable: true,
            writable: true,
          });
        } else {
          copy[key] = child;
        }
      }
      return copy;
    }
  }
}

function validate_cloned_shape(
  value: unknown,
  shape: CompiledShape,
): boolean {
  switch (shape.kind) {
    case SHAPE_NUMBER:
      return typeof value === "number";
    case SHAPE_STRING:
      return typeof value === "string";
    case SHAPE_BOOLEAN:
      return typeof value === "boolean";
    case SHAPE_NULL:
      return value === null;
    case SHAPE_ARRAY: {
      if (!Array.isArray(value)) return false;
      const len = value.length;
      if (Object.values(value).length !== len) return false;
      const elem = shape.element;
      switch (elem.kind) {
        case SHAPE_NUMBER:
          for (let i = 0; i < len; i += 1) {
            if (typeof value[i] !== "number") return false;
          }
          return true;
        case SHAPE_STRING:
          for (let i = 0; i < len; i += 1) {
            if (typeof value[i] !== "string") return false;
          }
          return true;
        case SHAPE_BOOLEAN:
          for (let i = 0; i < len; i += 1) {
            if (typeof value[i] !== "boolean") return false;
          }
          return true;
        case SHAPE_NULL:
          for (let i = 0; i < len; i += 1) {
            if (value[i] !== null) return false;
          }
          return true;
        default:
          for (let i = 0; i < len; i += 1) {
            if (!validate_cloned_shape(value[i], elem)) return false;
          }
          return true;
      }
    }
    case SHAPE_RECORD: {
      if (typeof value !== "object" || value === null) return false;
      if (Object.getPrototypeOf(value) !== Object.prototype) return false;
      const obj = value as Record<string, unknown>;
      const keys = shape.keys;
      const children = shape.children;
      const len = keys.length;
      if (Object.keys(obj).length !== len) return false;
      for (let i = 0; i < len; i += 1) {
        const k = keys[i];
        if (!Object.hasOwn(obj, k)) return false;
        if (!validate_cloned_shape(obj[k], children[i])) return false;
      }
      return true;
    }
  }
}

function clone_trusted_shape(
  value: unknown,
  shape: CompiledShape,
  copies: Map<object, unknown> | undefined,
): unknown {
  switch (shape.kind) {
    case SHAPE_NUMBER:
    case SHAPE_STRING:
    case SHAPE_BOOLEAN:
    case SHAPE_NULL:
      return value;
    case SHAPE_ARRAY: {
      const arr = value as unknown[];
      if (copies !== undefined) {
        const existing = copies.get(arr);
        if (existing !== undefined) return existing;
      }
      if (shape.is_primitive_element) {
        const copy = arr.slice();
        if (copies !== undefined) copies.set(arr, copy);
        return copy;
      }
      const len = arr.length;
      const copy = new Array<unknown>(len);
      if (copies !== undefined) copies.set(arr, copy);
      const elem = shape.element;
      for (let i = 0; i < len; i += 1) {
        copy[i] = clone_trusted_shape(arr[i], elem, copies);
      }
      return copy;
    }
    case SHAPE_RECORD: {
      const obj = value as Record<string, unknown>;
      if (copies !== undefined) {
        const existing = copies.get(obj);
        if (existing !== undefined) return existing;
      }
      const copy: Record<string, unknown> = { ...obj };
      if (copies !== undefined) copies.set(obj, copy);
      if (shape.all_primitive_fields) {
        return copy;
      }
      const ckeys = shape.container_keys;
      const cchildren = shape.container_children;
      const clen = ckeys.length;
      if (!shape.has_proto_key) {
        if (clen === 1) {
          const k0 = ckeys[0];
          const child0 = cchildren[0];
          copy[k0] =
            child0.kind === SHAPE_ARRAY && child0.is_primitive_element &&
              copies === undefined
              ? (obj[k0] as unknown[]).slice()
              : clone_trusted_shape(obj[k0], child0, copies);
          return copy;
        }
        for (let i = 0; i < clen; i += 1) {
          const k = ckeys[i];
          copy[k] = clone_trusted_shape(obj[k], cchildren[i], copies);
        }
        return copy;
      }
      for (let i = 0; i < clen; i += 1) {
        const k = ckeys[i];
        const v = clone_trusted_shape(obj[k], cchildren[i], copies);
        if (k === "__proto__") {
          Object.defineProperty(copy, k, {
            value: v,
            enumerable: true,
            configurable: true,
            writable: true,
          });
        } else {
          copy[k] = v;
        }
      }
      return copy;
    }
  }
}

function copy_immutable_node(
  node: object,
  key: string | number,
  child: unknown,
): object {
  if (Array.isArray(node)) {
    if (!exotic_immutable_arrays.has(node)) {
      const copy = node.slice();
      copy[key as number] = child;
      Object.freeze(copy);
      immutable_values.add(copy);
      return copy;
    }
    const copy = new Array(node.length);
    const keys = Object.keys(node);
    for (let i = 0; i < keys.length; i += 1) {
      const k = keys[i];
      Object.defineProperty(copy, k, {
        value: (node as unknown as Record<string, unknown>)[k],
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    Object.defineProperty(copy, key, {
      value: child,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    Object.freeze(copy);
    immutable_values.add(copy);
    exotic_immutable_arrays.add(copy);
    return copy;
  }
  const proto = Object.getPrototypeOf(node);
  const copy: Record<string | number, unknown> = proto === null
    ? Object.assign(Object.create(null), node)
    : { ...node };
  if (key === "__proto__") {
    Object.defineProperty(copy, key, {
      value: child,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  } else {
    copy[key] = child;
  }
  Object.freeze(copy);
  immutable_values.add(copy);
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
    const len = path.length;
    if (len === 0) {
      const next = isolate_immutable(update(current)) as item;
      if (next !== current) stage_immutable_write(journal, variable, next);
      return next;
    }
    if (len === 1) {
      if (typeof current !== "object" || current === null) {
        throw new StmError("Immutable path crosses a non-container value");
      }
      const k0 = path[0];
      if (
        !Object.hasOwn(current, k0) ||
        (Array.isArray(current) && k0 === "length")
      ) {
        throw new StmError("Immutable path does not exist or is array length");
      }
      const old_leaf = (current as Record<string | number, unknown>)[k0];
      const new_leaf = isolate_immutable(update(old_leaf));
      if (new_leaf === old_leaf) return current;
      const next = copy_immutable_node(current as object, k0, new_leaf) as item;
      stage_immutable_write(journal, variable, next);
      return next;
    }
    if (len === 2) {
      if (typeof current !== "object" || current === null) {
        throw new StmError("Immutable path crosses a non-container value");
      }
      const k0 = path[0];
      if (
        !Object.hasOwn(current, k0) ||
        (Array.isArray(current) && k0 === "length")
      ) {
        throw new StmError("Immutable path does not exist or is array length");
      }
      const n1 = (current as Record<string | number, unknown>)[k0];
      if (typeof n1 !== "object" || n1 === null) {
        throw new StmError("Immutable path crosses a non-container value");
      }
      const k1 = path[1];
      if (!Object.hasOwn(n1, k1) || (Array.isArray(n1) && k1 === "length")) {
        throw new StmError("Immutable path does not exist or is array length");
      }
      const old_leaf = (n1 as Record<string | number, unknown>)[k1];
      const new_leaf = isolate_immutable(update(old_leaf));
      if (new_leaf === old_leaf) return current;
      const new_n1 = copy_immutable_node(n1 as object, k1, new_leaf);
      const next = copy_immutable_node(current as object, k0, new_n1) as item;
      stage_immutable_write(journal, variable, next);
      return next;
    }
    const nodes = new Array<object>(len);
    let cursor: unknown = current;
    for (let d = 0; d < len; d += 1) {
      if (typeof cursor !== "object" || cursor === null) {
        throw new StmError("Immutable path crosses a non-container value");
      }
      const key = path[d];
      if (
        !Object.hasOwn(cursor, key) ||
        (Array.isArray(cursor) && key === "length")
      ) {
        throw new StmError("Immutable path does not exist or is array length");
      }
      nodes[d] = cursor as object;
      cursor = (cursor as Record<string | number, unknown>)[key];
    }
    let child = isolate_immutable(update(cursor));
    if (child === cursor) return current;
    for (let d = len - 1; d >= 0; d -= 1) {
      child = copy_immutable_node(nodes[d], path[d], child);
    }
    const next = child as item;
    stage_immutable_write(journal, variable, next);
    return next;
  });
}

function try_validate_frozen(
  value: unknown,
  seen: WeakSet<object>,
  frozen_nodes: object[],
  exotic_nodes: object[],
): boolean {
  if (typeof value === "function") {
    throw new StmError("Immutable TVars require plain data");
  }
  if (typeof value !== "object" || value === null) return true;
  if (immutable_values.has(value) || seen.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  const is_array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (!is_array && prototype !== Object.prototype && prototype !== null) {
    throw new StmError("Immutable TVars require plain records and arrays");
  }
  const keys = Reflect.ownKeys(value);
  if (is_array) {
    const len = value.length;
    let exotic = prototype !== Array.prototype || keys.length !== len + 1;
    let expected_index = 0;
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      if (typeof key === "symbol") {
        throw new StmError("Immutable TVars reject symbol properties");
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!("value" in descriptor)) {
        throw new StmError("Immutable TVars reject accessors");
      }
      if (key === "length") continue;
      if (!descriptor.enumerable) {
        throw new StmError("Immutable TVars reject non-enumerable properties");
      }
      if (!exotic) {
        if (expected_index < len && key === String(expected_index)) {
          expected_index += 1;
        } else {
          exotic = true;
        }
      }
      if (
        !try_validate_frozen(descriptor.value, seen, frozen_nodes, exotic_nodes)
      ) {
        return false;
      }
    }
    if (expected_index !== len) exotic = true;
    if (exotic) exotic_nodes.push(value);
    frozen_nodes.push(value);
    return true;
  }
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (typeof key === "symbol") {
      throw new StmError("Immutable TVars reject symbol properties");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in descriptor)) {
      throw new StmError("Immutable TVars reject accessors");
    }
    if (!descriptor.enumerable) {
      throw new StmError("Immutable TVars reject non-enumerable properties");
    }
    if (
      !try_validate_frozen(descriptor.value, seen, frozen_nodes, exotic_nodes)
    ) {
      return false;
    }
  }
  frozen_nodes.push(value);
  return true;
}

function clone_and_validate_immutable(
  value: unknown,
  copies: Map<object, object>,
  created: object[],
  exotic_created: object[],
): unknown {
  if (typeof value === "function") {
    throw new StmError("Immutable TVars require plain data");
  }
  if (typeof value !== "object" || value === null) return value;
  if (immutable_values.has(value)) return value;
  const existing = copies.get(value);
  if (existing !== undefined) return existing;
  if (Object.isFrozen(value)) {
    const frozen_nodes: object[] = [];
    const exotic_nodes: object[] = [];
    if (try_validate_frozen(value, new WeakSet(), frozen_nodes, exotic_nodes)) {
      for (let i = 0; i < exotic_nodes.length; i += 1) {
        exotic_immutable_arrays.add(exotic_nodes[i]);
      }
      for (let i = 0; i < frozen_nodes.length; i += 1) {
        immutable_values.add(frozen_nodes[i]);
      }
      return value;
    }
  }
  const is_array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (!is_array && prototype !== Object.prototype && prototype !== null) {
    throw new StmError("Immutable TVars require plain records and arrays");
  }
  const keys = Reflect.ownKeys(value);
  if (is_array) {
    const len = value.length;
    const copy = new Array<unknown>(len);
    copies.set(value, copy);
    created.push(copy);
    let exotic = prototype !== Array.prototype || keys.length !== len + 1;
    let expected_index = 0;
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      if (typeof key === "symbol") {
        throw new StmError("Immutable TVars reject symbol properties");
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!("value" in descriptor)) {
        throw new StmError("Immutable TVars reject accessors");
      }
      if (key === "length") continue;
      if (!descriptor.enumerable) {
        throw new StmError("Immutable TVars reject non-enumerable properties");
      }
      if (!exotic) {
        if (expected_index < len && key === String(expected_index)) {
          const idx = expected_index;
          expected_index += 1;
          copy[idx] = clone_and_validate_immutable(
            descriptor.value,
            copies,
            created,
            exotic_created,
          );
          continue;
        }
        exotic = true;
      }
      const child = clone_and_validate_immutable(
        descriptor.value,
        copies,
        created,
        exotic_created,
      );
      if (key === "__proto__" || key === "constructor") {
        Object.defineProperty(copy, key, {
          value: child,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      } else {
        (copy as unknown as Record<string, unknown>)[key] = child;
      }
    }
    if (expected_index !== len) exotic = true;
    if (exotic) exotic_created.push(copy);
    return copy;
  }
  const copy: Record<string, unknown> = prototype === null
    ? Object.create(null)
    : {};
  copies.set(value, copy);
  created.push(copy);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (typeof key === "symbol") {
      throw new StmError("Immutable TVars reject symbol properties");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in descriptor)) {
      throw new StmError("Immutable TVars reject accessors");
    }
    if (!descriptor.enumerable) {
      throw new StmError("Immutable TVars reject non-enumerable properties");
    }
    const child = clone_and_validate_immutable(
      descriptor.value,
      copies,
      created,
      exotic_created,
    );
    if (key === "__proto__") {
      Object.defineProperty(copy, key, {
        value: child,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    } else {
      copy[key] = child;
    }
  }
  return copy;
}

function isolate_immutable<item>(value: item): item {
  if (typeof value === "function") {
    throw new StmError("Immutable TVars require plain data");
  }
  if (typeof value !== "object" || value === null) return value;
  if (immutable_values.has(value)) return value;
  if (Object.isFrozen(value)) {
    const frozen_nodes: object[] = [];
    const exotic_nodes: object[] = [];
    if (try_validate_frozen(value, new WeakSet(), frozen_nodes, exotic_nodes)) {
      for (let i = 0; i < exotic_nodes.length; i += 1) {
        exotic_immutable_arrays.add(exotic_nodes[i]);
      }
      for (let i = 0; i < frozen_nodes.length; i += 1) {
        immutable_values.add(frozen_nodes[i]);
      }
      return value;
    }
  }
  const copies = new Map<object, object>();
  const created: object[] = [];
  const exotic_created: object[] = [];
  const result = clone_and_validate_immutable(
    value,
    copies,
    created,
    exotic_created,
  );
  for (let i = 0; i < exotic_created.length; i += 1) {
    exotic_immutable_arrays.add(exotic_created[i]);
  }
  for (let i = 0; i < created.length; i += 1) {
    const node = created[i];
    Object.freeze(node);
    immutable_values.add(node);
  }
  return result as item;
}
