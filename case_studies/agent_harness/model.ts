import {
  Effect,
  type Effect as AlgebraicEffect,
  type Operation,
  type TaggedOperation,
  type Uses,
} from "../../src/effects.ts";
import { type AsTask, from_fn } from "../../src/task.ts";
import type { AgentMessage, ModelAction } from "./types.ts";

export type Complete =
  & Operation<ModelAction>
  & {
    readonly tag: "model.complete";
    readonly messages: readonly AgentMessage[];
  };

export type LanguageModel = Complete;

export type LanguageModelRuntime = {
  complete(messages: readonly AgentMessage[]): Promise<ModelAction>;
};

type WithoutLanguageModel<requirements> = requirements extends LanguageModel
  ? never
  : requirements;

export function complete(
  messages: readonly AgentMessage[],
): AlgebraicEffect<Complete, ModelAction> {
  return Effect.send({
    tag: "model.complete",
    messages,
  } as Complete);
}

export function run_language_model<requirements, item>(
  effect: AlgebraicEffect<requirements, item>,
  runtime: LanguageModelRuntime,
): AlgebraicEffect<WithoutLanguageModel<requirements> | Uses<AsTask>, item> {
  if (effect.tag === "pure") {
    return Effect.pure(effect.value);
  }

  const operation = effect.operation as TaggedOperation;

  if (operation.tag === "model.complete") {
    const complete = effect.operation as Complete;

    return Effect.bind(
      Effect.lift(from_fn(() => runtime.complete(complete.messages))),
      (action) => run_language_model(effect.resume(action), runtime),
    );
  }

  return Effect.suspend(
    effect.operation as WithoutLanguageModel<requirements>,
    (value) => run_language_model(effect.resume(value), runtime),
  );
}
