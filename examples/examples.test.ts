import { assert_equals, assert_true } from "../src/assert.ts";
import { price_order } from "./composable_functions.ts";
import { run_stm_coordination_scenario } from "./stm_coordination.ts";
import {
  type Account,
  load_account_dashboard,
  run_task_workflow_scenario,
  type Team,
} from "./task_workflow.ts";
import { decode_registration_request } from "./validated_request.ts";
import { analyze_log_shard } from "./worker_pool_job.ts";

Deno.test("registration decoding normalizes an accepted request", () => {
  const form = new FormData();
  form.set("username", " ada_lovelace ");
  form.set("email", " ADA@example.test ");
  form.set("password", "analytical42");
  form.set("age", "36");

  assert_equals(decode_registration_request(form), {
    status: "accepted",
    request: {
      username: "ada_lovelace",
      email: "ada@example.test",
      password: "analytical42",
      age: 36,
    },
  });
});

Deno.test("registration decoding reports every independent field error", () => {
  const form = new FormData();
  form.set("username", "");
  form.set("email", "ada.example.test");
  form.set("password", "short");
  form.set("age", "17");

  assert_equals(decode_registration_request(form), {
    status: "rejected",
    messages: [
      "username is required",
      "email must contain a local part and host",
      "password must be at least 12 characters",
      "password must contain a number",
      "age must be at least 18",
    ],
  });
});

Deno.test("composable pricing normalizes input before producing a quote", () => {
  const result = price_order({
    order: {
      id: " order-42 ",
      destination_country: " pl ",
      item_count: 2,
      subtotal_cents: 12_000,
      expedited: false,
    },
  });

  assert_equals(result, {
    status: "quoted",
    order_id: "order-42",
    subtotal_cents: 12_000,
    shipping_cents: 0,
    total_cents: 12_000,
    summary: "order order-42: $120.00 + $0.00 shipping = $120.00",
  });
});

Deno.test("composable pricing combines base and expedited shipping", () => {
  const result = price_order({
    order: {
      id: "order-43",
      destination_country: "de",
      item_count: 1,
      subtotal_cents: 4_000,
      expedited: true,
    },
  });

  assert_equals(result, {
    status: "quoted",
    order_id: "order-43",
    subtotal_cents: 4_000,
    shipping_cents: 2_250,
    total_cents: 6_250,
    summary: "order order-43: $40.00 + $22.50 shipping = $62.50",
  });
});

Deno.test("composable pricing reports every failed order policy", () => {
  const result = price_order({
    order: {
      id: "  ",
      destination_country: "fr",
      item_count: 0,
      subtotal_cents: -1,
      expedited: false,
    },
  });

  assert_equals(result, {
    status: "rejected",
    order_id: "",
    reasons: [
      "order id is blank",
      "item_count 0 must be a positive safe integer",
      "subtotal_cents -1 must be a positive safe integer",
      'destination_country "FR" is not supported',
    ],
    summary: "order <missing> rejected: order id is blank; " +
      "item_count 0 must be a positive safe integer; " +
      "subtotal_cents -1 must be a positive safe integer; " +
      'destination_country "FR" is not supported',
  });
});

Deno.test("task workflow starts dependencies before unrelated work finishes", async () => {
  const account_request = Promise.withResolvers<Account>();
  const alerts_request = Promise.withResolvers<number>();
  const team_request = Promise.withResolvers<Team>();
  const tip_request = Promise.withResolvers<string>();
  const team_started_signal = Promise.withResolvers<void>();
  const tip_started_signal = Promise.withResolvers<void>();
  let account_started = false;
  let alerts_started = false;
  let team_started = false;
  let tip_started = false;
  const dashboard_task = load_account_dashboard({
    load_account() {
      account_started = true;
      return account_request.promise;
    },
    count_open_alerts() {
      alerts_started = true;
      return alerts_request.promise;
    },
    load_team() {
      team_started = true;
      team_started_signal.resolve();
      return team_request.promise;
    },
    load_tip() {
      tip_started = true;
      tip_started_signal.resolve();
      return tip_request.promise;
    },
  }, "account-42");

  assert_true(
    !account_started && !alerts_started,
    "constructing a Task must not start service calls",
  );

  const dashboard_result = dashboard_task.run();
  await Promise.resolve();

  assert_true(
    account_started && alerts_started,
    "independent account and alert calls must start together",
  );
  assert_true(
    !team_started && !tip_started,
    "account-dependent calls must wait for the account result",
  );

  account_request.resolve({
    id: "account-42",
    display_name: "Ada",
    team_id: "team-platform",
  });
  await Promise.all([
    team_started_signal.promise,
    tip_started_signal.promise,
  ]);

  assert_true(
    team_started && tip_started,
    "account-dependent calls must start while alerts are still pending",
  );

  team_request.resolve({ id: "team-platform", name: "Platform" });
  tip_request.resolve("Ship the next release");
  alerts_request.resolve(2);
  const dashboard = await dashboard_result;

  assert_equals(dashboard, {
    account: {
      id: "account-42",
      display_name: "Ada",
      team_id: "team-platform",
    },
    team: { id: "team-platform", name: "Platform" },
    open_alerts: 2,
    tip: { source: "service", text: "Ship the next release" },
  });
});

Deno.test("task workflow recovers when the optional tip service fails", async () => {
  const scenario = await run_task_workflow_scenario();

  assert_equals(scenario.dashboard, {
    account: {
      id: "account-42",
      display_name: "Ada",
      team_id: "team-platform",
    },
    team: { id: "team-platform", name: "Platform" },
    open_alerts: 2,
    tip: { source: "fallback", text: "Review your open alerts" },
  });
});

Deno.test("STM admission rolls back full queues before falling back", () => {
  assert_equals(run_stm_coordination_scenario(), {
    admissions: [
      {
        status: "assigned",
        request_id: "request-1",
        worker_id: "primary",
        ticket: 1,
      },
      {
        status: "assigned",
        request_id: "request-2",
        worker_id: "overflow",
        ticket: 2,
      },
      {
        status: "assigned",
        request_id: "request-3",
        worker_id: "overflow",
        ticket: 3,
      },
      {
        status: "rejected",
        request_id: "request-4",
        reason: "all local worker queues are full",
      },
    ],
    primary_queue: [{ request_id: "request-1", ticket: 1 }],
    overflow_queue: [
      { request_id: "request-2", ticket: 2 },
      { request_id: "request-3", ticket: 3 },
    ],
    last_ticket: 3,
  });
});

Deno.test("worker jobs analyze structured-clone-safe log shards", () => {
  assert_equals(
    analyze_log_shard({
      id: "gateway",
      lines: ["WARN retry", "ERROR timeout", "INFO recovered"],
    }),
    {
      id: "gateway",
      lines: 3,
      warnings: 1,
      errors: 1,
      characters: 37,
      checksum: 407_382_771,
    },
  );
});
