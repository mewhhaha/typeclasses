// Persistent Reader/State composition. Compile the requested static segment once;
// execution cursors belong to the invocation, so recursive runs remain isolated.
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
type Compiled = { readonly source: Raw; readonly frames: readonly Frame[] };
const plans = new WeakMap<Raw, Plan>();
// Weak cached segments avoid retaining quadratic arrays when callers execute
// every prefix of a growing plan. Active runs hold their own strong reference.
const compiled = new WeakMap<Plan, WeakRef<Compiled>>();

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
  const composed: Raw = (context) => evaluate(compile(plan), context);
  plans.set(composed, plan);
  return composed;
}

function compile(plan: Plan): Compiled {
  const cached = compiled.get(plan)?.deref();
  if (cached !== undefined) return cached;
  const frames = [plan.frame];
  let source = plan.source;
  let nested = plans.get(source);
  while (nested !== undefined) {
    frames.push(nested.frame);
    source = nested.source;
    nested = plans.get(source);
  }
  frames.reverse();
  const result = { source, frames };
  compiled.set(plan, new WeakRef(result));
  return result;
}

function evaluate(segment: Compiled, context: unknown): unknown {
  // Most binds return a raw primitive and need no suspended segment at all.
  const pending: { segment: Compiled; index: number }[] = [];
  let index = 0;
  let value = segment.source(context);
  while (true) {
    if (index === segment.frames.length) {
      const previous = pending.pop();
      if (previous === undefined) return value;
      segment = previous.segment;
      index = previous.index;
      continue;
    }
    const frame = segment.frames[index++];
    switch (frame.tag) {
      case "map":
        value = frame.apply(value);
        break;
      case "bind": {
        const [source, next_context] = frame.apply(value, context);
        context = next_context;
        const plan = plans.get(source);
        if (plan === undefined) value = source(context);
        else {
          pending.push({ segment, index });
          segment = compile(plan);
          index = 0;
          value = segment.source(context);
        }
        break;
      }
    }
  }
}
