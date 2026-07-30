import { type EitherValue, Left, Right } from "../src/either.ts";
import { Just } from "../src/maybe.ts";
import { match } from "../src/tagged.ts";

type ProfileLookup =
  | readonly [
    "found",
    {
      readonly id: string;
      readonly display_name: string;
    },
  ]
  | readonly ["missing"]
  | readonly ["forbidden", { readonly reason: string }];

export type MatchingScenario = {
  readonly custom_union: readonly string[];
  readonly maybe: string;
  readonly either: readonly string[];
};

export function run_matching_scenario(): MatchingScenario {
  return {
    custom_union: [
      describe_profile([
        "found",
        { id: "profile-42", display_name: "Ada" },
      ]),
      describe_profile(["missing"]),
      describe_profile(["forbidden", { reason: "private profile" }]),
    ],
    maybe: Just(41)
      .map((value) => value + 1)
      .match({
        Just: (value) => "value " + value.toString(),
        Nothing: () => "missing",
      }),
    either: [
      describe_result(Right<string, number>(42)),
      describe_result(Left<string, number>("invalid port")),
    ],
  };
}

export function run_matching_examples() {
  console.log(
    "exhaustive tagged matching",
    Deno.inspect(run_matching_scenario()),
  );
}

function describe_profile(profile: ProfileLookup): string {
  return match(profile, {
    found: ({ id, display_name }) => id + ": " + display_name,
    missing: () => "profile not found",
    forbidden: ({ reason }) => "forbidden: " + reason,
  });
}

function describe_result(result: EitherValue<string, number>): string {
  return result.match({
    Left: (message) => "error: " + message,
    Right: (value) => "ok: " + value.toString(),
  });
}
