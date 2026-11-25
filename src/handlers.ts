import { ArrayT } from "./array.ts";
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
import { type Data, type Dictionary, kind } from "./typeclass.ts";
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

function run_operations_loop(
  effect: Effect<unknown, unknown>,
  entries: Record<string, OperationEntry> | ReadonlyMap<string, OperationEntry>,
  is_map: boolean,
  receiver: unknown,
): Effect<unknown, unknown> {
  let current = effect;
  while (true) {
    if (current[0] === "pure") return current;
    const operation = current[1];
    let handle: OperationEntry | undefined;
    if (Array.isArray(operation)) {
      if (is_map) {
        handle = (entries as ReadonlyMap<string, OperationEntry>).get(
          operation[0],
        );
      } else if (Object.hasOwn(entries, operation[0])) {
        const candidate = (entries as Record<string, OperationEntry>)[
          operation[0]
        ];
        if (typeof candidate === "function") handle = candidate;
      }
    }
    if (handle === undefined) {
      const suspended = current;
      return suspend(
        suspended[1] as Operation<unknown>,
        (value) =>
          run_operations_loop(suspended[2](value), entries, is_map, receiver),
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
        run_operations_loop(suspended[2](value), entries, is_map, receiver),
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
  const entries = handlers as unknown as Record<
    string,
    (
      operation: TaggedOperation & Operation<unknown>,
    ) => Effect<unknown, unknown>
  >;
  return run_operations_loop(
    effect as Effect<unknown, unknown>,
    entries,
    false,
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
  type SelectedOperation = TaggedOperation & Operation<unknown>;
  const entries = new Map<
    string,
    (operation: SelectedOperation) => Effect<unknown, unknown>
  >();
  for (const tag of Object.keys(handlers)) {
    const handle = (handlers as Record<string, unknown>)[tag];
    if (typeof handle === "function") {
      entries.set(
        tag,
        handle as (operation: SelectedOperation) => Effect<unknown, unknown>,
      );
    }
  }
  return function prepared<pending, item>(
    effect: PreparedEffect<pending, item, table>,
  ): Effect<
    | Exclude<pending, Selected<pending, HandledTags<table>>>
    | HandledRequirements<table>,
    item
  > {
    if (entries.size === 0) {
      return effect as Effect<
        | Exclude<pending, Selected<pending, HandledTags<table>>>
        | HandledRequirements<table>,
        item
      >;
    }
    return run_operations_loop(
      effect as Effect<unknown, unknown>,
      entries,
      true,
      handlers,
    ) as Effect<
      | Exclude<pending, Selected<pending, HandledTags<table>>>
      | HandledRequirements<table>,
      item
    >;
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

type CellSpec =
  | {
    readonly family: "reader";
    readonly runtime_kind: unknown;
    readonly value: unknown;
  }
  | {
    readonly family: "state";
    readonly runtime_kind: unknown;
    readonly initial: unknown;
  }
  | {
    readonly family: "writer";
    readonly runtime_kind: unknown;
    readonly initial: Data<Dictionary, unknown> | undefined;
    readonly cell: AsWriterCell<PropertyKey, Dictionary, unknown>;
  };

const cell_binding_specs = new WeakMap<object, CellSpec>();

/** Supply a Reader cell's environment. */
export function provide_reader<key extends PropertyKey, environment>(
  cell: AsReaderCell<key, environment>,
  environment: NoInfer<environment>,
): CellBinding<Uses<typeof cell>, "reader", never> {
  const binding: CellBinding<Uses<typeof cell>, "reader", never> = {
    family: "reader",
    handle: (effect) =>
      run_reader(
        cell,
        effect as Effect<Uses<typeof cell>, unknown>,
        environment,
      ),
  };
  cell_binding_specs.set(binding, {
    family: "reader",
    runtime_kind: cell[kind],
    value: environment,
  });
  return binding;
}

/** Supply a State cell's initial state and retain its final state by name. */
export function provide_state<key extends PropertyKey, state>(
  cell: AsCell<key, state>,
  initial: NoInfer<state>,
): CellBinding<Uses<typeof cell>, "state", state> {
  const binding: CellBinding<Uses<typeof cell>, "state", state> = {
    family: "state",
    handle: (effect) =>
      run_state(cell, effect as Effect<Uses<typeof cell>, unknown>, initial),
  };
  cell_binding_specs.set(binding, {
    family: "state",
    runtime_kind: cell[kind],
    initial,
  });
  return binding;
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
  const binding: CellBinding<Uses<typeof cell>, "writer", Data<output, log>> = {
    family: "writer",
    handle: (effect) =>
      run_writer(
        cell,
        effect as Effect<Uses<typeof cell>, unknown>,
        initial === undefined ? writer_cell_empty(cell) : initial,
      ),
  };
  cell_binding_specs.set(binding, {
    family: "writer",
    runtime_kind: cell[kind],
    initial: initial as Data<Dictionary, unknown> | undefined,
    cell: cell as unknown as AsWriterCell<PropertyKey, Dictionary, unknown>,
  });
  return binding;
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
  readonly handle: (
    effect: Effect<unknown, unknown>,
  ) => Effect<unknown, unknown>;
  readonly spec?: CellSpec;
};

type FusedCellPlan = {
  readonly ordered: readonly OrderedBinding[];
  readonly dispatch: ReadonlyMap<unknown, number> | undefined;
  readonly specs: readonly CellSpec[];
  readonly fast_count: number;
  readonly k0: unknown;
  readonly s0: number;
  readonly k1: unknown;
  readonly s1: number;
  readonly k2: unknown;
  readonly s2: number;
  readonly initial_template: readonly unknown[] | undefined;
};

function collect_ordered_bindings(bindings: Bindings): OrderedBinding[] {
  const string_keys = Object.keys(bindings);
  const symbol_keys = Object.getOwnPropertySymbols(bindings);
  const out: OrderedBinding[] = [];
  for (let i = 0; i < string_keys.length; i += 1) {
    const key = string_keys[i];
    const binding = bindings[key];
    out.push({
      name: key,
      family: binding.family,
      handle: binding.handle,
      spec: cell_binding_specs.get(binding),
    });
  }
  for (let i = 0; i < symbol_keys.length; i += 1) {
    const key = symbol_keys[i];
    if (!Object.prototype.propertyIsEnumerable.call(bindings, key)) continue;
    const binding = bindings[key];
    out.push({
      name: key,
      family: binding.family,
      handle: binding.handle,
      spec: cell_binding_specs.get(binding),
    });
  }
  return out;
}

function build_fused_cell_plan(
  ordered: readonly OrderedBinding[],
  build_template = true,
): FusedCellPlan | undefined {
  const len = ordered.length;
  const specs = new Array<CellSpec>(len);
  let static_initial = build_template;
  let k0: unknown;
  let s0 = -1;
  let k1: unknown;
  let s1 = -1;
  let k2: unknown;
  let s2 = -1;
  let fast_count = 0;
  let dispatch: Map<unknown, number> | undefined;

  for (let index = 0; index < len; index += 1) {
    const spec = ordered[index].spec;
    if (spec === undefined) return undefined;
    specs[index] = spec;
    if (spec.family === "writer" && spec.initial === undefined) {
      static_initial = false;
    }
    const rk = spec.runtime_kind;
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
      fast_count = 1;
    } else if (fast_count === 1) {
      k1 = rk;
      s1 = index;
      fast_count = 2;
    } else if (fast_count === 2) {
      k2 = rk;
      s2 = index;
      fast_count = 3;
    } else {
      dispatch = new Map<unknown, number>([[k0, s0], [k1, s1], [k2, s2], [
        rk,
        index,
      ]]);
      fast_count = 4;
    }
  }
  let initial_template: unknown[] | undefined;
  if (static_initial) {
    initial_template = new Array<unknown>(len);
    for (let index = 0; index < len; index += 1) {
      const spec = specs[index];
      initial_template[index] = spec.family === "reader"
        ? spec.value
        : spec.initial;
    }
  }
  return {
    ordered,
    dispatch,
    specs,
    fast_count,
    k0,
    s0,
    k1,
    s1,
    k2,
    s2,
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

function build_cell_result<item, bindings extends Bindings>(
  result: unknown,
  ordered: readonly OrderedBinding[],
  values: readonly unknown[],
): CellResult<item, bindings> {
  const states: Record<PropertyKey, unknown> = {};
  const logs: Record<PropertyKey, unknown> = {};
  for (let index = 0; index < ordered.length; index += 1) {
    const { name, family } = ordered[index];
    if (family === "reader") continue;
    set_named_property(
      family === "writer" ? logs : states,
      name,
      values[index],
    );
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
  const values = new Array<unknown>(plan.specs.length);
  for (let index = 0; index < plan.specs.length; index += 1) {
    const spec = plan.specs[index];
    switch (spec.family) {
      case "reader":
        values[index] = spec.value;
        break;
      case "state":
        values[index] = spec.initial;
        break;
      case "writer":
        values[index] = spec.initial === undefined
          ? writer_cell_empty(spec.cell)
          : spec.initial;
        break;
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
  const k1 = plan.k1;
  const s1 = plan.s1;
  const k2 = plan.k2;
  const s2 = plan.s2;

  while (true) {
    if (current[0] === "pure") {
      flush_writer_buffers(values, buffers);
      const out = build_cell_result<unknown, Bindings>(
        current[1],
        plan.ordered,
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
        let slot: number | undefined;
        if (fast_count <= 3) {
          if (fast_count >= 1 && lifted_kind === k0) slot = s0;
          else if (fast_count >= 2 && lifted_kind === k1) slot = s1;
          else if (fast_count === 3 && lifted_kind === k2) slot = s2;
        } else {
          slot = plan.dispatch!.get(lifted_kind);
        }
        if (slot !== undefined) {
          const spec = plan.specs[slot];
          switch (spec.family) {
            case "reader": {
              const value = (
                lifted as { value(): (env: unknown) => unknown }
              ).value()(values[slot]);
              current = current[2](value);
              continue;
            }
            case "state": {
              const [value, next] = (
                lifted as {
                  value(): (state: unknown) => readonly [unknown, unknown];
                }
              ).value()(values[slot]);
              values[slot] = next;
              current = current[2](value);
              continue;
            }
            case "writer": {
              const [value, next_output] = (
                lifted as {
                  value(): readonly [unknown, Data<Dictionary, unknown>];
                }
              ).value();
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
                  buffers ??= new Array<unknown[] | undefined>(
                    plan.specs.length,
                  );
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
              current = current[2](value);
              continue;
            }
          }
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
    flush_writer_buffers(values, buffers);
    const suspended = current;
    const saved = values.slice();
    return suspend(
      suspended[1],
      (value) =>
        run_fused_cells_step(
          suspended[2](value),
          plan,
          saved.slice(),
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
  const ordered = collect_ordered_bindings(bindings);
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
  for (const binding of ordered) current = binding.handle(current);
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
    for (const binding of ordered) current = binding.handle(current);
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
  const ordered = collect_ordered_bindings(bindings);
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
  for (const binding of ordered) current = binding.handle(current);
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
    for (const binding of ordered) current = binding.handle(current);
    return unpack_cell_result<item, bindings>(
      run(current as Effect<never, unknown>),
      ordered,
    );
  };
}
