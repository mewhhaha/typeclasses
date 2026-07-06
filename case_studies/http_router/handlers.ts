import {
  type Effect as EffectValue,
  Program,
  type Uses,
} from "../../src/effects.ts";
import { ask, type AsReader, run_reader } from "../../src/reader.ts";
import {
  emit_body,
  escape_html,
  html,
  type HttpBody,
  type HttpMetadata,
  type HttpProgram,
  json,
  page_end,
  page_start,
} from "./response.ts";
import { format_route_rejection, type RouteRejection } from "./router.ts";

export type Handler<input> = EffectValue<
  HttpBody | Uses<AsReader<input>>,
  HttpMetadata
>;

type UserPage = {
  readonly params: {
    readonly id: number;
  };
  readonly query: {
    readonly tab: string;
  };
};

type UserJson = {
  readonly params: {
    readonly id: number;
  };
};

type SettingsPage = {
  readonly params: {
    readonly id: number;
  };
  readonly query: {
    readonly section: string;
  };
};

type CreateMessagePage = {
  readonly params: {
    readonly id: number;
  };
  readonly query: {
    readonly dry_run: boolean;
  };
};

type NotFoundPage = {
  readonly method: string;
  readonly url: URL;
};

type BadRequestPage = {
  readonly rejection: RouteRejection;
};

export const home_page = Program(function* () {
  yield* page_start("Typeclasses");
  yield* emit_body("<h1>Typeclasses</h1>");
  yield* emit_body("<p>Small typed abstractions for TypeScript.</p>");
  yield* page_end();

  return html(200);
});

export const user_page = Program(function* () {
  const input = yield* ask<UserPage>();
  const id = input.params.id;
  const tab = input.query.tab;

  yield* page_start("User " + id.toString());
  yield* emit_body("<h1>User #" + id.toString() + "</h1>");
  yield* emit_body("<p>Tab: " + escape_html(tab) + "</p>");
  yield* page_end();

  return html(200);
});

export const user_json = Program(function* () {
  const input = yield* ask<UserJson>();
  const id = input.params.id;

  return yield* json({
    id,
    name: "User #" + id.toString(),
    links: {
      html: "/users/" + id.toString(),
      settings: "/users/" + id.toString() + "/settings",
    },
  });
});

export const settings_page = Program(function* () {
  const input = yield* ask<SettingsPage>();
  const id = input.params.id;
  const section = input.query.section;

  yield* page_start("Settings " + id.toString());
  yield* emit_body("<h1>Settings for user #" + id.toString() + "</h1>");
  yield* emit_body("<p>Section: " + escape_html(section) + "</p>");
  yield* page_end();

  return html(200);
});

export const create_message_page = Program(function* () {
  const input = yield* ask<CreateMessagePage>();
  const id = input.params.id;
  const dry_run = input.query.dry_run;

  yield* page_start("Create message");
  yield* emit_body("<h1>Message for user #" + id.toString() + "</h1>");

  let message = "Message accepted";
  let status = 201;

  if (dry_run) {
    message = "Preview only";
    status = 200;
  }

  yield* emit_body("<p>" + message + "</p>");
  yield* page_end();

  return html(status);
});

export const not_found_page = Program(function* () {
  const input = yield* ask<NotFoundPage>();

  yield* page_start("Not found");
  yield* emit_body("<h1>Not found</h1>");
  yield* emit_body(
    "<p>No route for " +
      escape_html(input.method + " " + input.url.pathname) +
      ".</p>",
  );
  yield* page_end();

  return html(404);
});

export const bad_request_page = Program(function* () {
  const input = yield* ask<BadRequestPage>();

  yield* page_start("Bad request");
  yield* emit_body("<h1>Bad request</h1>");
  yield* emit_body(
    "<p>" + escape_html(format_route_rejection(input.rejection)) + ".</p>",
  );
  yield* page_end();

  return html(400);
});

export function render_handler<input>(
  handler: Handler<input>,
  input: input,
): HttpProgram {
  return run_reader(handler, input);
}
