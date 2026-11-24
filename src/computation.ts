// Persistent Reader/State composition. Compile the requested static segment once;
// execution cursors belong to the invocation, so recursive runs remain isolated.
type Raw = (context: unknown) => unknown;
type Frame =
  | {
    readonly tag: "map" | "state_map";
    readonly apply: (value: unknown) => unknown;
  }
  | {
    readonly tag: "reader_bind" | "state_bind";
    readonly apply: (value: unknown) => Raw;
  }
  | {
    readonly tag: "bind";
    readonly apply: (
      value: unknown,
      context: unknown,
    ) => readonly [Raw, unknown];
  };
type Plan = { readonly source: Raw; readonly frame: Frame; runs: number };
type Compiled = {
  readonly source: Raw;
  readonly frames: readonly Frame[];
  readonly state: boolean;
};
const computation_plan = Symbol("Computation.plan");
type PlannedRaw = Raw & { [computation_plan]?: Plan };

function plan_of(fn: Raw): Plan | undefined {
  return (fn as PlannedRaw)[computation_plan];
}

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

/** @ignore Reader-specific bind avoids allocating a [next, env] tuple per step. */
export function bind_reader_computation<context, from, to>(
  source: (context: context) => from,
  fn: (value: from) => (context: context) => to,
): (context: context) => to {
  return compose(source as Raw, {
    tag: "reader_bind",
    apply: fn as (value: unknown) => Raw,
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
  const plan: Plan = { source, frame, runs: 0 };
  const composed: PlannedRaw = (context) => run_plan(plan, context);
  composed[computation_plan] = plan;
  return composed;
}

function is_state_frame(frame: Frame): boolean {
  return frame.tag === "state_map" || frame.tag === "state_bind";
}

function run_plan(initial_plan: Plan, initial_context: unknown): unknown {
  let plan = initial_plan;
  let context = initial_context;
  while (true) {
    const state = is_state_frame(plan.frame);
    const source_plan = plan_of(plan.source);
    if (
      source_plan !== undefined &&
      is_state_frame(source_plan.frame) === state
    ) {
      return evaluate(compile(plan), context);
    }
    const frame = plan.frame;
    switch (frame.tag) {
      case "map":
        return frame.apply(plan.source(context));
      case "state_map": {
        const [value, next_state] = plan.source(context) as readonly [
          unknown,
          unknown,
        ];
        return [frame.apply(value), next_state];
      }
      case "reader_bind": {
        const next = frame.apply(plan.source(context));
        const next_plan = plan_of(next);
        if (next_plan === undefined || is_state_frame(next_plan.frame)) {
          return next(context);
        }
        plan = next_plan;
        continue;
      }
      case "state_bind": {
        const [value, next_state] = plan.source(context) as readonly [
          unknown,
          unknown,
        ];
        context = next_state;
        const next = frame.apply(value);
        const next_plan = plan_of(next);
        if (next_plan === undefined || !is_state_frame(next_plan.frame)) {
          return next(context);
        }
        plan = next_plan;
        continue;
      }
      case "bind": {
        const [next, next_context] = frame.apply(plan.source(context), context);
        context = next_context;
        const next_plan = plan_of(next);
        if (next_plan === undefined || is_state_frame(next_plan.frame)) {
          return next(context);
        }
        plan = next_plan;
        continue;
      }
    }
  }
}

function compile(plan: Plan): Compiled {
  const cached = hot.get(plan);
  if (cached !== undefined) {
    return cached;
  }
  const state = is_state_frame(plan.frame);
  const frames = [plan.frame];
  let source = plan.source;
  let nested = plan_of(source);
  while (nested !== undefined && is_state_frame(nested.frame) === state) {
    frames.push(nested.frame);
    source = nested.source;
    nested = plan_of(source);
  }
  frames.reverse();
  const result = { source, frames, state };
  plan.runs += 1;
  // Cache deep plans immediately (for forced-GC stability) and small plans
  // once reused so single-shot construct+run chains do not thrash the cache.
  if (frames.length >= 16 || plan.runs >= 2) {
    retain_hot(plan, result);
  }
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
  let pending: { segment: Compiled; index: number }[] | undefined;
  let index = 0;
  let value = segment.source(context);
  if (segment.state) [value, context] = value as readonly [unknown, unknown];
  while (true) {
    if (index === segment.frames.length) {
      const previous = pending?.pop();
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
        const plan = plan_of(source);
        if (plan === undefined || !is_state_frame(plan.frame)) {
          [value, context] = source(context) as readonly [unknown, unknown];
        } else {
          if (index < segment.frames.length) {
            pending ??= [];
            pending.push({ segment, index });
          }
          segment = compile(plan);
          index = 0;
          [value, context] = segment.source(context) as readonly [
            unknown,
            unknown,
          ];
        }
        break;
      }
      case "reader_bind": {
        const source = frame.apply(value);
        const plan = plan_of(source);
        if (plan === undefined || is_state_frame(plan.frame)) {
          value = source(context);
        } else {
          if (index < segment.frames.length) {
            pending ??= [];
            pending.push({ segment, index });
          }
          segment = compile(plan);
          index = 0;
          value = segment.source(context);
        }
        break;
      }
      case "bind": {
        const [source, next_context] = frame.apply(value, context);
        context = next_context;
        const plan = plan_of(source);
        if (plan === undefined || is_state_frame(plan.frame)) {
          value = source(context);
        } else {
          if (index < segment.frames.length) {
            pending ??= [];
            pending.push({ segment, index });
          }
          segment = compile(plan);
          index = 0;
          value = segment.source(context);
        }
        break;
      }
    }
  }
}
