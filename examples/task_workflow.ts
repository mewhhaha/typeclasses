import {
  type AsTask,
  from_fn,
  parallel,
  sequential,
  succeed,
} from "../src/task.ts";
import type { Data } from "../src/typeclass.ts";
import { Applicative, Do, MonadError } from "../src/typeclasses.ts";

export type Account = {
  readonly id: string;
  readonly display_name: string;
  readonly team_id: string;
};

export type Team = {
  readonly id: string;
  readonly name: string;
};

export type DashboardTip =
  | { readonly source: "service"; readonly text: string }
  | { readonly source: "fallback"; readonly text: string };

export type AccountDashboard = {
  readonly account: Account;
  readonly team: Team;
  readonly open_alerts: number;
  readonly tip: DashboardTip;
};

export type DashboardServices = {
  readonly load_account: (account_id: string) => Promise<Account>;
  readonly count_open_alerts: (account_id: string) => Promise<number>;
  readonly load_team: (team_id: string) => Promise<Team>;
  readonly load_tip: (account_id: string) => Promise<string>;
};

export type TaskWorkflowScenario = {
  readonly events_before_run: readonly string[];
  readonly dashboard: AccountDashboard;
  readonly events_after_run: readonly string[];
};

export function load_account_dashboard(
  services: DashboardServices,
  account_id: string,
): Data<AsTask, AccountDashboard> {
  const account_details = Do(function* () {
    const account = yield* from_fn(() => services.load_account(account_id));
    const team_and_tip = sequential(Applicative.lift(
      (team, tip) => ({ team, tip }),
      parallel(from_fn(() => services.load_team(account.team_id))),
      parallel(MonadError.catch_error(
        from_fn<DashboardTip>(async () => ({
          source: "service",
          text: await services.load_tip(account.id),
        })),
        () =>
          succeed<DashboardTip>({
            source: "fallback",
            text: "Review your open alerts",
          }),
      )),
    ));
    const { team, tip } = yield* team_and_tip;

    return { account, team, tip };
  });

  return sequential(Applicative.lift(
    ({ account, team, tip }, open_alerts) => ({
      account,
      team,
      open_alerts,
      tip,
    }),
    parallel(account_details),
    parallel(from_fn(() => services.count_open_alerts(account_id))),
  ));
}

export async function run_task_workflow_scenario(): Promise<
  TaskWorkflowScenario
> {
  const events: string[] = [];
  const services = create_example_services(events);
  const dashboard_task = load_account_dashboard(services, "account-42");
  const events_before_run = [...events];
  const dashboard = await dashboard_task.run();

  return {
    events_before_run,
    dashboard,
    events_after_run: [...events],
  };
}

export async function run_task_workflow_examples() {
  const scenario = await run_task_workflow_scenario();

  console.log(
    "task workflow deferred events",
    Deno.inspect(scenario.events_before_run),
  );
  console.log(
    "task workflow dashboard",
    Deno.inspect(scenario.dashboard),
  );
  console.log(
    "task workflow service events",
    Deno.inspect(scenario.events_after_run),
  );
}

function create_example_services(events: string[]): DashboardServices {
  return {
    async load_account(account_id) {
      events.push("account " + account_id + " started");
      await Promise.resolve();

      events.push("account " + account_id + " finished");

      return {
        id: account_id,
        display_name: "Ada",
        team_id: "team-platform",
      };
    },

    async count_open_alerts(account_id) {
      events.push("alerts " + account_id + " started");
      await Promise.resolve();

      events.push("alerts " + account_id + " finished");
      return 2;
    },

    async load_team(team_id) {
      events.push("team " + team_id + " started");
      await Promise.resolve();

      events.push("team " + team_id + " finished");
      return { id: team_id, name: "Platform" };
    },

    async load_tip(account_id) {
      events.push("tip " + account_id + " started");
      await Promise.resolve();

      events.push("tip " + account_id + " failed");
      throw new Error("tip service unavailable for account " + account_id);
    },
  };
}
