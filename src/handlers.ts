import { ArrayT } from "./array.ts";
import { type Data, type Dictionary, kind } from "./typeclass.ts";
import {
  bind,
  type Effect,
  is_effect,
  map,
  type Operation,
  type OperationOutput,
  pure,
  run,
  suspend,
  type TaggedOperation,
  type Uses,
} from "./effects.ts";
import { is_kind_of } from "./internal.ts";
import { type AsReaderCell, run_reader } from "./reader.ts";
import { type AsCell, run_state } from "./state.ts";
import {
  append_array_log,
  type AsWriterCell,
  has_canonical_array_concat,
  is_canonical_array_concat_method,
  run_writer,
  writer_cell_empty,
} from "./writer.ts";
import type { Monoid } from "./typeclasses/monoid.ts";

type Selected<requirements, tag> = Extract<requirements, { readonly 0: tag }>;
type OperationTable<requirements> = {
  readonly [tag in Extract<requirements, TaggedOperation>[0]]?: (
    operation: Selected<requirements, tag>,
  ) => Effect<unknown, OperationOutput<Selected<requirements, tag>>>;
};
type HandledTags<table> = {
  [tag in keyof table]-?: table[tag] extends
    (...args: never[]) => Effect<unknown, unknown> ? tag : never;
}[keyof table];
type HandledRequirements<table> = table[keyof table] extends infer handler
  ? handler extends (...args: never[]) => Effect<infer requirements, unknown>
    ? requirements
  : never
  : never;

type OperationEntry = (
  operation: TaggedOperation & Operation<unknown>,
) => Effect<unknown, unknown>;

function run_handle_operations(
  effect: Effect<unknown, unknown>,
  entries: Record<string, OperationEntry>,
): Effect<unknown, unknown> {
  let current = effect;
  while (true) {
    if (current[0] === "pure") return current;
    const operation = current[1];
    let handle: OperationEntry | undefined;
    if (Array.isArray(operation)) {
      const tag = operation[0];
      const candidate = entries[tag];
      if (typeof candidate === "function" && Object.hasOwn(entries, tag)) {
        handle = candidate;
      }
    }
    if (handle === undefined) {
      const suspended = current;
      return suspend(
        suspended[1] as Operation<unknown>,
        (value) => run_handle_operations(suspended[2](value), entries),
      );
    }
    const handled = handle.call(
      entries,
      operation as TaggedOperation & Operation<unknown>,
    );
    if (!is_effect(handled)) {
      throw new TypeError("Operation handler returned an invalid effect");
    }
    if (handled[0] === "pure") {
      current = current[2](handled[1]);
      continue;
    }
    const suspended = current;
    return bind(
      handled,
      (value) => run_handle_operations(suspended[2](value), entries),
    );
  }
}

function run_prepared_1(
  effect: Effect<unknown, unknown>,
  t0: string,
  h0: OperationEntry,
  receiver: unknown,
): Effect<unknown, unknown> {
  let current = effect;
  while (true) {
    if (current[0] === "pure") return current;
    const operation = current[1];
    if (!Array.isArray(operation) || operation[0] !== t0) {
      const suspended = current;
      return suspend(
        suspended[1] as Operation<unknown>,
        (value) => run_prepared_1(suspended[2](value), t0, h0, receiver),
      );
    }
    const handled = h0.call(
      receiver,
      operation as unknown as TaggedOperation & Operation<unknown>,
    );
    if (!is_effect(handled)) {
      throw new TypeError("Operation handler returned an invalid effect");
    }
    if (handled[0] === "pure") {
      current = current[2](handled[1]);
      continue;
    }
    const suspended = current;
    return bind(
      handled,
      (value) => run_prepared_1(suspended[2](value), t0, h0, receiver),
    );
  }
}

function run_prepared_2(
  effect: Effect<unknown, unknown>,
  t0: string,
  h0: OperationEntry,
  t1: string,
  h1: OperationEntry,
  receiver: unknown,
): Effect<unknown, unknown> {
  let current = effect;
  while (true) {
    if (current[0] === "pure") return current;
    const operation = current[1];
    let handle: OperationEntry | undefined;
    if (Array.isArray(operation)) {
      const tag = operation[0];
      if (tag === t0) handle = h0;
      else if (tag === t1) handle = h1;
    }
    if (handle === undefined) {
      const suspended = current;
      return suspend(
        suspended[1] as Operation<unknown>,
        (value) =>
          run_prepared_2(suspended[2](value), t0, h0, t1, h1, receiver),
      );
    }
    const handled = handle.call(
      receiver,
      operation as TaggedOperation & Operation<unknown>,
    );
    if (!is_effect(handled)) {
      throw new TypeError("Operation handler returned an invalid effect");
    }
    if (handled[0] === "pure") {
      current = current[2](handled[1]);
      continue;
    }
    const suspended = current;
    return bind(
      handled,
      (value) => run_prepared_2(suspended[2](value), t0, h0, t1, h1, receiver),
    );
  }
}

function run_prepared_3(
  effect: Effect<unknown, unknown>,
  t0: string,
  h0: OperationEntry,
  t1: string,
  h1: OperationEntry,
  t2: string,
  h2: OperationEntry,
  receiver: unknown,
): Effect<unknown, unknown> {
  let current = effect;
  while (true) {
    if (current[0] === "pure") return current;
    const operation = current[1];
    let handle: OperationEntry | undefined;
    if (Array.isArray(operation)) {
      const tag = operation[0];
      if (tag === t0) handle = h0;
      else if (tag === t1) handle = h1;
      else if (tag === t2) handle = h2;
    }
    if (handle === undefined) {
      const suspended = current;
      return suspend(
        suspended[1] as Operation<unknown>,
        (value) =>
          run_prepared_3(
            suspended[2](value),
            t0,
            h0,
            t1,
            h1,
            t2,
            h2,
            receiver,
          ),
      );
    }
    const handled = handle.call(
      receiver,
      operation as TaggedOperation & Operation<unknown>,
    );
    if (!is_effect(handled)) {
      throw new TypeError("Operation handler returned an invalid effect");
    }
    if (handled[0] === "pure") {
      current = current[2](handled[1]);
      continue;
    }
    const suspended = current;
    return bind(
      handled,
      (value) =>
        run_prepared_3(suspended[2](value), t0, h0, t1, h1, t2, h2, receiver),
    );
  }
}

function run_prepared_map(
  effect: Effect<unknown, unknown>,
  entries: ReadonlyMap<string, OperationEntry>,
  receiver: unknown,
): Effect<unknown, unknown> {
  let current = effect;
  while (true) {
    if (current[0] === "pure") return current;
    const operation = current[1];
    const handle = Array.isArray(operation)
      ? entries.get(operation[0])
      : undefined;
    if (handle === undefined) {
      const suspended = current;
      return suspend(
        suspended[1] as Operation<unknown>,
        (value) => run_prepared_map(suspended[2](value), entries, receiver),
      );
    }
    const handled = handle.call(
      receiver,
      operation as TaggedOperation & Operation<unknown>,
    );
    if (!is_effect(handled)) {
      throw new TypeError("Operation handler returned an invalid effect");
    }
    if (handled[0] === "pure") {
      current = current[2](handled[1]);
      continue;
    }
    const suspended = current;
    return bind(
      handled,
      (value) => run_prepared_map(suspended[2](value), entries, receiver),
    );
  }
}

/** Handle independent tagged operations in one pass, retaining emitted requirements. */
export function handle_operations<
  requirements,
  item,
  const table extends OperationTable<requirements>,
>(
  effect: Effect<requirements, item>,
  handlers: table,
): Effect<
  | Exclude<requirements, Selected<requirements, HandledTags<table>>>
  | HandledRequirements<table>,
  item
> {
  const entries = handlers as unknown as Record<string, OperationEntry>;
  return run_handle_operations(
    effect as Effect<unknown, unknown>,
    entries,
  ) as Effect<
    | Exclude<requirements, Selected<requirements, HandledTags<table>>>
    | HandledRequirements<table>,
    item
  >;
}

type PreparedEffect<pending, item, table> =
  & Effect<pending, item>
  & (NoInfer<pending> extends infer checked
    ? table extends OperationTable<checked> ? unknown : {
      readonly ERROR:
        "prepared operation handler output must match its operation";
    }
    : never);

/** Snapshot an operation table once for reuse. Later source-table mutation is isolated. */
export function prepare_operations<
  const table extends Readonly<Record<string, unknown>>,
>(
  handlers: table,
): <pending, item>(effect: PreparedEffect<pending, item, table>) => Effect<
  | Exclude<pending, Selected<pending, HandledTags<table>>>
  | HandledRequirements<table>,
  item
> {
  let count = 0;
  let t0 = "";
  let h0: OperationEntry | undefined;
  let t1 = "";
  let h1: OperationEntry | undefined;
  let t2 = "";
  let h2: OperationEntry | undefined;
  let map_entries: Map<string, OperationEntry> | undefined;

  for (const tag in handlers) {
    if (!Object.hasOwn(handlers, tag)) continue;
    const candidate = (handlers as Record<string, unknown>)[tag];
    if (typeof candidate !== "function") continue;
    const entry = candidate as OperationEntry;
    if (count === 0) {
      t0 = tag;
      h0 = entry;
      count = 1;
    } else if (count === 1) {
      t1 = tag;
      h1 = entry;
      count = 2;
    } else if (count === 2) {
      t2 = tag;
      h2 = entry;
      count = 3;
    } else {
      if (map_entries === undefined) {
        map_entries = new Map<string, OperationEntry>([
          [t0, h0!],
          [t1, h1!],
          [t2, h2!],
        ]);
      }
      map_entries.set(tag, entry);
      count += 1;
    }
  }

  type ReturnEffect<pending, item> = Effect<
    | Exclude<pending, Selected<pending, HandledTags<table>>>
    | HandledRequirements<table>,
    item
  >;

  if (count === 0) {
    return function prepared<pending, item>(
      effect: PreparedEffect<pending, item, table>,
    ): ReturnEffect<pending, item> {
      return effect as ReturnEffect<pending, item>;
    };
  }
  if (count === 1) {
    const fn0 = h0!;
    return function prepared<pending, item>(
      effect: PreparedEffect<pending, item, table>,
    ): ReturnEffect<pending, item> {
      return run_prepared_1(
        effect as Effect<unknown, unknown>,
        t0,
        fn0,
        handlers,
      ) as ReturnEffect<pending, item>;
    };
  }
  if (count === 2) {
    const fn0 = h0!;
    const fn1 = h1!;
    return function prepared<pending, item>(
      effect: PreparedEffect<pending, item, table>,
    ): ReturnEffect<pending, item> {
      return run_prepared_2(
        effect as Effect<unknown, unknown>,
        t0,
        fn0,
        t1,
        fn1,
        handlers,
      ) as ReturnEffect<pending, item>;
    };
  }
  if (count === 3) {
    const fn0 = h0!;
    const fn1 = h1!;
    const fn2 = h2!;
    return function prepared<pending, item>(
      effect: PreparedEffect<pending, item, table>,
    ): ReturnEffect<pending, item> {
      return run_prepared_3(
        effect as Effect<unknown, unknown>,
        t0,
        fn0,
        t1,
        fn1,
        t2,
        fn2,
        handlers,
      ) as ReturnEffect<pending, item>;
    };
  }
  const entries = map_entries!;
  return function prepared<pending, item>(
    effect: PreparedEffect<pending, item, table>,
  ): ReturnEffect<pending, item> {
    return run_prepared_map(
      effect as Effect<unknown, unknown>,
      entries,
      handlers,
    ) as ReturnEffect<pending, item>;
  };
}

declare const binding_requirements: unique symbol;
declare const binding_value: unique symbol;
type Family = "reader" | "state" | "writer";

/** A typed cell binding; create it with provide_reader, provide_state or provide_writer. */
export type CellBinding<requirements, family extends Family, value> = {
  readonly family: family;
  readonly [binding_requirements]?: requirements;
  readonly [binding_value]?: value;
  /** @ignore */
  readonly handle: (
    effect: Effect<unknown, unknown>,
  ) => Effect<unknown, unknown>;
};

const FAMILY_READER = 0;
const FAMILY_STATE = 1;
const FAMILY_WRITER = 2;

const cell_family = Symbol("Handlers.family");
const cell_kind = Symbol("Handlers.kind");
const cell_init = Symbol("Handlers.init");
const cell_ref = Symbol("Handlers.cell");

type BuiltinBinding = CellBinding<unknown, Family, unknown> & {
  readonly [cell_family]: number;
  readonly [cell_kind]: unknown;
  readonly [cell_init]: unknown;
  readonly [cell_ref]: unknown;
};

type MaybeBuiltinBinding = CellBinding<unknown, Family, unknown> & {
  readonly [cell_family]?: number;
  readonly [cell_kind]?: unknown;
  readonly [cell_init]?: unknown;
  readonly [cell_ref]?: unknown;
};

const run_reader_any = run_reader as (
  cell: AsReaderCell<PropertyKey, unknown>,
  effect: Effect<unknown, unknown>,
  value: unknown,
) => Effect<unknown, unknown>;
const run_state_any = run_state as (
  cell: AsCell<PropertyKey, unknown>,
  effect: Effect<unknown, unknown>,
  initial: unknown,
) => Effect<unknown, unknown>;
const run_writer_any = run_writer as (
  cell: AsWriterCell<PropertyKey, Dictionary, unknown>,
  effect: Effect<unknown, unknown>,
  empty: Data<Dictionary, unknown>,
) => Effect<unknown, unknown>;
const writer_cell_empty_any = writer_cell_empty as unknown as (
  cell: AsWriterCell<PropertyKey, Dictionary, unknown>,
) => Data<Dictionary, unknown>;

class ReaderBinding {
  readonly family = "reader" as const;
  readonly [cell_family] = FAMILY_READER;
  readonly [cell_kind]: unknown;
  readonly [cell_init]: unknown;
  readonly [cell_ref]: AsReaderCell<PropertyKey, unknown>;

  constructor(
    cell: AsReaderCell<PropertyKey, unknown>,
    environment: unknown,
  ) {
    this[cell_kind] = cell[kind];
    this[cell_init] = environment;
    this[cell_ref] = cell;
  }

  handle(effect: Effect<unknown, unknown>): Effect<unknown, unknown> {
    return run_reader_any(this[cell_ref], effect, this[cell_init]);
  }
}

class StateBinding {
  readonly family = "state" as const;
  readonly [cell_family] = FAMILY_STATE;
  readonly [cell_kind]: unknown;
  readonly [cell_init]: unknown;
  readonly [cell_ref]: AsCell<PropertyKey, unknown>;

  constructor(cell: AsCell<PropertyKey, unknown>, initial: unknown) {
    this[cell_kind] = cell[kind];
    this[cell_init] = initial;
    this[cell_ref] = cell;
  }

  handle(effect: Effect<unknown, unknown>): Effect<unknown, unknown> {
    return run_state_any(this[cell_ref], effect, this[cell_init]);
  }
}

class WriterBinding {
  readonly family = "writer" as const;
  readonly [cell_family] = FAMILY_WRITER;
  readonly [cell_kind]: unknown;
  readonly [cell_init]: Data<Dictionary, unknown> | undefined;
  readonly [cell_ref]: AsWriterCell<PropertyKey, Dictionary, unknown>;

  constructor(
    cell: AsWriterCell<PropertyKey, Dictionary, unknown>,
    initial: Data<Dictionary, unknown> | undefined,
  ) {
    this[cell_kind] = cell[kind];
    this[cell_init] = initial;
    this[cell_ref] = cell;
  }

  handle(effect: Effect<unknown, unknown>): Effect<unknown, unknown> {
    const initial = this[cell_init];
    return run_writer_any(
      this[cell_ref],
      effect,
      initial === undefined ? writer_cell_empty_any(this[cell_ref]) : initial,
    );
  }
}

/** Supply a Reader cell's environment. */
export function provide_reader<key extends PropertyKey, environment>(
  cell: AsReaderCell<key, environment>,
  environment: NoInfer<environment>,
): CellBinding<Uses<typeof cell>, "reader", never> {
  return new ReaderBinding(
    cell as unknown as AsReaderCell<PropertyKey, unknown>,
    environment,
  ) as unknown as CellBinding<Uses<typeof cell>, "reader", never>;
}

/** Supply a State cell's initial state and retain its final state by name. */
export function provide_state<key extends PropertyKey, state>(
  cell: AsCell<key, state>,
  initial: NoInfer<state>,
): CellBinding<Uses<typeof cell>, "state", state> {
  return new StateBinding(
    cell as unknown as AsCell<PropertyKey, unknown>,
    initial,
  ) as unknown as CellBinding<Uses<typeof cell>, "state", state>;
}

/** Supply a Writer cell's initial log (defaults to the cell's declared empty log). */
export function provide_writer<
  key extends PropertyKey,
  output extends Monoid<output>,
  log,
>(
  cell: AsWriterCell<key, output, log>,
  initial?: Data<NoInfer<output>, NoInfer<log>>,
): CellBinding<Uses<typeof cell>, "writer", Data<output, log>> {
  return new WriterBinding(
    cell as unknown as AsWriterCell<PropertyKey, Dictionary, unknown>,
    initial as Data<Dictionary, unknown> | undefined,
  ) as unknown as CellBinding<Uses<typeof cell>, "writer", Data<output, log>>;
}

type Bindings = Readonly<
  Record<PropertyKey, CellBinding<unknown, Family, unknown>>
>;
type BoundRequirements<bindings extends Bindings> = NonNullable<
  bindings[keyof bindings][typeof binding_requirements]
>;
type NamedValues<bindings extends Bindings, family extends Family> = {
  readonly [
    name in keyof bindings as bindings[name]["family"] extends family ? name
      : never
  ]: bindings[name] extends CellBinding<unknown, Family, infer value> ? value
    : never;
};

/** Named result, final states, and logs produced by cell handlers. */
export type CellResult<item, bindings extends Bindings> = {
  readonly result: item;
  readonly states: NamedValues<bindings, "state">;
  readonly logs: NamedValues<bindings, "writer">;
};

type OrderedBinding = {
  readonly name: PropertyKey;
  readonly family: Family;
  readonly binding: MaybeBuiltinBinding;
};

type FusedCellPlan = {
  readonly slot_count: number;
  readonly dispatch: ReadonlyMap<unknown, number> | undefined;
  readonly families: readonly number[];
  readonly bindings: readonly BuiltinBinding[];
  readonly fast_count: number;
  readonly k0: unknown;
  readonly s0: number;
  readonly f0: number;
  readonly k1: unknown;
  readonly s1: number;
  readonly f1: number;
  readonly k2: unknown;
  readonly s2: number;
  readonly f2: number;
  readonly state_names: readonly PropertyKey[];
  readonly state_slots: readonly number[];
  readonly writer_names: readonly PropertyKey[];
  readonly writer_slots: readonly number[];
  readonly has_proto_key: boolean;
  readonly initial_template: readonly unknown[] | undefined;
};

function collect_ordered_bindings(bindings: Bindings): OrderedBinding[] {
  const out: OrderedBinding[] = [];
  for (const key in bindings) {
    if (!Object.hasOwn(bindings, key)) continue;
    const binding = bindings[key] as MaybeBuiltinBinding;
    out.push({ name: key, family: binding.family, binding });
  }
  const symbol_keys = Object.getOwnPropertySymbols(bindings);
  for (let i = 0; i < symbol_keys.length; i += 1) {
    const key = symbol_keys[i];
    if (!Object.prototype.propertyIsEnumerable.call(bindings, key)) continue;
    const binding = bindings[key] as MaybeBuiltinBinding;
    out.push({ name: key, family: binding.family, binding });
  }
  return out;
}

function build_fused_cell_plan(
  ordered: readonly OrderedBinding[],
  build_template = true,
): FusedCellPlan | undefined {
  const len = ordered.length;
  const families = new Array<number>(len);
  const builtin_bindings = new Array<BuiltinBinding>(len);
  const state_names: PropertyKey[] = [];
  const state_slots: number[] = [];
  const writer_names: PropertyKey[] = [];
  const writer_slots: number[] = [];
  let has_proto_key = false;
  let static_initial = build_template;
  let k0: unknown;
  let s0 = -1;
  let f0 = -1;
  let k1: unknown;
  let s1 = -1;
  let f1 = -1;
  let k2: unknown;
  let s2 = -1;
  let f2 = -1;
  let fast_count = 0;
  let dispatch: Map<unknown, number> | undefined;

  for (let index = 0; index < len; index += 1) {
    const entry = ordered[index];
    const b = entry.binding;
    const fam = b[cell_family];
    if (fam === undefined) return undefined;
    const builtin = b as BuiltinBinding;
    families[index] = fam;
    builtin_bindings[index] = builtin;
    if (entry.name === "__proto__") has_proto_key = true;
    if (fam === FAMILY_STATE) {
      state_names.push(entry.name);
      state_slots.push(index);
    } else if (fam === FAMILY_WRITER) {
      writer_names.push(entry.name);
      writer_slots.push(index);
      if (builtin[cell_init] === undefined) static_initial = false;
    }
    const rk = builtin[cell_kind];
    if (dispatch !== undefined) {
      if (!dispatch.has(rk)) dispatch.set(rk, index);
    } else if (
      (fast_count >= 1 && rk === k0) ||
      (fast_count >= 2 && rk === k1) ||
      (fast_count === 3 && rk === k2)
    ) {
      // Earlier bindings run innermost and own any duplicate cell key.
    } else if (fast_count === 0) {
      k0 = rk;
      s0 = index;
      f0 = fam;
      fast_count = 1;
    } else if (fast_count === 1) {
      k1 = rk;
      s1 = index;
      f1 = fam;
      fast_count = 2;
    } else if (fast_count === 2) {
      k2 = rk;
      s2 = index;
      f2 = fam;
      fast_count = 3;
    } else {
      dispatch = new Map<unknown, number>([
        [k0, s0],
        [k1, s1],
        [k2, s2],
        [rk, index],
      ]);
      fast_count = 4;
    }
  }
  let initial_template: unknown[] | undefined;
  if (static_initial) {
    initial_template = new Array<unknown>(len);
    for (let index = 0; index < len; index += 1) {
      initial_template[index] = builtin_bindings[index][cell_init];
    }
  }
  return {
    slot_count: len,
    dispatch,
    families,
    bindings: builtin_bindings,
    fast_count,
    k0,
    s0,
    f0,
    k1,
    s1,
    f1,
    k2,
    s2,
    f2,
    state_names,
    state_slots,
    writer_names,
    writer_slots,
    has_proto_key,
    initial_template,
  };
}

function set_named_property(
  target: Record<PropertyKey, unknown>,
  name: PropertyKey,
  value: unknown,
): void {
  if (name === "__proto__") {
    Object.defineProperty(target, name, {
      value,
      enumerable: true,
    });
    return;
  }
  target[name] = value;
}

function build_cell_result_fast<item, bindings extends Bindings>(
  result: unknown,
  plan: FusedCellPlan,
  values: readonly unknown[],
): CellResult<item, bindings> {
  const states: Record<PropertyKey, unknown> = {};
  const logs: Record<PropertyKey, unknown> = {};
  const s_names = plan.state_names;
  const s_slots = plan.state_slots;
  const w_names = plan.writer_names;
  const w_slots = plan.writer_slots;
  if (plan.has_proto_key) {
    for (let i = 0; i < s_names.length; i += 1) {
      set_named_property(states, s_names[i], values[s_slots[i]]);
    }
    for (let i = 0; i < w_names.length; i += 1) {
      set_named_property(logs, w_names[i], values[w_slots[i]]);
    }
  } else {
    for (let i = 0; i < s_names.length; i += 1) {
      states[s_names[i]] = values[s_slots[i]];
    }
    for (let i = 0; i < w_names.length; i += 1) {
      logs[w_names[i]] = values[w_slots[i]];
    }
  }
  return {
    result: result as item,
    states: states as NamedValues<bindings, "state">,
    logs: logs as NamedValues<bindings, "writer">,
  };
}

function initial_cell_values(plan: FusedCellPlan): unknown[] {
  if (plan.initial_template !== undefined) {
    return plan.initial_template.slice();
  }
  const len = plan.slot_count;
  const bindings = plan.bindings;
  const families = plan.families;
  const values = new Array<unknown>(len);
  for (let index = 0; index < len; index += 1) {
    const b = bindings[index];
    if (families[index] === FAMILY_WRITER && b[cell_init] === undefined) {
      values[index] = writer_cell_empty(
        b[cell_ref] as AsWriterCell<PropertyKey, Dictionary, unknown>,
      );
    } else {
      values[index] = b[cell_init];
    }
  }
  return values;
}

function flush_writer_buffers(
  values: unknown[],
  buffers: (unknown[] | undefined)[] | undefined,
): void {
  if (buffers === undefined) return;
  for (let index = 0; index < buffers.length; index += 1) {
    const buffer = buffers[index];
    if (buffer !== undefined) {
      values[index] = ArrayT(buffer);
      buffers[index] = undefined;
    }
  }
}

function run_fused_cells_step(
  effect: Effect<unknown, unknown>,
  plan: FusedCellPlan,
  values: unknown[],
  terminal: boolean,
): Effect<unknown, unknown> | CellResult<unknown, Bindings> {
  let current = effect;
  let buffers: (unknown[] | undefined)[] | undefined;
  let non_bufferable_mask = 0;
  let non_bufferable_set: Set<number> | undefined;
  const fast_count = plan.fast_count;
  const k0 = plan.k0;
  const s0 = plan.s0;
  const f0 = plan.f0;
  const k1 = plan.k1;
  const s1 = plan.s1;
  const f1 = plan.f1;
  const k2 = plan.k2;
  const s2 = plan.s2;
  const f2 = plan.f2;

  while (true) {
    if (current[0] === "pure") {
      if (buffers !== undefined) flush_writer_buffers(values, buffers);
      const out = build_cell_result_fast<unknown, Bindings>(
        current[1],
        plan,
        values,
      );
      return terminal ? out : pure(out);
    }

    const operation = current[1];
    if (
      typeof operation === "object" && operation !== null &&
      (operation as TaggedOperation)[0] === "lift"
    ) {
      const lifted = (operation as readonly [string, unknown])[1];
      if (typeof lifted === "object" && lifted !== null) {
        const lifted_kind = (lifted as Dictionary)[kind];
        let slot = -1;
        let fam = -1;
        if (fast_count <= 3) {
          if (fast_count >= 1 && lifted_kind === k0) {
            slot = s0;
            fam = f0;
          } else if (fast_count >= 2 && lifted_kind === k1) {
            slot = s1;
            fam = f1;
          } else if (fast_count === 3 && lifted_kind === k2) {
            slot = s2;
            fam = f2;
          }
        } else {
          const found = plan.dispatch!.get(lifted_kind);
          if (found !== undefined) {
            slot = found;
            fam = plan.families[found];
          }
        }
        if (slot !== -1) {
          if (fam === FAMILY_READER) {
            const value = (
              lifted as { value(): (env: unknown) => unknown }
            ).value()(values[slot]);
            current = current[2](value);
            continue;
          }
          if (fam === FAMILY_STATE) {
            const pair = (
              lifted as {
                value(): (state: unknown) => readonly [unknown, unknown];
              }
            ).value()(values[slot]);
            values[slot] = pair[1];
            current = current[2](pair[0]);
            continue;
          }
          const pair = (
            lifted as {
              value(): readonly [unknown, Data<Dictionary, unknown>];
            }
          ).value();
          const next_output = pair[1];
          const current_output = values[slot] as Data<Dictionary, unknown>;
          const is_bufferable = slot < 31
            ? (non_bufferable_mask & (1 << slot)) === 0
            : !(non_bufferable_set?.has(slot) ?? false);
          const existing_buffer = buffers?.[slot];
          if (
            is_bufferable &&
            (existing_buffer !== undefined ||
              has_canonical_array_concat(current_output)) &&
            is_canonical_array_concat_method() &&
            is_kind_of(next_output, ArrayT)
          ) {
            let active = existing_buffer;
            if (active === undefined) {
              active = [];
              append_array_log(
                active,
                current_output.value() as readonly unknown[],
              );
              buffers ??= new Array<unknown[] | undefined>(plan.slot_count);
              buffers[slot] = active;
            }
            append_array_log(
              active,
              next_output.value() as readonly unknown[],
            );
          } else {
            let target = current_output;
            if (existing_buffer !== undefined) {
              target = ArrayT(existing_buffer) as unknown as Data<
                Dictionary,
                unknown
              >;
              buffers![slot] = undefined;
            }
            if (slot < 31) non_bufferable_mask |= 1 << slot;
            else (non_bufferable_set ??= new Set()).add(slot);
            values[slot] = (
              target as unknown as {
                concat(other: unknown): Data<Dictionary, unknown>;
              }
            ).concat(next_output);
          }
          current = current[2](pair[0]);
          continue;
        }
      }
    }

    if (terminal) {
      throw new TypeError(
        "Unhandled effect operation: " +
          String((operation as TaggedOperation)[0]),
      );
    }

    // Flush active mutable writer buffers before suspending so replayed
    // continuations receive an immutable snapshot of all cell slots.
    if (buffers !== undefined) flush_writer_buffers(values, buffers);
    const suspended = current;
    return suspend(
      suspended[1],
      (value) =>
        run_fused_cells_step(
          suspended[2](value),
          plan,
          values.slice(),
          false,
        ) as Effect<unknown, unknown>,
    );
  }
}

let oneshot_fallback_ordered: OrderedBinding[] | undefined;

// 1-pass direct <= 3-cell fast path for 1-shot run_cells / handle_cells:
// avoids Object.keys, OrderedBinding[], specs[], FusedCellPlan, and values[] when <= 3 built-in cells.
// If fallback is needed, stores the already-inspected OrderedBinding[] without reading any getter twice.
function run_oneshot_cells(
  effect: Effect<unknown, unknown>,
  bindings: Bindings,
  terminal: boolean,
): Effect<unknown, unknown> | CellResult<unknown, Bindings> | undefined {
  let count = 0;
  let n0: PropertyKey = "";
  let b0: BuiltinBinding | undefined;
  let n1: PropertyKey = "";
  let b1: BuiltinBinding | undefined;
  let n2: PropertyKey = "";
  let b2: BuiltinBinding | undefined;
  let fallback: OrderedBinding[] | undefined;

  const visit = (key: PropertyKey) => {
    const binding = bindings[key] as MaybeBuiltinBinding;
    if (fallback !== undefined) {
      fallback.push({ name: key, family: binding.family, binding });
      return;
    }
    if (binding[cell_family] === undefined || count === 3) {
      fallback = [];
      if (count >= 1) {
        fallback.push({ name: n0, family: b0!.family, binding: b0! });
      }
      if (count >= 2) {
        fallback.push({ name: n1, family: b1!.family, binding: b1! });
      }
      if (count === 3) {
        fallback.push({ name: n2, family: b2!.family, binding: b2! });
      }
      fallback.push({ name: key, family: binding.family, binding });
      return;
    }
    if (count === 0) {
      n0 = key;
      b0 = binding as BuiltinBinding;
      count = 1;
    } else if (count === 1) {
      n1 = key;
      b1 = binding as BuiltinBinding;
      count = 2;
    } else {
      n2 = key;
      b2 = binding as BuiltinBinding;
      count = 3;
    }
  };

  for (const key in bindings) {
    if (!Object.hasOwn(bindings, key)) continue;
    visit(key);
  }
  const syms = Object.getOwnPropertySymbols(bindings);
  for (let i = 0; i < syms.length; i += 1) {
    const key = syms[i];
    if (!Object.prototype.propertyIsEnumerable.call(bindings, key)) continue;
    visit(key);
  }
  if (fallback !== undefined) {
    oneshot_fallback_ordered = fallback;
    return undefined;
  }

  let f0 = -1;
  let k0: unknown;
  let v0: unknown;
  let f1 = -1;
  let k1: unknown;
  let v1: unknown;
  let f2 = -1;
  let k2: unknown;
  let v2: unknown;

  if (count >= 1) {
    f0 = b0![cell_family];
    k0 = b0![cell_kind];
    v0 = f0 === FAMILY_WRITER && b0![cell_init] === undefined
      ? writer_cell_empty(
        b0![cell_ref] as AsWriterCell<PropertyKey, Dictionary, unknown>,
      )
      : b0![cell_init];
  }
  if (count >= 2) {
    f1 = b1![cell_family];
    k1 = b1![cell_kind];
    v1 = f1 === FAMILY_WRITER && b1![cell_init] === undefined
      ? writer_cell_empty(
        b1![cell_ref] as AsWriterCell<PropertyKey, Dictionary, unknown>,
      )
      : b1![cell_init];
  }
  if (count === 3) {
    f2 = b2![cell_family];
    k2 = b2![cell_kind];
    v2 = f2 === FAMILY_WRITER && b2![cell_init] === undefined
      ? writer_cell_empty(
        b2![cell_ref] as AsWriterCell<PropertyKey, Dictionary, unknown>,
      )
      : b2![cell_init];
  }

  let buf0: unknown[] | undefined;
  let buf1: unknown[] | undefined;
  let buf2: unknown[] | undefined;
  let non_buf_mask = 0;
  let current = effect;

  while (true) {
    if (current[0] === "pure") {
      if (buf0 !== undefined) v0 = ArrayT(buf0);
      if (buf1 !== undefined) v1 = ArrayT(buf1);
      if (buf2 !== undefined) v2 = ArrayT(buf2);
      const states: Record<PropertyKey, unknown> = {};
      const logs: Record<PropertyKey, unknown> = {};
      if (count >= 1) {
        if (f0 === FAMILY_STATE) set_named_property(states, n0, v0);
        else if (f0 === FAMILY_WRITER) set_named_property(logs, n0, v0);
      }
      if (count >= 2) {
        if (f1 === FAMILY_STATE) set_named_property(states, n1, v1);
        else if (f1 === FAMILY_WRITER) set_named_property(logs, n1, v1);
      }
      if (count === 3) {
        if (f2 === FAMILY_STATE) set_named_property(states, n2, v2);
        else if (f2 === FAMILY_WRITER) set_named_property(logs, n2, v2);
      }
      const out = {
        result: current[1],
        states: states as NamedValues<Bindings, "state">,
        logs: logs as NamedValues<Bindings, "writer">,
      };
      return terminal ? out : pure(out);
    }

    const operation = current[1];
    if (
      count > 0 && typeof operation === "object" && operation !== null &&
      (operation as TaggedOperation)[0] === "lift"
    ) {
      const lifted = (operation as readonly [string, unknown])[1];
      if (typeof lifted === "object" && lifted !== null) {
        const lifted_kind = (lifted as Dictionary)[kind];
        // Earlier bindings run innermost and own any duplicate cell key.
        if (lifted_kind === k0) {
          if (f0 === FAMILY_READER) {
            current = current[2](
              (lifted as { value(): (env: unknown) => unknown }).value()(v0),
            );
            continue;
          }
          if (f0 === FAMILY_STATE) {
            const pair = (
              lifted as {
                value(): (state: unknown) => readonly [unknown, unknown];
              }
            ).value()(v0);
            v0 = pair[1];
            current = current[2](pair[0]);
            continue;
          }
          const pair = (
            lifted as {
              value(): readonly [unknown, Data<Dictionary, unknown>];
            }
          ).value();
          const next_out = pair[1];
          const cur_out = v0 as Data<Dictionary, unknown>;
          if (
            (non_buf_mask & 1) === 0 &&
            (buf0 !== undefined || has_canonical_array_concat(cur_out)) &&
            is_canonical_array_concat_method() &&
            is_kind_of(next_out, ArrayT)
          ) {
            if (buf0 === undefined) {
              buf0 = [];
              append_array_log(buf0, cur_out.value() as readonly unknown[]);
            }
            append_array_log(buf0, next_out.value() as readonly unknown[]);
          } else {
            let target = cur_out;
            if (buf0 !== undefined) {
              target = ArrayT(buf0) as unknown as Data<Dictionary, unknown>;
              buf0 = undefined;
            }
            non_buf_mask |= 1;
            v0 = (
              target as unknown as {
                concat(other: unknown): Data<Dictionary, unknown>;
              }
            ).concat(next_out);
          }
          current = current[2](pair[0]);
          continue;
        }
        if (count >= 2 && lifted_kind === k1) {
          if (f1 === FAMILY_READER) {
            current = current[2](
              (lifted as { value(): (env: unknown) => unknown }).value()(v1),
            );
            continue;
          }
          if (f1 === FAMILY_STATE) {
            const pair = (
              lifted as {
                value(): (state: unknown) => readonly [unknown, unknown];
              }
            ).value()(v1);
            v1 = pair[1];
            current = current[2](pair[0]);
            continue;
          }
          const pair = (
            lifted as {
              value(): readonly [unknown, Data<Dictionary, unknown>];
            }
          ).value();
          const next_out = pair[1];
          const cur_out = v1 as Data<Dictionary, unknown>;
          if (
            (non_buf_mask & 2) === 0 &&
            (buf1 !== undefined || has_canonical_array_concat(cur_out)) &&
            is_canonical_array_concat_method() &&
            is_kind_of(next_out, ArrayT)
          ) {
            if (buf1 === undefined) {
              buf1 = [];
              append_array_log(buf1, cur_out.value() as readonly unknown[]);
            }
            append_array_log(buf1, next_out.value() as readonly unknown[]);
          } else {
            let target = cur_out;
            if (buf1 !== undefined) {
              target = ArrayT(buf1) as unknown as Data<Dictionary, unknown>;
              buf1 = undefined;
            }
            non_buf_mask |= 2;
            v1 = (
              target as unknown as {
                concat(other: unknown): Data<Dictionary, unknown>;
              }
            ).concat(next_out);
          }
          current = current[2](pair[0]);
          continue;
        }
        if (count === 3 && lifted_kind === k2) {
          if (f2 === FAMILY_READER) {
            current = current[2](
              (lifted as { value(): (env: unknown) => unknown }).value()(v2),
            );
            continue;
          }
          if (f2 === FAMILY_STATE) {
            const pair = (
              lifted as {
                value(): (state: unknown) => readonly [unknown, unknown];
              }
            ).value()(v2);
            v2 = pair[1];
            current = current[2](pair[0]);
            continue;
          }
          const pair = (
            lifted as {
              value(): readonly [unknown, Data<Dictionary, unknown>];
            }
          ).value();
          const next_out = pair[1];
          const cur_out = v2 as Data<Dictionary, unknown>;
          if (
            (non_buf_mask & 4) === 0 &&
            (buf2 !== undefined || has_canonical_array_concat(cur_out)) &&
            is_canonical_array_concat_method() &&
            is_kind_of(next_out, ArrayT)
          ) {
            if (buf2 === undefined) {
              buf2 = [];
              append_array_log(buf2, cur_out.value() as readonly unknown[]);
            }
            append_array_log(buf2, next_out.value() as readonly unknown[]);
          } else {
            let target = cur_out;
            if (buf2 !== undefined) {
              target = ArrayT(buf2) as unknown as Data<Dictionary, unknown>;
              buf2 = undefined;
            }
            non_buf_mask |= 4;
            v2 = (
              target as unknown as {
                concat(other: unknown): Data<Dictionary, unknown>;
              }
            ).concat(next_out);
          }
          current = current[2](pair[0]);
          continue;
        }
      }
    }

    if (terminal) {
      throw new TypeError(
        "Unhandled effect operation: " +
          String((operation as TaggedOperation)[0]),
      );
    }

    // Lazily materialize a FusedCellPlan only when handle_cells actually suspends.
    if (buf0 !== undefined) v0 = ArrayT(buf0);
    if (buf1 !== undefined) v1 = ArrayT(buf1);
    if (buf2 !== undefined) v2 = ArrayT(buf2);
    const ordered: OrderedBinding[] = [];
    const values: unknown[] = [];
    if (count >= 1) {
      ordered.push({ name: n0, family: b0!.family, binding: b0! });
      values.push(v0);
    }
    if (count >= 2) {
      ordered.push({ name: n1, family: b1!.family, binding: b1! });
      values.push(v1);
    }
    if (count === 3) {
      ordered.push({ name: n2, family: b2!.family, binding: b2! });
      values.push(v2);
    }
    const plan = build_fused_cell_plan(ordered, false)!;
    const suspended = current;
    return suspend(
      suspended[1],
      (value) =>
        run_fused_cells_step(
          suspended[2](value),
          plan,
          values.slice(),
          false,
        ) as Effect<unknown, unknown>,
    );
  }
}

function unpack_cell_result<item, bindings extends Bindings>(
  packed: unknown,
  ordered: readonly OrderedBinding[],
): CellResult<item, bindings> {
  let result = packed;
  const states: Record<PropertyKey, unknown> = {};
  const logs: Record<PropertyKey, unknown> = {};
  for (let index = ordered.length - 1; index >= 0; index--) {
    const { name, family } = ordered[index];
    if (family === "reader") continue;
    const [value, final] = result as readonly [unknown, unknown];
    result = value;
    set_named_property(family === "writer" ? logs : states, name, final);
  }
  return {
    result: result as item,
    states: states as NamedValues<bindings, "state">,
    logs: logs as NamedValues<bindings, "writer">,
  };
}

/** Handle supplied cells in property order while preserving remaining capabilities. */
export function handle_cells<
  requirements,
  item,
  const bindings extends Bindings,
>(
  effect: Effect<requirements, item>,
  bindings: bindings,
): Effect<
  Exclude<requirements, BoundRequirements<bindings>>,
  CellResult<item, bindings>
> {
  const fast = run_oneshot_cells(
    effect as Effect<unknown, unknown>,
    bindings,
    false,
  );
  if (fast !== undefined) {
    return fast as Effect<
      Exclude<requirements, BoundRequirements<bindings>>,
      CellResult<item, bindings>
    >;
  }
  const ordered = oneshot_fallback_ordered ??
    collect_ordered_bindings(bindings);
  oneshot_fallback_ordered = undefined;
  const fused = build_fused_cell_plan(ordered, false);
  if (fused !== undefined) {
    return run_fused_cells_step(
      effect as Effect<unknown, unknown>,
      fused,
      initial_cell_values(fused),
      false,
    ) as Effect<
      Exclude<requirements, BoundRequirements<bindings>>,
      CellResult<item, bindings>
    >;
  }
  let current = effect as Effect<unknown, unknown>;
  for (const entry of ordered) current = entry.binding.handle(current);
  return map(
    current,
    (packed) => unpack_cell_result<item, bindings>(packed, ordered),
  ) as Effect<
    Exclude<requirements, BoundRequirements<bindings>>,
    CellResult<item, bindings>
  >;
}

/** Snapshot cell bindings once for composable reuse across effects with other capabilities. */
export function prepare_handle_cells<const bindings extends Bindings>(
  bindings: bindings,
): <requirements, item>(
  effect: Effect<requirements, item>,
) => Effect<
  Exclude<requirements, BoundRequirements<bindings>>,
  CellResult<item, bindings>
> {
  const ordered = collect_ordered_bindings(bindings);
  const fused = build_fused_cell_plan(ordered);
  if (fused !== undefined) {
    return function prepared<requirements, item>(
      effect: Effect<requirements, item>,
    ): Effect<
      Exclude<requirements, BoundRequirements<bindings>>,
      CellResult<item, bindings>
    > {
      return run_fused_cells_step(
        effect as Effect<unknown, unknown>,
        fused,
        initial_cell_values(fused),
        false,
      ) as Effect<
        Exclude<requirements, BoundRequirements<bindings>>,
        CellResult<item, bindings>
      >;
    };
  }
  return function prepared<requirements, item>(
    effect: Effect<requirements, item>,
  ): Effect<
    Exclude<requirements, BoundRequirements<bindings>>,
    CellResult<item, bindings>
  > {
    let current = effect as Effect<unknown, unknown>;
    for (const entry of ordered) current = entry.binding.handle(current);
    return map(
      current,
      (packed) => unpack_cell_result<item, bindings>(packed, ordered),
    ) as Effect<
      Exclude<requirements, BoundRequirements<bindings>>,
      CellResult<item, bindings>
    >;
  };
}

/** Run fully supplied cells in property order, returning named states and logs. */
export function run_cells<requirements, item, const bindings extends Bindings>(
  effect:
    & Effect<requirements, item>
    & ([Exclude<requirements, BoundRequirements<bindings>>] extends [never]
      ? unknown
      : {
        readonly ERROR: "run_cells requires a binding for every capability";
      }),
  bindings: bindings,
): CellResult<item, bindings> {
  const fast = run_oneshot_cells(
    effect as Effect<unknown, unknown>,
    bindings,
    true,
  );
  if (fast !== undefined) {
    return fast as CellResult<item, bindings>;
  }
  const ordered = oneshot_fallback_ordered ??
    collect_ordered_bindings(bindings);
  oneshot_fallback_ordered = undefined;
  const fused = build_fused_cell_plan(ordered, false);
  if (fused !== undefined) {
    return run_fused_cells_step(
      effect as Effect<unknown, unknown>,
      fused,
      initial_cell_values(fused),
      true,
    ) as CellResult<item, bindings>;
  }
  let current = effect as Effect<unknown, unknown>;
  for (const entry of ordered) current = entry.binding.handle(current);
  return unpack_cell_result<item, bindings>(
    run(current as Effect<never, unknown>),
    ordered,
  );
}

/** Snapshot cell names, order, families and handlers once; each run gets fresh state. */
export function prepare_cells<const bindings extends Bindings>(
  bindings: bindings,
): <requirements, item>(
  effect:
    & Effect<requirements, item>
    & ([Exclude<requirements, BoundRequirements<bindings>>] extends [never]
      ? unknown
      : {
        readonly ERROR: "run_cells requires a binding for every capability";
      }),
) => CellResult<item, bindings> {
  const ordered = collect_ordered_bindings(bindings);
  const fused = build_fused_cell_plan(ordered);
  if (fused !== undefined) {
    return function prepared<requirements, item>(
      effect:
        & Effect<requirements, item>
        & ([Exclude<requirements, BoundRequirements<bindings>>] extends [never]
          ? unknown
          : {
            readonly ERROR: "run_cells requires a binding for every capability";
          }),
    ): CellResult<item, bindings> {
      return run_fused_cells_step(
        effect as Effect<unknown, unknown>,
        fused,
        initial_cell_values(fused),
        true,
      ) as CellResult<item, bindings>;
    };
  }
  return function prepared<requirements, item>(
    effect:
      & Effect<requirements, item>
      & ([Exclude<requirements, BoundRequirements<bindings>>] extends [never]
        ? unknown
        : {
          readonly ERROR: "run_cells requires a binding for every capability";
        }),
  ): CellResult<item, bindings> {
    let current = effect as Effect<unknown, unknown>;
    for (const entry of ordered) current = entry.binding.handle(current);
    return unpack_cell_result<item, bindings>(
      run(current as Effect<never, unknown>),
      ordered,
    );
  };
}
