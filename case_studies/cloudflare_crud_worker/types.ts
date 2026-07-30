export type Todo = {
  readonly id: string;
  readonly title: string;
  readonly completed: boolean;
  readonly created_at: string;
  readonly updated_at: string;
};

export type TodoCreate = {
  readonly title: string;
  readonly completed: boolean;
};

export type TodoPatch = {
  readonly title?: string;
  readonly completed?: boolean;
};

export type RequestContext = {
  readonly request: Request;
  readonly request_id: string;
};

export type HttpProblem =
  | readonly ["bad_json", { readonly message: string }]
  | readonly ["bad_input", { readonly message: string }]
  | readonly ["not_found", { readonly path: string }]
  | readonly ["method_not_allowed", { readonly method: string }]
  | readonly ["storage_failed", { readonly message: string }];

export function decode_create(value: unknown): TodoCreate | HttpProblem {
  if (!is_record(value)) {
    return bad_input("expected a JSON object");
  }

  const title = value.title;

  if (typeof title !== "string") {
    return bad_input("title must be a string");
  }

  if (title.trim().length === 0) {
    return bad_input("title must not be empty");
  }

  const completed = value.completed;

  if (completed === undefined) {
    return {
      title,
      completed: false,
    };
  }

  if (typeof completed !== "boolean") {
    return bad_input("completed must be a boolean when provided");
  }

  return {
    title,
    completed,
  };
}

export function decode_patch(value: unknown): TodoPatch | HttpProblem {
  if (!is_record(value)) {
    return bad_input("expected a JSON object");
  }

  const patch: { title?: string; completed?: boolean } = {};

  if ("title" in value) {
    if (typeof value.title !== "string") {
      return bad_input("title must be a string when provided");
    }

    if (value.title.trim().length === 0) {
      return bad_input("title must not be empty");
    }

    patch.title = value.title;
  }

  if ("completed" in value) {
    if (typeof value.completed !== "boolean") {
      return bad_input("completed must be a boolean when provided");
    }

    patch.completed = value.completed;
  }

  if (patch.title === undefined && patch.completed === undefined) {
    return bad_input("expected title or completed");
  }

  return patch;
}

export function problem_status(problem: HttpProblem): number {
  const [tag] = problem;

  switch (tag) {
    case "bad_json":
    case "bad_input":
      return 400;
    case "not_found":
      return 404;
    case "method_not_allowed":
      return 405;
    case "storage_failed":
      return 500;
  }
}

export function problem_message(problem: HttpProblem): string {
  const [tag, payload] = problem;

  switch (tag) {
    case "bad_json":
    case "bad_input":
    case "storage_failed":
      return payload.message;
    case "not_found":
      return "not found: " + payload.path;
    case "method_not_allowed":
      return "method not allowed: " + payload.method;
  }
}

function bad_input(message: string): HttpProblem {
  return ["bad_input", { message }];
}

function is_record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object") {
    return false;
  }

  return value !== null;
}
