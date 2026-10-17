// Persistent function composition for Reader and State. Functions retain their
// public raw shape; only functions produced here carry an inspectable plan.
type Raw = (context: unknown) => unknown;
type Frame =
  | { readonly tag: "map"; readonly apply: (value: unknown) => unknown }
  | {
    readonly tag: "bind";
    readonly apply: (
      value: unknown,
      context: unknown,
    ) => readonly [Raw, unknown];
  };
type Plan = { readonly source: Raw; readonly frame: Frame };
const plans = new WeakMap<Raw, Plan>();

export function map_computation<context, from, to>(
  source: (context: context) => from,
  fn: (value: from) => to,
): (context: context) => to {
  return compose(source as Raw, {
    tag: "map",
    apply: fn as (value: unknown) => unknown,
  }) as (context: context) => to;
}

export function bind_computation<context, from, to>(
  source: (context: context) => from,
  fn: (
    value: from,
    context: context,
  ) => readonly [(context: context) => to, context],
): (context: context) => to {
  return compose(source as Raw, {
    tag: "bind",
    apply: fn as (value: unknown, context: unknown) => readonly [Raw, unknown],
  }) as (context: context) => to;
}

function compose(source: Raw, frame: Frame): Raw {
  const plan = { source, frame };
  const composed: Raw = (context) => evaluate(plan, context);
  plans.set(composed, plan);
  return composed;
}

function evaluate(plan: Plan, context: unknown): unknown {
  const frames: Frame[] = [plan.frame];
  let current = plan.source;
  while (true) {
    let nested = plans.get(current);
    while (nested !== undefined) {
      frames.push(nested.frame);
      current = nested.source;
      nested = plans.get(current);
    }
    let value = current(context);
    while (true) {
      const frame = frames.pop();
      if (frame === undefined) return value;
      switch (frame.tag) {
        case "map":
          value = frame.apply(value);
          break;
        case "bind":
          [current, context] = frame.apply(value, context);
          break;
      }
      if (frame.tag === "bind") break;
    }
  }
}
