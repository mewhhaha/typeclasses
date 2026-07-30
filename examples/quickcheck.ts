import { Program, run, type Uses } from "../src/effects.ts";
import {
  check_effect,
  element,
  Gen,
  integer_arbitrary,
  sample,
} from "../src/quickcheck.ts";
import { ask, type AsReader, run_reader } from "../src/reader.ts";
import { Do } from "../src/typeclasses.ts";

type TaxPolicy = {
  readonly basis_points: number;
};

type Pricing = Uses<AsReader<TaxPolicy>>;

const Pricing = Program.scope<Pricing>();

const request = Do(Gen, function* () {
  const method = yield* element(["GET", "POST"] as const);
  const path = yield* element(["/list", "/read/42"] as const);

  return { method, path };
});

function price_with_tax(subtotal_cents: number) {
  return Pricing(function* () {
    const policy = yield* ask<TaxPolicy>();
    const tax_cents = Math.floor(
      subtotal_cents * policy.basis_points / 10_000,
    );

    return subtotal_cents + tax_cents;
  });
}

export async function run_quickcheck_scenario() {
  const generated_requests = sample(request, {
    seed: 42,
    count: 4,
  });
  const report = await check_effect({
    arbitrary: integer_arbitrary({ min: 0, max: 100_000 }),
    seed: 42,
    iterations: 100,
    property: (subtotal_cents) =>
      Pricing(function* () {
        const total_cents = yield* price_with_tax(subtotal_cents);

        return total_cents >= subtotal_cents;
      }),
    run: (effect) =>
      run(run_reader(effect, {
        basis_points: 2_300,
      })),
  });

  return { generated_requests, report };
}

export async function run_quickcheck_examples() {
  console.log(
    "quickcheck",
    Deno.inspect(await run_quickcheck_scenario()),
  );
}
