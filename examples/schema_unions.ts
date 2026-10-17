import { $slot, define_union, field } from "../src/typeclass.ts";

const outcome_id = Symbol("Outcome");
export const Outcome = define_union(outcome_id, ["Ok", $slot], [
  "Failed",
  field<string>(),
]);
export type Outcome<item> = ReturnType<typeof Outcome.Ok<item>>;

const remote_id = Symbol("Remote");
export const Remote = define_union(remote_id, ["Loading"], ["Loaded", $slot], [
  "Failed",
  field<string>(),
]);
export type Remote<item> = ReturnType<typeof Remote.Loaded<item>>;

const event_id = Symbol("Event");
export const Event = define_union(
  event_id,
  ["Changed", field<string>(), $slot],
  ["Removed", field<string>()],
);
export type Event<item> = ReturnType<typeof Event.Changed<item>>;

export function schema_unions_example(): string[] {
  const outcome: Outcome<number> = Outcome.Ok(42);
  const remote: Remote<string> = Remote.Loaded("ready");
  const event: Event<number> = Event.Changed("counter", 2);
  return [
    outcome.match({ Ok: (value) => String(value), Failed: (error) => error }),
    remote.match({
      Loading: () => "loading",
      Loaded: (value) => value,
      Failed: (error) => error,
    }),
    event.match({
      Changed: (key, value) => `${key}=${value}`,
      Removed: (key) => key,
    }),
  ];
}
