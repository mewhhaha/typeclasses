import { Show } from "../../src/typeclasses.ts";
import {
  bad_request_page,
  create_message_page,
  home_page,
  not_found_page,
  render_handler,
  settings_page,
  user_json,
  user_page,
} from "./handlers.ts";
import { to_response } from "./response.ts";
import {
  boolean_query,
  integer_param,
  optional_query,
  route,
  route_all,
  route_context,
  text_query,
} from "./router.ts";

const router = route_all(
  route("GET", "/", {}, home_page),
  route(
    "GET",
    "/users/:id",
    {
      params: { id: integer_param },
      query: { tab: optional_query(text_query, "profile") },
    },
    user_page,
  ),
  route(
    "GET",
    "/api/users/:id",
    {
      params: { id: integer_param },
    },
    user_json,
  ),
  route(
    "GET",
    "/users/:id/settings",
    {
      params: { id: integer_param },
      query: { section: optional_query(text_query, "account") },
    },
    settings_page,
  ),
  route(
    "POST",
    "/users/:id/messages",
    {
      params: { id: integer_param },
      query: { dry_run: optional_query(boolean_query, false) },
    },
    create_message_page,
  ),
);

export function route_http(request: Request): Response {
  const context = route_context(request);
  const [tag, payload] = router.value().match(context);

  switch (tag) {
    case "matched":
      return to_response(payload);
    case "missed":
      return to_response(render_handler(not_found_page, context));
    case "rejected":
      return to_response(render_handler(bad_request_page, {
        rejection: payload,
      }));
  }
}

export async function run_http_router_case_study() {
  console.log("http router routes", Show.show(router));

  for (
    const request of [
      new Request("https://example.test/users/42?tab=activity"),
      new Request("https://example.test/api/users/42"),
      new Request("https://example.test/users/42/settings?section=privacy"),
      new Request("https://example.test/users/not-a-number"),
      new Request("https://example.test/users/42/messages?dry_run=true", {
        method: "POST",
      }),
      new Request("https://example.test/admin"),
    ]
  ) {
    const response = route_http(request);
    const url = new URL(request.url);

    console.log(
      "http router",
      request.method,
      url.pathname + url.search,
      response.status,
    );
    console.log("http router body", await response.text());
  }
}
