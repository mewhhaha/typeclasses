import {
  Effect,
  type Operation,
  type TaggedOperation,
  type Uses,
} from "../../src/effects.ts";
import { type AsTask, from_fn } from "../../src/task.ts";
import type { AgentMessage, ModelAction } from "./types.ts";

export type Complete =
  & Operation<ModelAction>
  & readonly ["model.complete", { readonly messages: readonly AgentMessage[] }];

export type LanguageModel = Complete;

export type LanguageModelRuntime = {
  complete(messages: readonly AgentMessage[]): Promise<ModelAction>;
};

type WithoutLanguageModel<requirements> = requirements extends LanguageModel
  ? never
  : requirements;

export function complete(
  messages: readonly AgentMessage[],
): Effect<Complete, ModelAction> {
  return Effect.send(["model.complete", { messages }] as Complete);
}

export function run_language_model<requirements, item>(
  effect: Effect<requirements, item>,
  runtime: LanguageModelRuntime,
): Effect<WithoutLanguageModel<requirements> | Uses<AsTask>, item> {
  if (effect[0] === "pure") {
    return Effect.pure(effect[1]);
  }

  const operation = effect[1] as TaggedOperation;

  if (operation[0] === "model.complete") {
    const [, complete] = effect[1] as Complete;

    return Effect.bind(
      Effect.lift(from_fn(() => runtime.complete(complete.messages))),
      (action) => run_language_model(effect[2](action), runtime),
    );
  }

  return Effect.suspend(
    effect[1] as WithoutLanguageModel<requirements>,
    (value) => run_language_model(effect[2](value), runtime),
  );
}
