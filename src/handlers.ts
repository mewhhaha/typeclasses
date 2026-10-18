import {
  type Effect,
  handle_operation,
  type Operation,
  type OperationOutput,
  run,
  type TaggedOperation,
  type Uses,
} from "./effects.ts";
import { type AsReaderCell, run_reader } from "./reader.ts";
import { type AsCell, run_state } from "./state.ts";
import { type AsWriterCell, run_writer } from "./writer.ts";
import type { Data } from "./typeclass.ts";
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
  type SelectedOperation =
    & Selected<requirements, HandledTags<table>>
    & TaggedOperation
    & Operation<unknown>;
  const entries = handlers as unknown as Record<
    string,
    (operation: SelectedOperation) => Effect<unknown, unknown>
  >;
  return handle_operation(
    effect,
    (operation): operation is SelectedOperation =>
      Array.isArray(operation) && Object.hasOwn(entries, operation[0]) &&
      typeof entries[operation[0]] === "function",
    (operation) =>
      entries[operation[0]](operation) as Effect<
        unknown,
        OperationOutput<SelectedOperation>
      >,
  ) as Effect<
    | Exclude<requirements, Selected<requirements, HandledTags<table>>>
    | HandledRequirements<table>,
    item
  >;
}

type PreparedEffect<pending, item, table> =
  & Effect<pending, item>
  & (table extends OperationTable<NoInfer<pending>> ? unknown : {
    readonly ERROR:
      "prepared operation handler output must match its operation";
  });

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
    return handle_operation(
      effect,
      (operation): operation is SelectedOperation =>
        Array.isArray(operation) && entries.has(operation[0]),
      (operation) => entries.get(operation[0])!.call(handlers, operation),
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

/** Supply a Reader cell's environment. */
export function provide_reader<key extends PropertyKey, environment>(
  cell: AsReaderCell<key, environment>,
  environment: NoInfer<environment>,
): CellBinding<Uses<typeof cell>, "reader", never> {
  return {
    family: "reader",
    handle: (effect) =>
      run_reader(
        cell,
        effect as Effect<Uses<typeof cell>, unknown>,
        environment,
      ),
  };
}

/** Supply a State cell's initial state and retain its final state by name. */
export function provide_state<key extends PropertyKey, state>(
  cell: AsCell<key, state>,
  initial: NoInfer<state>,
): CellBinding<Uses<typeof cell>, "state", state> {
  return {
    family: "state",
    handle: (effect) =>
      run_state(cell, effect as Effect<Uses<typeof cell>, unknown>, initial),
  };
}

/** Supply a Writer cell's initial log and retain its final log by name. */
export function provide_writer<
  key extends PropertyKey,
  output extends Monoid<output>,
  log,
>(
  cell: AsWriterCell<key, output, log>,
  initial: Data<NoInfer<output>, NoInfer<log>>,
): CellBinding<Uses<typeof cell>, "writer", Data<output, log>> {
  return {
    family: "writer",
    handle: (effect) =>
      run_writer(cell, effect as Effect<Uses<typeof cell>, unknown>, initial),
  };
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
): {
  readonly result: item;
  readonly states: NamedValues<bindings, "state">;
  readonly logs: NamedValues<bindings, "writer">;
} {
  return prepare_cells(bindings)(effect);
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
) => {
  readonly result: item;
  readonly states: NamedValues<bindings, "state">;
  readonly logs: NamedValues<bindings, "writer">;
} {
  const ordered = Reflect.ownKeys(bindings)
    .filter((key) => Object.prototype.propertyIsEnumerable.call(bindings, key))
    .map((key) => ({
      name: key,
      family: bindings[key].family,
      handle: bindings[key].handle,
    }));
  return function prepared<requirements, item>(
    effect:
      & Effect<requirements, item>
      & ([Exclude<requirements, BoundRequirements<bindings>>] extends [never]
        ? unknown
        : {
          readonly ERROR: "run_cells requires a binding for every capability";
        }),
  ): {
    readonly result: item;
    readonly states: NamedValues<bindings, "state">;
    readonly logs: NamedValues<bindings, "writer">;
  } {
    let current = effect as Effect<unknown, unknown>;
    for (const binding of ordered) current = binding.handle(current);
    let result = run(current as Effect<never, unknown>);
    const states: Record<PropertyKey, unknown> = {};
    const logs: Record<PropertyKey, unknown> = {};
    for (let index = ordered.length - 1; index >= 0; index--) {
      const { name, family } = ordered[index];
      if (family === "reader") continue;
      const [value, final] = result as readonly [unknown, unknown];
      result = value;
      let destination = states;
      if (family === "writer") destination = logs;
      Object.defineProperty(destination, name, {
        value: final,
        enumerable: true,
      });
    }
    return {
      result: result as item,
      states: states as NamedValues<bindings, "state">,
      logs: logs as NamedValues<bindings, "writer">,
    };
  };
}
