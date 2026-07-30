import { ArrayT, to_array } from "../../src/array.ts";
import { Effect } from "../../src/effects.ts";
import { run_reader } from "../../src/reader.ts";
import { run_task } from "../../src/task.ts";
import { run_writer } from "../../src/writer.ts";
import { fixed_clock, run_clock, system_clock } from "./clock.ts";
import {
  d1_database,
  type D1Database,
  database_trace_scope,
  type DatabaseRuntime,
  run_database,
} from "./database.ts";
import { crud_program } from "./program.ts";
import { router_trace_scope, run_router } from "./router.ts";
import {
  console_trace_sink,
  run_trace_scopes,
  run_trace_to_writer,
  run_trace_with_sink,
  type TraceSink,
} from "./trace.ts";
import type { RequestContext } from "./types.ts";

export type WorkerEnv = {
  readonly DB: D1Database;
};

export type RequestOptions = {
  readonly request_id?: string;
  readonly now?: string;
  readonly trace_sink?: TraceSink;
};

export type DryRunResult = {
  readonly response: Response;
  readonly trace: readonly string[];
};

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return handle_request(request, d1_database(env.DB), {
      trace_sink: console_trace_sink(),
    });
  },
};

export function handle_request(
  request: Request,
  database: DatabaseRuntime,
  options: RequestOptions = {},
): Promise<Response> {
  const context = request_context(request, options);
  const read_now = clock_from_options(options);
  let trace_sink = options.trace_sink;

  if (trace_sink === undefined) {
    trace_sink = console_trace_sink();
  }

  return Effect.interpret(crud_program)
    .handle((effect) => run_clock(effect, read_now))
    .handle((effect) => run_trace_scopes(effect, application_trace_scope))
    .handle((effect) => run_trace_with_sink(effect, trace_sink))
    .handle(run_router)
    .handle((effect) => run_reader(effect, context))
    .handle((effect) => run_database(effect, database))
    .run(run_task);
}

export async function handle_request_with_trace_log(
  request: Request,
  database: DatabaseRuntime,
  options: RequestOptions = {},
): Promise<DryRunResult> {
  const context = request_context(request, options);
  const read_now = clock_from_options(options);
  const empty_trace = ArrayT<string>([]);
  const [response, trace] = await Effect.interpret(crud_program)
    .handle((effect) => run_clock(effect, read_now))
    .handle((effect) => run_trace_scopes(effect, application_trace_scope))
    .handle(run_trace_to_writer)
    .handle(run_router)
    .handle((effect) => run_reader(effect, context))
    .handle((effect) => run_database(effect, database))
    .handle((effect) => run_writer(effect, empty_trace))
    .run(run_task);

  return {
    response,
    trace: to_array(trace),
  };
}

function application_trace_scope(operation: unknown) {
  return router_trace_scope(operation) ?? database_trace_scope(operation);
}

function request_context(
  request: Request,
  options: RequestOptions,
): RequestContext {
  let request_id = options.request_id;

  if (request_id === undefined) {
    const cf_ray = request.headers.get("cf-ray");

    if (cf_ray === null) {
      request_id = crypto.randomUUID();
    } else {
      request_id = cf_ray;
    }
  }

  return {
    request,
    request_id,
  };
}

function clock_from_options(options: RequestOptions): () => string {
  if (options.now !== undefined) {
    return fixed_clock(options.now);
  }

  return system_clock();
}
