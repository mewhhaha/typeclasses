import { ArrayT, type AsArray, to_array } from "../src/array.ts";
import { Effect, Program, run, type Uses } from "../src/effects.ts";
import { reader, run_reader } from "../src/reader.ts";
import { run_state, state } from "../src/state.ts";
import { run_writer, writer_cell } from "../src/writer.ts";

type DeploymentConfig = {
  readonly api_origin: string;
};

type RequestMetadata = {
  readonly request_id: string;
  readonly path: string;
};

export type KeyedCellScenario = {
  readonly endpoint: string;
  readonly previous_request_count: number;
  readonly request_count: number;
  readonly last_route: string;
  readonly audit: readonly string[];
  readonly metrics: readonly number[];
};

const deployment = reader<"deployment", DeploymentConfig>();
const request_metadata = reader<"request_metadata", RequestMetadata>();
const request_count = state<"request_count", number>();
const last_route = state<"last_route", string>();
const audit = writer_cell<"audit", AsArray, string>();
const metrics = writer_cell<"metrics", AsArray, number>();

type KeyedCells =
  | Uses<typeof deployment>
  | Uses<typeof request_metadata>
  | Uses<typeof request_count>
  | Uses<typeof last_route>
  | Uses<typeof audit>
  | Uses<typeof metrics>;

const KeyedCells = Program.scope<KeyedCells>();

const record_request = KeyedCells(function* () {
  const api_origin = yield* deployment.asks((config) => config.api_origin);
  const request = yield* request_metadata.ask();
  const previous_request_count = yield* request_count.get();

  yield* request_count.put(previous_request_count + 1);
  yield* last_route.put(request.path);
  yield* audit.tell(ArrayT(["request " + request.request_id]));
  yield* metrics.tell(ArrayT([1]));

  return {
    endpoint: api_origin + request.path,
    previous_request_count,
  };
});

export function run_keyed_cell_scenario(): KeyedCellScenario {
  const [
    [[[result, current_request_count], current_last_route], audit_log],
    metric_log,
  ] = Effect.interpret(record_request)
    .handle((effect) =>
      run_reader(deployment, effect, {
        api_origin: "https://api.example.test",
      })
    )
    .handle((effect) =>
      run_reader(request_metadata, effect, {
        request_id: "request-42",
        path: "/todos/42",
      })
    )
    .handle((effect) => run_state(request_count, effect, 7))
    .handle((effect) => run_state(last_route, effect, ""))
    .handle((effect) => run_writer(audit, effect, ArrayT<string>([])))
    .handle((effect) => run_writer(metrics, effect, ArrayT<number>([])))
    .run(run);

  return {
    ...result,
    request_count: current_request_count,
    last_route: current_last_route,
    audit: to_array(audit_log),
    metrics: to_array(metric_log),
  };
}

export function run_keyed_cell_examples() {
  console.log(
    "keyed Reader, State, and Writer cells",
    Deno.inspect(run_keyed_cell_scenario()),
  );
}
