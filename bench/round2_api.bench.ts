import { install_instance } from "../src/typeclass.ts";
import {
  Effect,
  handle_operation,
  type Operation,
  run,
  type TaggedOperation,
} from "../src/effects.ts";
import { handle_operations } from "../src/handlers.ts";
const root = Deno.env.get("TYPECLASSES_BASELINE");
const versions: [string, typeof install_instance][] = [[
  "current",
  install_instance,
]];
if (root !== undefined) {
  const previous = await import(
    new URL("src/typeclass.ts", "file://" + root + "/").href
  );
  versions.unshift(["baseline", previous.install_instance]);
}
const token = Symbol("bench");
const implementation = Object.fromEntries(
  Array.from({ length: 12 }, (_, index) => ["method" + index, function () {
    return index;
  }]),
);
let _sink: unknown;
for (const [version, install] of versions) {
  Deno.bench(version + "/register 100 dictionaries x 12 methods", () => {
    for (let i = 0; i < 100; i++) {
      _sink = install(Object.create(null), token, implementation);
    }
  });
}
const a = Effect.operation<number>()("a");
const b = Effect.operation<number>()("b");
const c = Effect.operation<number>()("c");
const d = Effect.operation<number>()("d");
const operations = [a(undefined), b(undefined), c(undefined), d(undefined)];
type Requirement = typeof operations[number];
let source: Effect<Requirement, number> = Effect.pure(0);
for (let index = 0; index < 100; index++) {
  const operation = operations[index % 4];
  source = Effect.bind(
    source,
    (sum) => Effect.map(Effect.send(operation), (n) => sum + n),
  );
}
function reply(_operation: TaggedOperation & Operation<number>) {
  return Effect.pure(1);
}
Deno.bench("handlers/four nested passes", () => {
  let handled = source as Effect<Requirement, number>;
  for (const tag of ["a", "b", "c", "d"]) {
    handled = handle_operation(
      handled,
      (operation): operation is Requirement =>
        Array.isArray(operation) && operation[0] === tag,
      reply,
    );
  }
  _sink = run(handled as Effect<never, number>);
});
Deno.bench("handlers/one table pass", () => {
  _sink = run(
    handle_operations(source, { a: reply, b: reply, c: reply, d: reply }),
  );
});
