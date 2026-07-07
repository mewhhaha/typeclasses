import {
  Effect,
  type Operation,
  type TaggedOperation,
  type Uses,
} from "../../src/effects.ts";
import { type EitherValue, left, right } from "../../src/either.ts";
import { type AsTask, from_fn } from "../../src/task.ts";
import type { TraceAttributes, TraceScope } from "./trace.ts";
import type { HttpProblem, Todo, TodoCreate, TodoPatch } from "./types.ts";

export type DatabaseError =
  | readonly ["todo_not_found", { readonly id: string }]
  | readonly ["storage_failed", { readonly message: string }];

export type DatabaseResult<item> = EitherValue<DatabaseError, item>;

export type ListTodos =
  & Operation<DatabaseResult<readonly Todo[]>>
  & readonly ["crud.database.list"];

export type CreateTodo =
  & Operation<DatabaseResult<Todo>>
  & readonly [
    "crud.database.create",
    {
      readonly input: TodoCreate;
      readonly now: string;
    },
  ];

export type ReadTodo =
  & Operation<DatabaseResult<Todo>>
  & readonly ["crud.database.read", { readonly id: string }];

export type UpdateTodo =
  & Operation<DatabaseResult<Todo>>
  & readonly [
    "crud.database.update",
    {
      readonly id: string;
      readonly patch: TodoPatch;
      readonly now: string;
    },
  ];

export type DeleteTodo =
  & Operation<DatabaseResult<Todo>>
  & readonly ["crud.database.delete", { readonly id: string }];

export type Database =
  | ListTodos
  | CreateTodo
  | ReadTodo
  | UpdateTodo
  | DeleteTodo;

export type DatabaseRuntime = {
  list(): Promise<DatabaseResult<readonly Todo[]>>;
  create(input: TodoCreate, now: string): Promise<DatabaseResult<Todo>>;
  read(id: string): Promise<DatabaseResult<Todo>>;
  update(
    id: string,
    patch: TodoPatch,
    now: string,
  ): Promise<DatabaseResult<Todo>>;
  delete(id: string): Promise<DatabaseResult<Todo>>;
};

export type D1Database = {
  prepare(query: string): D1PreparedStatement;
};

export type D1PreparedStatement = {
  bind(...values: readonly unknown[]): D1PreparedStatement;
  first<row extends object>(): Promise<row | null>;
  all<row extends object>(): Promise<{ readonly results: readonly row[] }>;
  run(): Promise<unknown>;
};

type WithoutDatabase<requirements> = requirements extends Database ? never
  : requirements;

type TodoRow = {
  readonly id: string;
  readonly title: string;
  readonly completed: number;
  readonly created_at: string;
  readonly updated_at: string;
};

export function list_todos(): Effect<
  ListTodos,
  DatabaseResult<readonly Todo[]>
> {
  return Effect.send(["crud.database.list"] as ListTodos);
}

export function create_todo(
  input: TodoCreate,
  now: string,
): Effect<CreateTodo, DatabaseResult<Todo>> {
  return Effect.send([
    "crud.database.create",
    { input, now },
  ] as CreateTodo);
}

export function read_todo(
  id: string,
): Effect<ReadTodo, DatabaseResult<Todo>> {
  return Effect.send(["crud.database.read", { id }] as ReadTodo);
}

export function update_todo(
  id: string,
  patch: TodoPatch,
  now: string,
): Effect<UpdateTodo, DatabaseResult<Todo>> {
  return Effect.send([
    "crud.database.update",
    { id, patch, now },
  ] as UpdateTodo);
}

export function delete_todo(
  id: string,
): Effect<DeleteTodo, DatabaseResult<Todo>> {
  return Effect.send(["crud.database.delete", { id }] as DeleteTodo);
}

export function database_trace_scope(
  operation: unknown,
): TraceScope | undefined {
  const tagged = operation as TaggedOperation;

  switch (tagged[0]) {
    case "crud.database.list":
      return database_scope("crud.database.list");
    case "crud.database.create":
      return database_scope("crud.database.create");
    case "crud.database.read": {
      const [, read] = operation as ReadTodo;

      return database_scope("crud.database.read", { todo_id: read.id });
    }
    case "crud.database.update": {
      const [, update] = operation as UpdateTodo;

      return database_scope("crud.database.update", { todo_id: update.id });
    }
    case "crud.database.delete": {
      const [, remove] = operation as DeleteTodo;

      return database_scope("crud.database.delete", { todo_id: remove.id });
    }
    default:
      return undefined;
  }
}

export function run_database<requirements, item>(
  effect: Effect<requirements, item>,
  runtime: DatabaseRuntime,
): Effect<WithoutDatabase<requirements> | Uses<AsTask>, item> {
  if (effect[0] === "pure") {
    return Effect.pure(effect[1]);
  }

  const operation = effect[1] as TaggedOperation;

  switch (operation[0]) {
    case "crud.database.list":
      return Effect.bind(
        Effect.lift(from_fn(() => runtime.list())),
        (result) => run_database(effect[2](result), runtime),
      );
    case "crud.database.create": {
      const [, create] = effect[1] as CreateTodo;

      return Effect.bind(
        Effect.lift(from_fn(() => runtime.create(create.input, create.now))),
        (result) => run_database(effect[2](result), runtime),
      );
    }
    case "crud.database.read": {
      const [, read] = effect[1] as ReadTodo;

      return Effect.bind(
        Effect.lift(from_fn(() => runtime.read(read.id))),
        (result) => run_database(effect[2](result), runtime),
      );
    }
    case "crud.database.update": {
      const [, update] = effect[1] as UpdateTodo;

      return Effect.bind(
        Effect.lift(
          from_fn(() => runtime.update(update.id, update.patch, update.now)),
        ),
        (result) => run_database(effect[2](result), runtime),
      );
    }
    case "crud.database.delete": {
      const [, remove] = effect[1] as DeleteTodo;

      return Effect.bind(
        Effect.lift(from_fn(() => runtime.delete(remove.id))),
        (result) => run_database(effect[2](result), runtime),
      );
    }
  }

  return Effect.suspend(
    effect[1] as WithoutDatabase<requirements>,
    (value) => run_database(effect[2](value), runtime),
  );
}

export function memory_database(
  seed: readonly Todo[] = [],
): DatabaseRuntime & { readonly todos: Map<string, Todo> } {
  const todos = new Map(seed.map((todo) => [todo.id, todo] as const));
  let next_id = seed.length + 1;

  return {
    todos,

    list() {
      return Promise.resolve(database_ok([...todos.values()]));
    },

    create(input, now) {
      const id = next_id.toString();
      next_id += 1;
      const todo = {
        id,
        title: input.title,
        completed: input.completed,
        created_at: now,
        updated_at: now,
      };

      todos.set(id, todo);
      return Promise.resolve(database_ok(todo));
    },

    read(id) {
      const todo = todos.get(id);

      if (todo === undefined) {
        return Promise.resolve(database_err(["todo_not_found", { id }]));
      }

      return Promise.resolve(database_ok(todo));
    },

    update(id, patch, now) {
      const todo = todos.get(id);

      if (todo === undefined) {
        return Promise.resolve(database_err(["todo_not_found", { id }]));
      }

      const updated = {
        ...todo,
        ...patch,
        updated_at: now,
      };

      todos.set(id, updated);
      return Promise.resolve(database_ok(updated));
    },

    delete(id) {
      const todo = todos.get(id);

      if (todo === undefined) {
        return Promise.resolve(database_err(["todo_not_found", { id }]));
      }

      todos.delete(id);
      return Promise.resolve(database_ok(todo));
    },
  };
}

export function d1_database(database: D1Database): DatabaseRuntime {
  return {
    async list() {
      try {
        const rows = await database
          .prepare(
            "select id, title, completed, created_at, updated_at from todos order by created_at asc",
          )
          .all<TodoRow>();

        return database_ok(rows.results.map(todo_from_row));
      } catch (error) {
        return database_err(storage_failed(error));
      }
    },

    async create(input, now) {
      const id = crypto.randomUUID();

      try {
        await database
          .prepare(
            "insert into todos (id, title, completed, created_at, updated_at) values (?, ?, ?, ?, ?)",
          )
          .bind(id, input.title, input.completed ? 1 : 0, now, now)
          .run();

        return database_ok({
          id,
          title: input.title,
          completed: input.completed,
          created_at: now,
          updated_at: now,
        });
      } catch (error) {
        return database_err(storage_failed(error));
      }
    },

    async read(id) {
      try {
        const row = await database
          .prepare(
            "select id, title, completed, created_at, updated_at from todos where id = ?",
          )
          .bind(id)
          .first<TodoRow>();

        if (row === null) {
          return database_err(["todo_not_found", { id }]);
        }

        return database_ok(todo_from_row(row));
      } catch (error) {
        return database_err(storage_failed(error));
      }
    },

    async update(id, patch, now) {
      const existing = await this.read(id);
      const [tag, payload] = existing.value();

      switch (tag) {
        case "Left":
          return existing;
        case "Right":
          break;
      }

      const updated = {
        ...payload,
        ...patch,
        updated_at: now,
      };

      try {
        await database
          .prepare(
            "update todos set title = ?, completed = ?, updated_at = ? where id = ?",
          )
          .bind(updated.title, updated.completed ? 1 : 0, now, id)
          .run();

        return database_ok(updated);
      } catch (error) {
        return database_err(storage_failed(error));
      }
    },

    async delete(id) {
      const existing = await this.read(id);
      const [tag, payload] = existing.value();

      switch (tag) {
        case "Left":
          return existing;
        case "Right":
          break;
      }

      try {
        await database
          .prepare("delete from todos where id = ?")
          .bind(id)
          .run();

        return database_ok(payload);
      } catch (error) {
        return database_err(storage_failed(error));
      }
    },
  };
}

export function database_problem(error: DatabaseError): HttpProblem {
  const [tag, payload] = error;

  switch (tag) {
    case "todo_not_found":
      return ["not_found", { path: "/todos/" + payload.id }];
    case "storage_failed":
      return ["storage_failed", { message: payload.message }];
  }
}

export function database_ok<item>(value: item): DatabaseResult<item> {
  return right(value) as DatabaseResult<item>;
}

export function database_err<item = never>(
  error: DatabaseError,
): DatabaseResult<item> {
  return left<DatabaseError, item>(error);
}

function todo_from_row(row: TodoRow): Todo {
  return {
    id: row.id,
    title: row.title,
    completed: row.completed !== 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function storage_failed(error: unknown): DatabaseError {
  if (error instanceof Error) {
    return ["storage_failed", { message: error.message }];
  }

  return ["storage_failed", { message: String(error) }];
}

function database_scope(
  name: string,
  attributes: TraceAttributes = {},
): TraceScope {
  return {
    name,
    attributes,
    finish_attributes: database_result_trace_attributes,
  };
}

function database_result_trace_attributes(value: unknown): TraceAttributes {
  const result = value as DatabaseResult<unknown>;
  const [tag, payload] = result.value();

  switch (tag) {
    case "Right":
      return { result: "ok" };
    case "Left": {
      const [error] = payload;

      return {
        result: "error",
        error,
      };
    }
  }
}
