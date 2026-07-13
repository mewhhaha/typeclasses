import { Effect, Program, type Uses } from "../../src/effects.ts";
import { type EitherValue, Left, Right } from "../../src/either.ts";
import { ask, type AsReader } from "../../src/reader.ts";
import { type AsTask, from_fn } from "../../src/task.ts";
import { type Clock, now } from "./clock.ts";
import {
  create_todo,
  type Database,
  database_problem,
  type DatabaseResult,
  delete_todo,
  list_todos,
  read_todo,
  update_todo,
} from "./database.ts";
import { json_response, no_content, problem_response } from "./response.ts";
import { type Trace, trace_event } from "./trace.ts";
import {
  decode_create,
  decode_patch,
  type HttpProblem,
  parse_route,
  type RequestContext,
  type TodoCreate,
  type TodoPatch,
} from "./types.ts";

export type CrudApp =
  | Uses<AsReader<RequestContext>>
  | Uses<AsTask>
  | Database
  | Trace
  | Clock;

const CrudApp = Program.scope<CrudApp>();

export const crud_program = CrudApp(function* () {
  const context = yield* ask<RequestContext>();
  const request = context.request;
  const url = new URL(request.url);

  yield* trace_event("http.request.start", {
    request_id: context.request_id,
    method: request.method,
    path: url.pathname,
  });

  const response = yield* route_request(context);

  yield* trace_event("http.request.finish", {
    request_id: context.request_id,
    method: request.method,
    path: url.pathname,
    status: response.status,
  });

  return response;
});

function route_request(context: RequestContext) {
  return CrudApp(function* () {
    const request = context.request;
    const [tag, payload] = parse_route(request);

    switch (tag) {
      case "list":
        return yield* list_response(context);
      case "create":
        return yield* create_response(context);
      case "read":
        return yield* read_response(context, payload.id);
      case "update":
        return yield* update_response(context, payload.id);
      case "delete":
        return yield* delete_response(context, payload.id);
      case "missing":
        return problem_response(["not_found", { path: payload.path }]);
      case "method_not_allowed":
        return problem_response([
          "method_not_allowed",
          { method: payload.method },
        ]);
    }
  });
}

function list_response(context: RequestContext) {
  return CrudApp(function* () {
    yield* trace_event("todo.list", {
      request_id: context.request_id,
    });

    const result = yield* list_todos();

    return database_response(result, (todos) => {
      return json_response({ todos });
    });
  });
}

function create_response(context: RequestContext) {
  return CrudApp(function* () {
    const input = yield* read_create_body(context.request);
    const input_value = input.value();

    if (Left.is(input_value)) {
      return problem_response(input_value[1]);
    }

    const input_payload = input_value[1];
    const timestamp = yield* now();

    yield* trace_event("todo.create", {
      request_id: context.request_id,
      title: input_payload.title,
    });

    const result = yield* create_todo(input_payload, timestamp);

    return database_response(result, (todo) => {
      return json_response({ todo }, 201);
    });
  });
}

function read_response(context: RequestContext, id: string) {
  return CrudApp(function* () {
    yield* trace_event("todo.read", {
      request_id: context.request_id,
      todo_id: id,
    });

    const result = yield* read_todo(id);

    return database_response(result, (todo) => {
      return json_response({ todo });
    });
  });
}

function update_response(context: RequestContext, id: string) {
  return CrudApp(function* () {
    const input = yield* read_patch_body(context.request);
    const input_value = input.value();

    if (Left.is(input_value)) {
      return problem_response(input_value[1]);
    }

    const input_payload = input_value[1];
    const timestamp = yield* now();

    yield* trace_event("todo.update", {
      request_id: context.request_id,
      todo_id: id,
    });

    const result = yield* update_todo(id, input_payload, timestamp);

    return database_response(result, (todo) => {
      return json_response({ todo });
    });
  });
}

function delete_response(context: RequestContext, id: string) {
  return CrudApp(function* () {
    yield* trace_event("todo.delete", {
      request_id: context.request_id,
      todo_id: id,
    });

    const result = yield* delete_todo(id);

    return database_response(result, () => no_content());
  });
}

function read_create_body(
  request: Request,
): Effect<Uses<AsTask>, EitherValue<HttpProblem, TodoCreate>> {
  return Effect.lift(
    from_fn(async () => {
      const parsed = await read_json(request);
      const parsed_value = parsed.value();

      if (Left.is(parsed_value)) {
        return parsed as EitherValue<HttpProblem, TodoCreate>;
      }

      const decoded = decode_create(parsed_value[1]);

      if (is_problem(decoded)) {
        return Left<HttpProblem, TodoCreate>(decoded);
      }

      return Right(decoded) as EitherValue<HttpProblem, TodoCreate>;
    }),
  );
}

function read_patch_body(
  request: Request,
): Effect<Uses<AsTask>, EitherValue<HttpProblem, TodoPatch>> {
  return Effect.lift(
    from_fn(async () => {
      const parsed = await read_json(request);
      const parsed_value = parsed.value();

      if (Left.is(parsed_value)) {
        return parsed as EitherValue<HttpProblem, TodoPatch>;
      }

      const decoded = decode_patch(parsed_value[1]);

      if (is_problem(decoded)) {
        return Left<HttpProblem, TodoPatch>(decoded);
      }

      return Right(decoded) as EitherValue<HttpProblem, TodoPatch>;
    }),
  );
}

async function read_json(
  request: Request,
): Promise<EitherValue<HttpProblem, unknown>> {
  try {
    return Right(await request.json()) as EitherValue<HttpProblem, unknown>;
  } catch (error) {
    return Left<HttpProblem, unknown>([
      "bad_json",
      { message: json_error_message(error) },
    ]);
  }
}

function database_response<item>(
  result: DatabaseResult<item>,
  respond: (item: item) => Response,
): Response {
  const result_value = result.value();

  if (Left.is(result_value)) {
    return problem_response(database_problem(result_value[1]));
  }

  return respond(result_value[1]);
}

function is_problem<item>(
  value: item | HttpProblem,
): value is HttpProblem {
  return Array.isArray(value);
}

function json_error_message(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
