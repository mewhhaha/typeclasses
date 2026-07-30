# Typeclasses library guidance

This repository contains the source, tests, examples, and documentation for
`@mewhhaha/typeclasses`, a small Haskell-style typeclass library for TypeScript
and Deno.

When writing code with this library, treat this file, `README.md`, and the
source under `src/` as the source of truth. Use the focused programs under
`examples/`, the larger applications under `case_studies/`, and the tests next
to the source as executable references. Do not infer an API from Effect, fp-ts,
or another functional library: similar concepts often have different runtime
representations and composition rules here.

Examples in this file contain comments to explain the pattern. Production code
should keep only comments that explain a constraint or non-obvious reason.

## Choose the smallest context

Start from the behavior the code needs:

| Need                                                                | Use                               |
| ------------------------------------------------------------------- | --------------------------------- |
| A value may be absent                                               | `Maybe`                           |
| A sequential computation may fail with an expected error            | `Either`                          |
| Independent inputs must collect every error                         | `Validation`                      |
| Deferred asynchronous work                                          | `Task`                            |
| Several dependent steps in the same context                         | `Do`                              |
| A program needs Reader, State, Writer, Task, or custom capabilities | `Program` and `Effect`            |
| An effect program can stop with a typed error                       | `Fails`, `fail`, and `run_except` |
| A synchronous transaction must commit or roll back as one unit      | `Stm`                             |
| One algorithm should work over several containers                   | A typeclass constraint and `Data` |

Do not introduce `Program` for a calculation that is already expressed by one
`Either`, `Task`, or `Reader`. Do not return `Either<error, item | undefined>`
when `Left` and `Right` already represent the two outcomes. Keep illegal or
ambiguous combinations out of the type.

This library is not Effect. It does not provide fibers, scheduling, a service
container, or structured concurrency. Use the abstractions that exist here
rather than generating Effect APIs with similar names.

## Imports

Applications can use the root entry point:

```ts
import { Applicative, Do, Left, Maybe, Right } from "@mewhhaha/typeclasses";
```

Prefer a stable focused entry point when a module has a clear domain:

```ts
import { Left, Right } from "@mewhhaha/typeclasses/either";
import { from_fn, run_task } from "@mewhhaha/typeclasses/task";
import { Effect, Program } from "@mewhhaha/typeclasses/effects";
import { fail, run_except } from "@mewhhaha/typeclasses/except";
```

Use the same import style as the surrounding application. Do not import internal
files, symbols marked `@ignore`, or implementation details from this repository.

## Wrapped values and dictionaries

Each context has a callable dictionary such as `Maybe`, `Either`, `Task`, or
`ArrayT`. Calling it wraps the context's raw representation and attaches the
available typeclass methods.

Construct new values with the public constructors:

```ts
import { Just, Left, Nothing, Right } from "@mewhhaha/typeclasses";

const present = Just(42);
const absent = Nothing<number>();
const success = Right<string, number>(42);
const failure = Left<string, number>("missing port");
```

Use `.value()` only when raw data is needed at a boundary, for matching, or in
an assertion:

```ts
const result = Right("42").map((text) => Number.parseInt(text, 10));

result.value(); // ["Right", 42]
```

The raw algebraic data types are tagged tuples. Deconstruct and switch on the
tag when both branches need substantive handling:

```ts
import { type EitherValue } from "@mewhhaha/typeclasses/either";

function to_response(
  result: EitherValue<{ readonly message: string }, number>,
): Response {
  const [tag, payload] = result.value();

  switch (tag) {
    case "Left":
      return Response.json(payload, { status: 400 });
    case "Right":
      return Response.json({ value: payload });
  }
}
```

Use `Left.is`, `Right.is`, `Nothing.is`, `Just.is`, `Invalid.is`, or `Valid.is`
when only one branch needs special handling. These guards operate on the raw
value returned by `.value()`.

## Pick a calling style deliberately

For a concrete value, prefer the fluent methods carried by that value:

```ts
const parsed = Right("42")
  .bind((text) => from_number(Number.parseInt(text, 10)))
  .map((port) => port + 1);
```

For generic code, state the capability in the type and call the exported
typeclass operation:

```ts
import { type Data, Foldable, Functor } from "@mewhhaha/typeclasses";

function label<dictionary extends Functor<dictionary>>(
  value: Data<dictionary, number>,
): Data<dictionary, string> {
  return Functor.map(value, (number) => `value:${number}`);
}

function total<dictionary extends Foldable<dictionary>>(
  values: Data<dictionary, number>,
): number {
  return Foldable.fold(values, 0, (sum, value) => sum + value);
}
```

Use `@mewhhaha/typeclasses/prelude` when the surrounding code is intentionally
function-first or mirrors Haskell. Do not mix fluent, typeclass, and prelude
spellings arbitrarily within one short pipeline.

## Independent values: use Applicative

Use `Applicative.lift` when all inputs can be produced independently. This
states both the data dependency and the execution behavior.

```ts
const profile = Applicative.lift(
  (name, email) => ({ name, email }),
  read_name(input),
  read_email(input),
);
```

For `Task`, independent applicative inputs start together:

```ts
import { Applicative } from "@mewhhaha/typeclasses/typeclasses";
import { from_fn } from "@mewhhaha/typeclasses/task";

const dashboard = Applicative.lift(
  (account, alerts) => ({ account, alerts }),
  from_fn(() => load_account(account_id)),
  from_fn(() => count_alerts(account_id)),
);

const value = await dashboard.run();
```

Do not rewrite independent tasks as sequential `yield*` statements. Conversely,
do not use `Applicative.lift` when a later operation needs an earlier result.

## Dependent values: use bind or Do

`Do` is generator notation for repeated monadic `.bind(...)`. It is useful
whenever a later contextual value depends on a value produced earlier—not only
for asynchronous work.

Use `.bind(...)` when there is one short dependent step:

```ts
const port = read_port(input)
  .bind(require_available_port);
```

Use `Do(function* () { ... })` when:

- Two or more intermediate values need names.
- A later lookup, parse, request, or state change depends on an earlier value.
- Nested `.bind(...)` callbacks push the main result several indentation levels
  to the right.
- Reader, State, Writer, STM, parser, or Task operations should read in
  execution order.
- A multi-shot context such as `List` should express nested choices.

The generator yields wrapped contextual values and receives their unwrapped
items. The final `return` supplies the successful item, which `Do` puts back
into the same context.

### Maybe: stop when any step is absent

Use `Do` to flatten a chain of optional dependent lookups:

```ts
import {
  from_nullable,
  Just,
  type MaybeValue,
  Nothing,
} from "@mewhhaha/typeclasses/maybe";
import { Do } from "@mewhhaha/typeclasses/typeclasses";

function parse_positive_integer(text: string): MaybeValue<number> {
  const value = Number(text);

  if (Number.isInteger(value) && value > 0) {
    return Just(value);
  }

  return Nothing<number>();
}

function read_endpoint(input: Partial<Record<string, string>>) {
  return Do(function* () {
    const host = yield* from_nullable(input.host);
    const port_text = yield* from_nullable(input.port);
    const port = yield* parse_positive_integer(port_text);

    return { host, port };
  });
}

read_endpoint({ host: "localhost", port: "8080" }).value();
// ["Just", { host: "localhost", port: 8080 }]

read_endpoint({ host: "localhost" }).value();
// ["Nothing"]
```

The first `Nothing` stops the remaining steps. Use `Either` instead when the
caller needs to know which lookup or parse failed.

### Either: keep a readable typed-failure pipeline

`Do` keeps sequential parsing and domain checks at one indentation level:

```ts
function decode_account(input: unknown) {
  return Do(function* () {
    const record = yield* read_object(input, "account");
    const id_text = yield* read_string_field(record, "id");
    const id = yield* parse_account_id(id_text);
    const account = yield* find_account(id);

    return account;
  });
}
```

The first `Left` becomes the result and later statements do not run. All yields
must use the same fixed left type. Give `Do` an explicit dictionary when that
type cannot be inferred or the block has no yields:

```ts
const AccountResult = Either.with_left<AccountError>();

const empty_account = Do(AccountResult, function* () {
  return { id: "anonymous" };
});
```

For `Either` and `Task`, whose dictionaries implement `MonadError`, a
`try`/`catch` inside `Do` can recover from a yielded failure:

```ts
const recovered = Do(AccountResult, function* () {
  try {
    return yield* find_account("primary");
  } catch (error) {
    return yield* recover_account(error);
  }
});
```

Use this only when recovery is clearer as local control flow. Use
`MonadError.catch_error(...)` when recovery is one combinator around an existing
value.

### List: express dependent combinations

For a list-like monad, every yielded item creates a branch. Later yields run for
each earlier choice, like nested loops:

```ts
import { from_array, to_array } from "@mewhhaha/typeclasses/list";
import { Do } from "@mewhhaha/typeclasses/typeclasses";

const sums = Do(function* () {
  const left = yield* from_array([1, 2]);
  const right = yield* from_array([10, 20]);

  return left + right;
});

to_array(sums); // [11, 21, 12, 22]
```

The same block corresponds to:

```ts
const sums = from_array([1, 2])
  .bind((left) =>
    from_array([10, 20])
      .map((right) => left + right)
  );
```

`Do` may replay the generator body to produce additional list branches. Keep
ordinary side effects—mutation, logging, network calls, and eager promises—out
of a `List` `Do` block because they may execute once per replayed path.
Represent effects in an appropriate context or perform them after the list
result is constructed.

Use applicative composition instead when the choices are structurally
independent and no later choice uses an earlier item. Use `Do` when a later list
is calculated from an earlier choice:

```ts
const coordinates = Do(function* () {
  const row = yield* from_array([1, 2, 3]);
  const column = yield* from_array(columns_for_row(row));

  return { row, column };
});
```

### Task: sequence dependent asynchronous work

Task `Do` is the closest equivalent to dependent `await` statements while
preserving deferred execution:

```ts
import { from_fn } from "@mewhhaha/typeclasses/task";

const profile = Do(function* () {
  const account = yield* from_fn(() => load_account(account_id));
  const team = yield* from_fn(() => load_team(account.team_id));

  return { account, team };
});

const value = await profile.run();
```

Construction does not start either task. The team request starts only after the
account request succeeds. If both requests are independent, use
`Applicative.lift` so they start together.

### Reader, State, Writer, STM, and parsers

`Do` is often the clearest spelling when several operations in one context form
a small imperative-looking workflow:

```ts
const counter = Do(function* () {
  const before = yield* get<number>();

  yield* modify((value: number) => value + 1);

  const after = yield* get<number>();

  return { before, after };
});
```

The meaning still comes from the context:

- Reader runs every step against the same environment.
- State passes the updated state to each later step.
- Writer combines output while returning the final item.
- STM stages reads and writes in one transaction.
- A parser threads the unconsumed input and stops when parsing fails.

Use plain `Do` only when every yield belongs to one monadic dictionary. Use
`Program` when a workflow mixes capabilities such as Reader, Task, Writer,
custom database operations, and typed failure:

| Workflow                                                       | Use                |
| -------------------------------------------------------------- | ------------------ |
| Several dependent `Maybe` values                               | `Do`               |
| Sequential `Either` parsing and validation                     | `Do`               |
| Dependent list choices or Cartesian combinations               | `Do`               |
| Several Reader, State, Writer, Task, STM, or parser operations | `Do`               |
| Independent values or tasks                                    | `Applicative.lift` |
| Independent validation that must collect all failures          | `Validation`       |
| Mixed effect capabilities with separate handlers               | `Program`          |

Do not yield plain values or raw promises; yield wrapped values such as `Just`,
`Right`, `from_array(...)`, or `from_fn(...)`. Do not use `Do` merely to avoid a
single `.map(...)`.

`Do` infers its dictionary from the first yield. Pass the dictionary explicitly
for a yield-free block or whenever a fixed context parameter needs an
unambiguous witness.

## Errors are values at expected failure boundaries

Model failures that callers are expected to inspect, report, recover from, or
test as values. Prefer tagged domain errors over bare strings once callers need
to distinguish cases:

```ts
type PortError =
  | readonly ["missing-port", { readonly field: string }]
  | readonly ["invalid-port", {
    readonly field: string;
    readonly input: string;
  }];

function read_port(input: Partial<Record<string, string>>) {
  const text = input.port;

  if (text === undefined) {
    return Left<PortError, number>([
      "missing-port",
      { field: "port" },
    ]);
  }

  const port = Number(text);

  if (!Number.isInteger(port) || port <= 0) {
    return Left<PortError, number>([
      "invalid-port",
      { field: "port", input: text },
    ]);
  }

  return Right<PortError, number>(port);
}
```

The payload should carry the values needed to explain the failure. Convert the
domain error to a message or protocol response at the application's outer
boundary, not where the error is created.

Use exceptions for violated invariants, programmer errors, or failures that the
current layer cannot meaningfully handle. Never catch an exception merely to
discard it or convert every unknown cause into an uninformative string.

### Absence: Maybe

Use `Maybe` when absence is the only information the caller needs:

```ts
import { from_nullable } from "@mewhhaha/typeclasses/maybe";

const selected = from_nullable(document.querySelector("[data-submit]"));
```

Convert `Maybe` to `Either` when absence becomes a domain error:

```ts
import { to_either } from "@mewhhaha/typeclasses/maybe";

const account = to_either(
  ["account-not-found", account_id] as const,
  find_account(account_id),
);
```

Do not use `Nothing` when the reason for absence is important.

### Sequential failure: Either

Use `Either<error, item>` for parsing and dependent domain steps that stop at
the first failure:

```ts
const decoded = Do(function* () {
  const root = yield* read_object(input);
  const port_text = yield* read_field(root, "port");
  const port = yield* parse_port(port_text);

  return { port };
});
```

Use `.map(...)` to transform a success, `.bind(...)` to run a dependent step,
`Bifunctor.bimap(...)` when both branches change, and
`MonadError.catch_error(...)` for an explicit recovery.

Do not use an `Either` applicative when the requirement is to collect every
independent error: `Either` short-circuits.

### Independent failures: Validation

Use `Validation` for forms, configuration, command input, or any other set of
independent checks where the caller benefits from seeing every problem at once.

```ts
import { Invalid, Validation } from "@mewhhaha/typeclasses/validation";
import { Applicative } from "@mewhhaha/typeclasses/typeclasses";

const Problems = Validation.with_semigroup<readonly string[]>({
  concat: (left, right) => [...left, ...right],
});

function required(field: string, value: string) {
  const normalized = value.trim();

  if (normalized === "") {
    return Problems.Invalid<string>([`${field} is required`]);
  }

  return Problems.Valid(normalized);
}

const checked = Applicative.lift(
  (name, email) => ({ name, email }),
  required("name", input.name),
  required("email", input.email),
);

const result = checked.value();

if (Invalid.is(result)) {
  return { status: "rejected" as const, messages: result[1] };
}

return { status: "accepted" as const, profile: result[1] };
```

Configure a custom error semigroup once with `Validation.with_semigroup`.
`InvalidMessages(...)` is the convenience constructor for a non-empty
`readonly string[]`. Use `map_error` only with an explicit semigroup for the
destination error type.

If checks become dependent, finish the independent validation first, then cross
into `Either`, `Task`, or an effect program for the dependent workflow.

### Typed failure in effect programs

Use `Fails<error>` when a `Program` must stop early while keeping its failure in
the requirement type:

```ts
import { Effect, Program, type Uses } from "@mewhhaha/typeclasses/effects";
import {
  attempt,
  fail,
  type Fails,
  run_except,
} from "@mewhhaha/typeclasses/except";
import { ask, type AsReader, run_reader } from "@mewhhaha/typeclasses/reader";
import { type AsTask, run_task } from "@mewhhaha/typeclasses/task";

type Config = { readonly port: number };
type PortError = readonly ["invalid-port", number];
type App = Uses<AsReader<Config>> | Uses<AsTask> | Fails<PortError>;

const App = Program.scope<App>();

const load_port = App(function* () {
  const config = yield* ask<Config>();

  if (config.port <= 0) {
    yield* fail<PortError>(["invalid-port", config.port]);
  }

  return config.port;
});

const handled = run_except(load_port);
const result = await run_task(run_reader(handled, { port: 8080 }));
```

`run_except` removes all `Fails` requirements and returns the outcome as an
`Either`. Use `from_either` to bring an existing `Either` into the failure
channel and `recover` to replace a failure with another program.

Promise rejection is untyped. Use `attempt` when a rejected promise must enter
the program's typed failure channel:

```ts
type AccountError = readonly [
  "account-request-failed",
  { readonly account_id: string; readonly cause: unknown },
];

const AccountApp = Program.scope<Uses<AsTask> | Fails<AccountError>>();

const load_account = (account_id: string) =>
  AccountApp(function* () {
    return yield* attempt(
      (signal) => fetch_account(account_id, signal),
      (cause): AccountError => [
        "account-request-failed",
        { account_id, cause },
      ],
    );
  });
```

Preserve the original `cause` when it helps diagnosis. Use
`Effect.ensuring(effect, finalize)` for cleanup that must run after typed
failure. A `try`/`finally` inside a generator is not a substitute because `fail`
abandons the generator continuation.

## Deferred asynchronous work

Construct deferred work with `from_fn`:

```ts
const account = from_fn((signal) => {
  return fetch_account(account_id, signal);
});
```

The callback does not run until `.run()` or a terminal effect runner executes
the task. Prefer `from_fn` to `from_promise`; the latter adopts a promise that
has already started.

Keep `.map(...)` and `Applicative.lift(...)` callbacks synchronous. Use
`.bind(...)`, `Do`, or another `from_fn(...)` for dependent asynchronous work. A
`Task` item cannot itself be `PromiseLike`.

Pass an `AbortSignal` through to APIs that support cancellation. Aborting a task
created with `from_promise` stops waiting but cannot undo the already started
operation.

## Programs and capabilities

Use `Program.scope<requirements>()` to state every capability a program may
yield. Capabilities form a union rather than a nested transformer stack:

```ts
type App =
  | Uses<AsReader<Config>>
  | Uses<AsWriter<AsArray, string>>
  | Uses<AsTask>
  | Fails<AppError>;

const App = Program.scope<App>();
```

Inside the program, yield operations and keep business decisions independent of
their handlers. At the application boundary, handle each capability and finish
with a terminal runner:

```ts
const result = await Effect.interpret(run_except(program))
  .handle((effect) => run_reader(effect, config))
  .handle((effect) => run_writer(effect, array.ArrayT<string>([])))
  .run(run_task);
```

Handler order can change the resulting shape and semantics. Follow a neighboring
program or make the desired result type explicit rather than rearranging
handlers until the compiler accepts the expression.

Use:

- `Reader` for immutable dependencies or configuration.
- `State` for explicit state threaded through a computation.
- `Writer` for accumulated output such as audit entries.
- `Task` for deferred asynchronous work.
- `Fails` for typed short-circuiting.
- A custom tagged operation when none of those capabilities represents the
  domain operation honestly.

Keep effects at boundaries and ordinary pure functions in the middle. A pure
calculation does not become clearer merely because it can be yielded.

## Several Reader, State, or Writer values

The anonymous `ask`, `get`, and `tell` operations each address one capability.
When a program has several genuinely independent environments, state slots, or
logs, create a keyed cell for each:

```ts
import { ArrayT, type AsArray } from "@mewhhaha/typeclasses/array";
import { Effect, Program, run, type Uses } from "@mewhhaha/typeclasses/effects";
import { reader, run_reader } from "@mewhhaha/typeclasses/reader";
import { run_state, state } from "@mewhhaha/typeclasses/state";
import { run_writer, writer_cell } from "@mewhhaha/typeclasses/writer";

const config = reader<"config", Config>();
const request = reader<"request", RequestContext>();

const counter = state<"counter", number>();
const last_route = state<"last_route", string>();

const audit = writer_cell<"audit", AsArray, string>();
const metrics = writer_cell<"metrics", AsArray, number>();
```

The literal key gives each cell its type and runtime identity, even when two
cells contain the same value type. Use the cell's own operations inside a mixed
effect program:

```ts
type AppCells =
  | Uses<typeof config>
  | Uses<typeof request>
  | Uses<typeof counter>
  | Uses<typeof last_route>
  | Uses<typeof audit>
  | Uses<typeof metrics>;

const AppCells = Program.scope<AppCells>();

const record_request = AppCells(function* () {
  const api_origin = yield* config.asks((value) => value.api_origin);
  const context = yield* request.ask();
  const path = new URL(context.request.url).pathname;
  const previous_count = yield* counter.get();

  yield* counter.put(previous_count + 1);
  yield* last_route.put(path);
  yield* audit.tell(ArrayT(["request " + context.request_id]));
  yield* metrics.tell(ArrayT([1]));

  return api_origin + path;
});
```

Handle each cell separately. State and Writer handlers each add one pair to the
result, so several handlers produce nested pairs in handler order:

```ts
const [[[[endpoint, count], route], audit_log], metric_log] = Effect.interpret(
  record_request,
)
  .handle((effect) => run_reader(config, effect, config_value))
  .handle((effect) => run_reader(request, effect, request_context))
  .handle((effect) => run_state(counter, effect, 0))
  .handle((effect) => run_state(last_route, effect, ""))
  .handle((effect) => run_writer(audit, effect, ArrayT<string>([])))
  .handle((effect) => run_writer(metrics, effect, ArrayT<number>([])))
  .run(run);
```

Declare each key exactly once and keep the cell at module scope. Calling
`state<"counter", number>()` twice creates two runtime cells that share one
compile-time identity, so a handler can appear to remove both while one remains
unhandled. Widened keys such as `state<string, number>()` are rejected because
they do not identify one cell.

Prefer one `Reader<AppEnvironment>` or `State<AppState>` record when the values
form one cohesive unit and are always provided or updated together. Use cells
when they have independent handlers, lifetimes, test values, or state
transitions. `Writer.with(empty)` configures one direct Writer dictionary; it
does not create an independent log. Use `writer_cell` for that.

## Routing effect programs

Keep the pure matching rules separate from effect interpretation, but expose
routing to the application as an effect. The routing operation does not need to
carry a `Request`: its handler can obtain `RequestContext` through Reader and
resume the program with a typed route result.

Define one operation for asking the router to select a route:

```ts
type Route =
  | readonly ["/list"]
  | readonly ["/read/:id", { readonly id: string }]
  | readonly ["missing", { readonly path: string }];

type ParseRoute =
  & Operation<Route>
  & readonly ["router.parse_route"];

type Router = ParseRoute;

function parse_route(): Effect<ParseRoute, Route> {
  return Effect.send(["router.parse_route"] as ParseRoute);
}
```

The Router handler consumes that operation by asking for the request context,
running the pure matcher, and resuming with its result:

```ts
type WithoutRouter<requirements> = requirements extends Router ? never
  : requirements;

function run_router<requirements, item>(
  effect: Effect<requirements, item>,
): Effect<
  WithoutRouter<requirements> | Uses<AsReader<RequestContext>>,
  item
> {
  if (effect[0] === "pure") {
    return Effect.pure(effect[1]);
  }

  const operation = effect[1] as TaggedOperation;

  if (operation[0] === "router.parse_route") {
    return Effect.bind(
      Effect.lift(ask<RequestContext>()),
      (context) =>
        run_router(
          effect[2](match_route(context.request)),
        ),
    );
  }

  return Effect.suspend(
    effect[1] as WithoutRouter<requirements>,
    (value) => run_router(effect[2](value)),
  );
}
```

`match_route` is the trust-boundary parser. It converts method, path, and query
input into `Route`, including normal `missing` or `rejected` branches. The
effectful application only asks the Router and handles the typed result:

```ts
type HttpApp = Router | Database;

const HttpApp = Program.scope<HttpApp>();

const request_program = HttpApp(function* () {
  const [path, params] = yield* parse_route();

  switch (path) {
    case "/list": {
      const todos = yield* list_todos();

      return list_response(todos);
    }
    case "/read/:id": {
      const todo = yield* read_todo(params.id);

      return read_response(todo);
    }
    case "missing":
      return not_found_response(params.path);
  }
});
```

Because routing and database calls remain tagged operations, one instrumentation
handler can wrap both without explicit tracing in `request_program`:

```ts
function application_trace_scope(
  operation: unknown,
): TraceScope | undefined {
  const tagged = operation as TaggedOperation;

  if (tagged[0] === "router.parse_route") {
    return {
      name: "http.route",
      finish_attributes(value) {
        const route = value as Route;

        return { route: route[0] };
      },
    };
  }

  return database_trace_scope(operation);
}
```

Interpret the whole request once at the server or Worker boundary. The tracing
transformation must run before the Router and Database handlers consume the
operations it observes:

```ts
function handle_request(
  request: Request,
  database: DatabaseRuntime,
): Promise<Response> {
  const context = request_context(request);

  return Effect.interpret(request_program)
    .handle((effect) => run_trace_scopes(effect, application_trace_scope))
    .handle((effect) => run_trace_with_sink(effect, console_trace_sink()))
    .handle((effect) => run_router(effect))
    .handle((effect) => run_reader(effect, context))
    .handle((effect) => run_database(effect, database))
    .run(run_task);
}
```

The Router effect represents the routing capability, not one custom effect per
URL. Individual routes remain a plain tagged union and ordinary control flow.
Other Router handlers can use a preselected route in a unit test, apply an
authorization policy, or record routing decisions without changing the request
program.

For a larger declarative router, let matching select an already-built effect:

```ts
const routes = route_all(
  route("GET", "/", {}, home_page),
  route(
    "GET",
    "/users/:id",
    { params: { id: integer_param } },
    user_page,
  ),
);

const [tag, payload] = routes.value().match(route_context(request));

switch (tag) {
  case "matched":
    return to_response(payload);
  case "missed":
    return to_response(render_not_found(request));
  case "rejected":
    return to_response(render_bad_request(payload));
}
```

In this shape:

- `Alternative` expresses ordered route choice.
- The router parses path and query parameters before the page runs.
- `Reader<RouteInput>` supplies typed route input to the selected page.
- `Writer<AsyncIterable<string>>` can accumulate a streaming response body.
- The outer `to_response` function interprets the body and constructs the
  platform `Response`.

Use a tagged `Either`-like route result for `matched`, `missed`, and `rejected`;
these are expected routing outcomes, not exceptions. Parse JSON, path
parameters, and query parameters at the boundary, and do not make each effectful
branch repeat those checks.

See `case_studies/http_router/` for the declarative form and
`case_studies/cloudflare_crud_worker/` for request-wide routing with database,
clock, trace, Reader, and Task capabilities.

## Creating custom effects

Create a custom effect when the operation is part of the domain vocabulary and
the program benefits from describing it independently of its runtime. Good
examples include:

- A clock that can use system time in production and fixed time in tests.
- Database commands interpreted by D1, an in-memory store, or a recording
  runtime.
- Trace events interpreted by a production sink or accumulated into `Writer`.
- Filesystem and language-model operations interpreted by real or scripted
  implementations.
- Parallel analysis interpreted by one-shot workers or a reusable pool.

A custom operation is a tagged tuple intersected with `Operation<output>`.
Construct it with `Effect.send`:

```ts
import {
  Effect,
  type Operation,
  Program,
  run,
  type TaggedOperation,
} from "@mewhhaha/typeclasses/effects";

type Now =
  & Operation<string>
  & readonly ["clock.now"];

type Clock = Now;

function now(): Effect<Now, string> {
  return Effect.send(["clock.now"] as Now);
}

type WithoutClock<requirements> = requirements extends Clock ? never
  : requirements;

function run_clock<requirements, item>(
  effect: Effect<requirements, item>,
  read_now: () => string,
): Effect<WithoutClock<requirements>, item> {
  if (effect[0] === "pure") {
    return Effect.pure(effect[1]);
  }

  const operation = effect[1] as TaggedOperation;

  if (operation[0] === "clock.now") {
    return run_clock(effect[2](read_now()), read_now);
  }

  return Effect.suspend(
    effect[1] as WithoutClock<requirements>,
    (value) => run_clock(effect[2](value), read_now),
  );
}

const ClockApp = Program.scope<Clock>();

const timestamped = ClockApp(function* () {
  const timestamp = yield* now();

  return { timestamp, status: "created" as const };
});

const result = Effect.interpret(
  run_clock(timestamped, () => "2026-01-02T03:04:05.000Z"),
).run(run);
```

A handler walks the effect, consumes the operations it owns, resumes the
continuation with their output, and suspends every unknown operation unchanged.
Its result type removes the handled capability. A handler may also translate an
operation into another capability: a database handler commonly turns database
operations into `Task`, while a trace handler can turn trace events into
`Writer`.

### Instrument operations in a handler

Because custom effects remain tagged data until a handler interprets them, an
earlier handler can inspect and wrap selected operations. This makes tracing,
metrics, authorization, auditing, and similar cross-cutting behavior composable
without putting that behavior in every business function.

For example, a database program can contain only the domain operation:

```ts
const load_todo = CrudApp(function* () {
  const result = yield* read_todo(todo_id);

  return database_response(result);
});
```

A selector describes how database operations should appear as trace scopes:

```ts
function database_trace_scope(
  operation: unknown,
): TraceScope | undefined {
  const tagged = operation as TaggedOperation;

  switch (tagged[0]) {
    case "crud.database.list":
      return { name: "crud.database.list" };
    case "crud.database.read": {
      const [, read] = operation as ReadTodo;

      return {
        name: "crud.database.read",
        attributes: { todo_id: read.id },
      };
    }
    default:
      return undefined;
  }
}
```

`run_trace_scopes` is an effect-transforming handler. For each selected
operation it emits a trace start, suspends the original operation, then emits a
trace finish before resuming the rest of the program. It leaves unselected
operations unchanged.

Place the tracing transformation before the handler that consumes the operations
it needs to observe:

```ts
return Effect.interpret(crud_program)
  .handle((effect) => run_reader(effect, context))
  .handle((effect) => run_clock(effect, read_now))
  .handle((effect) => run_trace_scopes(effect, database_trace_scope))
  .handle((effect) => run_trace_with_sink(effect, trace_sink))
  .handle((effect) => run_database(effect, database))
  .run(run_task);
```

The ordering is meaningful:

1. `run_trace_scopes` must see the database operations before `run_database`
   consumes them.
2. It introduces `Trace` operations around the still-suspended database
   operation.
3. `run_trace_with_sink` translates those trace operations into `Task`.
4. `run_database` translates database operations into `Task`.
5. `run_task` executes the remaining asynchronous work.

This is more powerful than calling a tracing function inside every database
wrapper: the tracing policy is centralized, can select operations by tag, and
can be replaced without changing the program. Tests can use
`run_trace_to_writer` to collect the same generated trace operations as values
instead of sending them to production telemetry:

```ts
const [response, trace] = await Effect.interpret(crud_program)
  .handle((effect) => run_reader(effect, context))
  .handle((effect) =>
    run_clock(effect, fixed_clock("2026-01-02T03:04:05.000Z"))
  )
  .handle((effect) => run_trace_scopes(effect, database_trace_scope))
  .handle(run_trace_to_writer)
  .handle((effect) => run_database(effect, memory_database()))
  .handle((effect) => run_writer(effect, ArrayT<string>([])))
  .run(run_task);
```

Use explicit `trace_event(...)` operations for meaningful domain or lifecycle
events such as `http.request.start` or `order.accepted`. Use an instrumentation
handler for systematic operational spans around database, model, filesystem, or
worker operations. Keeping these separate avoids repeating mechanical tracing
while preserving intentional domain events.

This interception is also the clearest dividing line between custom effects and
`Reader<Service>`: once a Reader-provided function is called, the effect system
cannot inspect that call as an operation. Prefer a custom effect when handlers
must observe, transform, wrap, record, deny, batch, or reroute individual
operations.

Prefer `Reader<Service>` instead when the only requirement is to inject a group
of callable functions. A custom effect earns its extra machinery when at least
one of these is true:

- The operation should be inspectable as data.
- Several handlers give it materially different semantics.
- Another handler needs to transform or instrument it.
- Tests should run or record operations without mocking function calls.
- The capability should remain visible in the program's requirement union until
  explicitly handled.

Do not create a custom effect for a pure calculation, one concrete async call,
ordinary configuration, local state, accumulated output, or expected failure.
Use a pure function, `Task`, `Reader`, `State`, `Writer`, `Either`, or `Fails`
respectively.

Keep operation payloads small domain values. Do not put runtime clients,
callbacks, mutable infrastructure objects, or already-started promises inside
the operation. Those belong in the handler's runtime.

## When to use STM

Use `Stm` when several synchronous, isolate-local values must be read and
written atomically, and a rejected branch must roll back every tentative write.
Admission control, bounded local queues, counters allocated with a reservation,
and transfers between related values are good fits.

```ts
import { Applicative, Do } from "@mewhhaha/typeclasses/typeclasses";
import {
  type AsStm,
  atomically,
  modify_tvar,
  new_tvar,
  or_else,
  read_tvar,
  retry,
  Stm,
  type TVar,
  write_tvar,
} from "@mewhhaha/typeclasses/stm";
import type { Data } from "@mewhhaha/typeclasses/typeclass";

type Reservation =
  | { readonly status: "reserved"; readonly ticket: number }
  | { readonly status: "full" };

function try_reserve(
  queue: TVar<readonly number[]>,
  last_ticket: TVar<number>,
  capacity: number,
): Data<AsStm, Reservation> {
  return Do(function* () {
    const ticket = yield* modify_tvar(last_ticket, (current) => current + 1);
    const tickets = yield* read_tvar(queue);

    if (tickets.length >= capacity) {
      return yield* retry<Reservation>();
    }

    yield* write_tvar(queue, [...tickets, ticket]);

    return { status: "reserved", ticket };
  });
}

const primary = new_tvar<readonly number[]>([]);
const overflow = new_tvar<readonly number[]>([]);
const last_ticket = new_tvar(0);
const successful_reservations = new_tvar(0);

const reservation = Do(function* () {
  const result = yield* or_else(
    try_reserve(primary, last_ticket, 1),
    or_else(
      try_reserve(overflow, last_ticket, 2),
      Applicative.pure(Stm, { status: "full" as const }),
    ),
  );

  if (result.status === "reserved") {
    yield* modify_tvar(successful_reservations, (count) => count + 1);
  }

  return result;
});

const result = atomically(reservation);
```

If the primary queue is full, `retry` discards the ticket allocation and every
other tentative write before `or_else` starts the overflow transaction from the
original journal. If both queues are full, the final pure branch returns a
normal domain rejection. `Do` sequences the selected reservation with the
counter update in the same transaction. It does not replace `or_else`: fallback
and journal restoration are choice semantics, while `Do` supplies monadic
sequencing before and after that choice.

This `Stm` is deliberately smaller than Haskell STM:

- Transactions are synchronous and cannot cross `await`.
- `TVar`s are local to one JavaScript isolate and are not shared with Workers.
- `retry` chooses an immediate `or_else` branch; it does not wait for a `TVar`
  to change.
- STM is not a database transaction, distributed lock, worker mutex, or
  replacement for an external system's concurrency controls.

Use ordinary immutable transformations when only one local value is involved.
Use `State` when state only needs to be threaded through one computation and no
shared commit or rollback is required. Use the database's own transaction API
when atomicity must include persistent storage.

## Common conversions

Use these translations when moving imperative TypeScript into this library:

| Existing pattern                                              | Preferred representation                      |
| ------------------------------------------------------------- | --------------------------------------------- |
| `value \| null \| undefined` where absence is enough          | `Maybe` and `from_nullable`                   |
| `{ ok: boolean, value?, error? }`                             | `Either<error, item>`                         |
| Throwing for an expected parse or domain outcome              | Return `Either`                               |
| Returning only the first of several independent field errors  | `Validation` and `Applicative.lift`           |
| Eager `Promise` construction                                  | `Task` with `from_fn`                         |
| `Promise.all` over a fixed set of independent typed tasks     | `Applicative.lift`                            |
| Dependent `await` statements                                  | `Task` with `Do`                              |
| Catching promise rejection into a typed program error         | `attempt` and `Fails`                         |
| Passing configuration through every function                  | `Reader`, or a Reader capability in `Program` |
| Mutating an accumulator across pure steps                     | `State`                                       |
| Returning a value plus accumulated output                     | `Writer`                                      |
| Reimplementing one fold for arrays, maps, and optional values | A generic `Foldable` function                 |
| Nested Reader/State/Writer/Task transformer types             | A `Program` capability union                  |

Convert at a trust boundary once. Past that point, accept the precise wrapped
type and do not repeat null checks or runtime parsing that its constructor
already proved.

## Testing

Test observable values and interpreted program results. Do not assert on
dictionary internals, generator frames, implementation symbols, or calls between
functions owned by the application.

### Test algebraic values through their public representation

```ts
import { assertEquals } from "jsr:@std/assert";
import { Left, Right } from "@mewhhaha/typeclasses/either";

Deno.test("read_port reports the rejected input", () => {
  const result = read_port({ port: "abc" });

  assertEquals(
    result.value(),
    Left(["invalid-port", { field: "port", input: "abc" }] as const).value(),
  );
});

Deno.test("read_port returns a positive integer", () => {
  const result = read_port({ port: "8080" });

  assertEquals(result.value(), Right(8080).value());
});
```

Compare `.value()` with a value built by the public constructor. This keeps the
assertion independent of fluent wrapper identity while documenting the public
tagged shape.

For validation, assert the complete accumulated error list in its meaningful
order:

```ts
Deno.test("registration reports every independent field error", () => {
  const result = decode_registration({
    name: "",
    email: "",
  });

  assertEquals(
    result.value(),
    Problems.Invalid([
      "name is required",
      "email is required",
    ]).value(),
  );
});
```

### Run deferred work in tests

Constructing a `Task` must not start work. Assert both laziness and the final
observable result when laziness is part of the contract:

```ts
Deno.test("account loading is deferred until the task runs", async () => {
  const events: string[] = [];
  const task = from_fn(async () => {
    events.push("started");
    return 42;
  });

  assertEquals(events, []);
  assertEquals(await task.run(), 42);
  assertEquals(events, ["started"]);
});
```

For independent tasks, test externally visible ordering or overlap only when
concurrency is part of the promised behavior. Avoid testing private call counts.

### Interpret programs with boundary implementations

Supply small in-memory Reader environments and run the real handlers. This tests
business behavior without mocking library internals:

```ts
type Services = {
  readonly load_account: (
    account_id: string,
    signal: AbortSignal | undefined,
  ) => Promise<{ readonly id: string }>;
};

type AccountError = readonly [
  "account-request-failed",
  { readonly account_id: string; readonly cause: unknown },
];

type TestApp =
  | Uses<AsReader<Services>>
  | Uses<AsTask>
  | Fails<AccountError>;

const TestApp = Program.scope<TestApp>();

function load_account(account_id: string) {
  return TestApp(function* () {
    const services = yield* ask<Services>();

    return yield* attempt(
      (signal) => services.load_account(account_id, signal),
      (cause): AccountError => [
        "account-request-failed",
        { account_id, cause },
      ],
    );
  });
}

Deno.test("load_account returns the service result", async () => {
  const services: Services = {
    load_account: (account_id) => Promise.resolve({ id: account_id }),
  };

  const result = await Effect.interpret(run_except(load_account("account-42")))
    .handle((effect) => run_reader(effect, services))
    .run(run_task);

  assertEquals(result.value(), Right({ id: "account-42" }).value());
});
```

Use a controllable clock, service, filesystem, or network implementation only at
the actual boundary. Keep domain functions real. Test typed failures by
interpreting them into `Either`, not by expecting a thrown exception.

### Test custom instances with laws and behavior

For a new typeclass instance, test:

- Its public domain behavior.
- Empty, one-value, and many-value cases that the operation claims to support.
- The relevant laws, such as functor identity/composition, monad
  identity/associativity, or semigroup associativity.
- Coherence between inherited capabilities, such as `Ord` equality agreeing with
  `Eq`.

Use independently known expected values. Do not copy the implementation's fold
or comparison algorithm into the assertion.

## Defining a data type or instance

Before adding a new wrapper, inspect one neighboring source module with a
similar raw shape. In particular:

- Keep the raw type, `As...` interface, `Data` alias, callable dictionary, and
  instances together.
- Express the raw representation once through `type_item` and `type_data`.
- Construct the dictionary with `data<As...>()`.
- Install only lawful typeclass instances.
- Put reusable typeclass machinery in `src/typeclass.ts` and application-level
  typeclass definitions in `src/typeclasses.ts`.
- Prefer tagged tuples for algebraic variants and switch on their tag.

Do not add an instance because a method can be implemented mechanically. For
example, `Validation` omits `Monad` because that instance would contradict its
error-accumulation purpose.

When extending a dictionary from another module, use module augmentation and
install the implementation on the public callable dictionary. See
`examples/custom_typeclass.ts` and the custom instance example in `README.md`
before writing new typeclass machinery.

## Source map

Read these files when a pattern is unclear:

- `README.md` for the complete public API and Haskell comparisons.
- `src/maybe.ts`, `src/either.ts`, and `src/validation.ts` for values at absence
  and error boundaries.
- `src/task.ts` for deferred asynchronous behavior and cancellation.
- `src/effects.ts` and `src/except.ts` for programs, handlers, cleanup, and
  typed failure.
- `src/reader.ts`, `src/state.ts`, and `src/writer.ts` for standard capabilities
  and their handlers.
- `examples/validated_request.ts` for accumulating independent errors.
- `examples/task_workflow.ts` for parallel and dependent async work.
- `examples/do_contexts.ts` for `Do` short-circuiting and dependent list
  branches.
- `examples/effects.ts` for standard capability composition.
- `examples/instrumented_effects.ts` for handler-level operation
  instrumentation.
- `examples/keyed_cells.ts` for several independent Reader, State, and Writer
  cells in one program.
- `examples/stm_coordination.ts` for local admission, rollback, and fallback.
- `case_studies/http_router/` for declarative routing into effectful pages.
- `case_studies/cloudflare_crud_worker/` for request-wide routing and custom
  database, clock, and trace effects.
- `case_studies/agent_harness/` for custom model and filesystem effects.
- `src/typeclass_examples.test.ts`, `src/effects_runtime.test.ts`, and
  `src/except_runtime.test.ts` for executable usage.
- `learn_you_a_typeclasses_for_greater_good/` for a progressive tutorial.

## Verification

After changing application code that uses the library, run that application's
type checker, linter, tests, and the specific path that changed.

After changing this repository, run:

```sh
deno task check
deno lint
deno test
```

For a release-level change, run `deno task verify`, which also checks
formatting, documentation, the transformer, portability, package entry points,
examples, tutorials, case studies, and benchmark smoke tests.
