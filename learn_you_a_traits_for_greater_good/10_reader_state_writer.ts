import { ArrayT, to_array } from "../src/array.ts";
import { assert_equals } from "../src/assert.ts";
import { ask, asks } from "../src/reader.ts";
import { get, gets, modify } from "../src/state.ts";
import { Do } from "../src/typeclasses.ts";
import { tell, writer } from "../src/writer.ts";

type Config = {
  readonly host: string;
  readonly port: number;
};

export function lesson_10_reader_state_writer() {
  const endpoint = Do(function* () {
    const config = yield* ask<Config>();
    const host = yield* asks<Config, string>((environment) => environment.host);

    return "http://" + host + ":" + config.port.toString();
  });
  const counter = Do(function* () {
    const before = yield* get<number>();

    yield* modify((value: number) => value + 1);
    yield* modify((value: number) => value * 2);

    const after = yield* gets((value: number) => value);

    return { before, after };
  });
  const audit = Do(function* () {
    yield* tell(ArrayT(["start"]));

    const value = yield* writer(40, ArrayT(["value"]));

    yield* tell(ArrayT(["finish"]));

    return value + 2;
  });
  const [audit_value, audit_log] = audit.value();

  assert_equals(
    endpoint.run({ host: "localhost", port: 8000 }),
    "http://localhost:8000",
  );
  assert_equals(counter.run(20), [{ before: 20, after: 42 }, 42]);
  assert_equals(audit_value, 42);
  assert_equals(to_array(audit_log), ["start", "value", "finish"]);
}
