import { assert_equals, assert_true } from "../../src/assert.ts";
import { memory_database } from "./database.ts";
import { handle_request_with_trace_log } from "./worker.ts";

const base = "https://worker.example.test";

Deno.test("Cloudflare CRUD worker automatically traces routing and database scopes", async () => {
  const database = memory_database([
    {
      id: "seed",
      title: "ship tracing",
      completed: false,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  ]);
  const result = await handle_request_with_trace_log(
    new Request(base + "/todos/seed"),
    database,
    {
      request_id: "test-request",
      now: "2026-01-01T00:00:00.000Z",
    },
  );

  assert_equals(result.response.status, 200);
  assert_true(
    result.trace.includes(
      "trace http.route.finish route=/todos/:id",
    ),
    "route scope records the matched URL pattern",
  );
  assert_true(
    result.trace.includes(
      "trace crud.database.read.start todo_id=seed",
    ),
    "database read scope starts automatically",
  );
  assert_true(
    result.trace.includes(
      "trace crud.database.read.finish result=ok",
    ),
    "database read scope finishes automatically",
  );
  assert_equals(result.trace, [
    "trace http.request.start request_id=test-request method=GET path=/todos/seed",
    "trace http.route.start",
    "trace http.route.finish route=/todos/:id",
    "trace todo.read request_id=test-request todo_id=seed",
    "trace crud.database.read.start todo_id=seed",
    "trace crud.database.read.finish result=ok",
    "trace http.request.finish request_id=test-request method=GET path=/todos/seed status=200",
  ]);
});
