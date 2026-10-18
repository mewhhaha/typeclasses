// Persistent Reader/State composition. Compile the requested static segment once;
// execution cursors belong to the invocation, so recursive runs remain isolated.
type Raw = (context: unknown) => unknown;
type Frame =
  | {
    readonly tag: "map" | "state_map";
    readonly apply: (value: unknown) => unknown;
  }
  | { readonly tag: "state_bind"; readonly apply: (value: unknown) => Raw }
  | {
    readonly tag: "bind";
    readonly apply: (
      value: unknown,
      context: unknown,
    ) => readonly [Raw, unknown];
  };
type Plan = { readonly source: Raw; readonly frame: Frame };
type Compiled = {
  readonly source: Raw;
  readonly frames: readonly Frame[];
  readonly state: boolean;
};
const plans = new WeakMap<Raw, Plan>();
// Only the bounded hot cache owns flattened arrays. WeakRefs would keep newly
// flattened prefixes alive until the job ends, producing quadratic peak memory.

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

/** @ignore State-specific frames keep value and state in invocation-local registers. */
export function map_state_computation<state, from, to>(
  source: (state: state) => readonly [from, state],
  fn: (value: from) => to,
): (state: state) => readonly [to, state] {
  return compose(source as Raw, {
    tag: "state_map",
    apply: fn as (value: unknown) => unknown,
  }) as (state: state) => readonly [to, state];
}
/** @ignore */
export function bind_state_computation<state, from, to>(
  source: (state: state) => readonly [from, state],
  fn: (value: from) => (state: state) => readonly [to, state],
): (state: state) => readonly [to, state] {
  return compose(source as Raw, {
    tag: "state_bind",
    apply: fn as (value: unknown) => Raw,
  }) as (state: state) => readonly [to, state];
}

function compose(source: Raw, frame: Frame): Raw {
  const plan = { source, frame };
  const composed: Raw = (context) => evaluate(compile(plan), context);
  plans.set(composed, plan);
  return composed;
}

function is_state_frame(frame: Frame): boolean {
  return frame.tag === "state_map" || frame.tag === "state_bind";
}
function compile(plan: Plan): Compiled {
  const cached = hot.get(plan);
  if (cached !== undefined) {
    retain_hot(plan, cached);
    return cached;
  }
  const state = is_state_frame(plan.frame);
  const frames = [plan.frame];
  let source = plan.source;
  let nested = plans.get(source);
  while (nested !== undefined && is_state_frame(nested.frame) === state) {
    frames.push(nested.frame);
    source = nested.source;
    nested = plans.get(source);
  }
  frames.reverse();
  const result = { source, frames, state };
  retain_hot(plan, result);
  return result;
}

// Bound strong retention by total frames, making hot plans stable across GC.
// Segments larger than the budget compile per run; active runs own their arrays.
const hot = new Map<Plan, Compiled>();
let hot_frames = 0;
function retain_hot(plan: Plan, segment: Compiled): void {
  if (hot.has(plan) || segment.frames.length > 4096) return;
  hot.set(plan, segment);
  hot_frames += segment.frames.length;
  while (hot_frames > 4096) {
    const oldest = hot.entries().next().value!;
    hot.delete(oldest[0]);
    hot_frames -= oldest[1].frames.length;
  }
}

function evaluate(segment: Compiled, context: unknown): unknown {
  // Most binds return a raw primitive and need no suspended segment at all.
  const pending: { segment: Compiled; index: number }[] = [];
  let index = 0;
  let value = segment.source(context);
  if (segment.state) [value, context] = value as readonly [unknown, unknown];
  while (true) {
    if (index === segment.frames.length) {
      const previous = pending.pop();
      if (previous === undefined) {
        if (segment.state) return [value, context];
        return value;
      }
      segment = previous.segment;
      index = previous.index;
      continue;
    }
    const frame = segment.frames[index++];
    switch (frame.tag) {
      case "map":
      case "state_map":
        value = frame.apply(value);
        break;
      case "state_bind": {
        const source = frame.apply(value);
        const plan = plans.get(source);
        if (plan === undefined || !is_state_frame(plan.frame)) {
          [value, context] = source(context) as readonly [unknown, unknown];
        } else {
          pending.push({ segment, index });
          segment = compile(plan);
          index = 0;
          [value, context] = segment.source(context) as readonly [
            unknown,
            unknown,
          ];
        }
        break;
      }
      case "bind": {
        const [source, next_context] = frame.apply(value, context);
        context = next_context;
        const plan = plans.get(source);
        if (plan === undefined || is_state_frame(plan.frame)) {
          value = source(context);
        } else {
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
