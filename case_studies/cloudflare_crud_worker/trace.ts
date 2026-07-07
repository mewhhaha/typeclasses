import { ArrayT, type AsArray } from "../../src/array.ts";
import {
  Effect,
  type Operation,
  type TaggedOperation,
  type Uses,
} from "../../src/effects.ts";
import { type AsTask, from_fn } from "../../src/task.ts";
import { type AsWriter, tell } from "../../src/writer.ts";

export type TraceAttributes = Readonly<
  Record<string, string | number | boolean>
>;

export type TraceEvent =
  & Operation<void>
  & readonly [
    "trace.event",
    {
      readonly name: string;
      readonly attributes: TraceAttributes;
    },
  ];

export type Trace = TraceEvent;

export type TraceRecord = {
  readonly name: string;
  readonly attributes: TraceAttributes;
};

export type TraceScope = {
  readonly name: string;
  readonly attributes?: TraceAttributes;
  readonly finish_attributes?: (value: unknown) => TraceAttributes;
};

export type TraceScopeSelector<requirements> = (
  operation: requirements,
) => TraceScope | undefined;

export type TraceSink = {
  event(record: TraceRecord): Promise<void>;
};

type WithoutTrace<requirements> = requirements extends Trace ? never
  : requirements;

export function trace_event(
  name: string,
  attributes: TraceAttributes = {},
): Effect<TraceEvent, void> {
  return Effect.send(["trace.event", { name, attributes }] as TraceEvent);
}

export function run_trace_scopes<requirements, item>(
  effect: Effect<requirements, item>,
  select_scope: TraceScopeSelector<requirements>,
): Effect<requirements | Trace, item> {
  if (effect[0] === "pure") {
    return Effect.pure(effect[1]);
  }

  const scope = select_scope(effect[1]);

  if (scope === undefined) {
    return Effect.suspend(
      effect[1] as requirements | Trace,
      (value) => run_trace_scopes(effect[2](value), select_scope),
    );
  }

  return Effect.bind(
    trace_event(scope.name + ".start", scope.attributes),
    () =>
      Effect.suspend(
        effect[1] as requirements | Trace,
        (value) =>
          Effect.bind(
            trace_event(
              scope.name + ".finish",
              trace_scope_finish_attributes(scope, value),
            ),
            () => run_trace_scopes(effect[2](value), select_scope),
          ),
      ),
  );
}

export function run_trace_to_writer<requirements, item>(
  effect: Effect<requirements, item>,
): Effect<
  WithoutTrace<requirements> | Uses<AsWriter<AsArray, string>>,
  item
> {
  if (effect[0] === "pure") {
    return Effect.pure(effect[1]);
  }

  const operation = effect[1] as TaggedOperation;

  if (operation[0] === "trace.event") {
    const trace = effect[1] as TraceEvent;

    return Effect.bind(
      Effect.lift(tell(ArrayT([format_trace(trace)]))),
      () => run_trace_to_writer(effect[2](undefined)),
    );
  }

  return Effect.suspend(
    effect[1] as WithoutTrace<requirements>,
    (value) => run_trace_to_writer(effect[2](value)),
  );
}

export function run_trace_with_sink<requirements, item>(
  effect: Effect<requirements, item>,
  sink: TraceSink,
): Effect<WithoutTrace<requirements> | Uses<AsTask>, item> {
  if (effect[0] === "pure") {
    return Effect.pure(effect[1]);
  }

  const operation = effect[1] as TaggedOperation;

  if (operation[0] === "trace.event") {
    const [, trace] = effect[1] as TraceEvent;

    return Effect.bind(
      Effect.lift(
        from_fn(() =>
          sink.event({
            name: trace.name,
            attributes: trace.attributes,
          })
        ),
      ),
      () => run_trace_with_sink(effect[2](undefined), sink),
    );
  }

  return Effect.suspend(
    effect[1] as WithoutTrace<requirements>,
    (value) => run_trace_with_sink(effect[2](value), sink),
  );
}

export function console_trace_sink(): TraceSink {
  return {
    event(record) {
      console.log(format_trace_record(record));
      return Promise.resolve();
    },
  };
}

export function format_trace(record: TraceEvent): string {
  const [, payload] = record;

  return format_trace_record({
    name: payload.name,
    attributes: payload.attributes,
  });
}

function format_trace_record(record: TraceRecord): string {
  const attributes = Object.entries(record.attributes);

  if (attributes.length === 0) {
    return "trace " + record.name;
  }

  return "trace " + record.name + " " +
    attributes
      .map(([key, value]) => key + "=" + String(value))
      .join(" ");
}

function trace_scope_finish_attributes(
  scope: TraceScope,
  value: unknown,
): TraceAttributes {
  if (scope.finish_attributes === undefined) {
    return {};
  }

  return scope.finish_attributes(value);
}
