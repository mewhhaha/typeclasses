import { ArrayT, type AsArray, to_array } from "../src/array.ts";
import {
  Effect,
  type Operation,
  Program,
  run,
  type TaggedOperation,
  type Uses,
} from "../src/effects.ts";
import { type AsWriter, run_writer, tell } from "../src/writer.ts";

export type StockStatus = {
  readonly sku: string;
  readonly quantity: number;
  readonly available: boolean;
};

export type InstrumentedEffectScenario = {
  readonly status: StockStatus;
  readonly trace: readonly string[];
};

type StockLookup =
  & Operation<number>
  & readonly ["stock.lookup", { readonly sku: string }];

type Stock = StockLookup;

type TraceRecord =
  & Operation<void>
  & readonly ["trace.record", { readonly message: string }];

type Trace = TraceRecord;

type WithoutStock<requirements> = requirements extends Stock ? never
  : requirements;

type WithoutTrace<requirements> = requirements extends Trace ? never
  : requirements;

const StockProgram = Program.scope<Stock>();

export function stock_status(sku: string) {
  return StockProgram(function* () {
    const quantity = yield* lookup_stock(sku);

    return {
      sku,
      quantity,
      available: quantity > 0,
    };
  });
}

export function run_instrumented_effect_scenario(): InstrumentedEffectScenario {
  const quantities = new Map([
    ["sku-42", 3],
  ]);
  const empty_trace = ArrayT<string>([]);
  const [status, trace] = Effect.interpret(
    instrument_stock_operations(stock_status("sku-42")),
  )
    .handle(run_trace_to_writer)
    .handle((effect) => run_stock(effect, quantities))
    .handle((effect) => run_writer(effect, empty_trace))
    .run(run);

  return {
    status,
    trace: to_array(trace),
  };
}

export function run_instrumented_effect_examples() {
  console.log(
    "handler-instrumented stock effect",
    Deno.inspect(run_instrumented_effect_scenario()),
  );
}

function lookup_stock(sku: string): Effect<StockLookup, number> {
  return Effect.send(["stock.lookup", { sku }] as StockLookup);
}

function trace(message: string): Effect<TraceRecord, void> {
  return Effect.send(["trace.record", { message }] as TraceRecord);
}

function instrument_stock_operations<requirements, item>(
  effect: Effect<requirements, item>,
): Effect<requirements | Trace, item> {
  if (effect[0] === "pure") {
    return Effect.pure(effect[1]);
  }

  const operation = effect[1] as TaggedOperation;

  if (operation[0] === "stock.lookup") {
    const [, lookup] = effect[1] as StockLookup;

    return Effect.bind(
      trace("stock.lookup.start sku=" + lookup.sku),
      () =>
        Effect.suspend(
          effect[1] as requirements,
          (value) =>
            Effect.bind(
              trace("stock.lookup.finish sku=" + lookup.sku),
              () => instrument_stock_operations(effect[2](value)),
            ),
        ),
    );
  }

  return Effect.suspend(
    effect[1] as requirements | Trace,
    (value) => instrument_stock_operations(effect[2](value)),
  );
}

function run_stock<requirements, item>(
  effect: Effect<requirements, item>,
  quantities: ReadonlyMap<string, number>,
): Effect<WithoutStock<requirements>, item> {
  if (effect[0] === "pure") {
    return Effect.pure(effect[1]);
  }

  const operation = effect[1] as TaggedOperation;

  if (operation[0] === "stock.lookup") {
    const [, lookup] = effect[1] as StockLookup;
    const quantity = quantities.get(lookup.sku) ?? 0;

    return run_stock(effect[2](quantity), quantities);
  }

  return Effect.suspend(
    effect[1] as WithoutStock<requirements>,
    (value) => run_stock(effect[2](value), quantities),
  );
}

function run_trace_to_writer<requirements, item>(
  effect: Effect<requirements, item>,
): Effect<
  WithoutTrace<requirements> | Uses<AsWriter<AsArray, string>>,
  item
> {
  if (effect[0] === "pure") {
    return Effect.pure(effect[1]);
  }

  const operation = effect[1] as TaggedOperation;

  if (operation[0] === "trace.record") {
    const [, record] = effect[1] as TraceRecord;

    return Effect.bind(
      Effect.lift(tell(ArrayT([record.message]))),
      () => run_trace_to_writer(effect[2](undefined)),
    );
  }

  return Effect.suspend(
    effect[1] as WithoutTrace<requirements>,
    (value) => run_trace_to_writer(effect[2](value)),
  );
}
