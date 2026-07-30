import { assert_equals } from "../../src/assert.ts";
import { Effect, run } from "../../src/effects.ts";
import { run_reader } from "../../src/reader.ts";
import { parse_route, run_router } from "./router.ts";

const base = "https://worker.example.test";

Deno.test("Router returns the matched URL pattern and decoded parameters", () => {
  assert_equals(
    route(new Request(base + "/todos/seed")),
    ["/todos/:id", { method: "GET", id: "seed" }],
  );
});

Deno.test("Router reports an unsupported method", () => {
  assert_equals(
    route(new Request(base + "/todos", { method: "DELETE" })),
    ["method_not_allowed", { method: "DELETE" }],
  );
});

Deno.test("Router reports a path outside its routes", () => {
  assert_equals(
    route(new Request(base + "/projects")),
    ["missing", { path: "/projects" }],
  );
});

function route(request: Request) {
  return Effect.interpret(parse_route())
    .handle(run_router)
    .handle((effect) =>
      run_reader(effect, {
        request,
        request_id: "router-test",
      })
    )
    .run(run);
}
