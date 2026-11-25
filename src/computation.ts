// Persistent Reader/State composition. Compile the requested static segment once;
// execution cursors belong to the invocation, so recursive runs remain isolated.
type Raw = (context: unknown) => unknown;
type WrappedRaw<raw> = { value(): raw };
type Plan =
  | {
    readonly tag: "map";
    readonly apply: (value: unknown) => unknown;
    readonly source: Raw;
    readonly state: false;
    runs: number;
    compiled: Compiled | undefined;
  }
  | {
    readonly tag: "state_map";
    readonly apply: (value: unknown) => unknown;
    readonly source: Raw;
    readonly state: true;
    runs: number;
    compiled: Compiled | undefined;
  }
  | {
    readonly tag: "reader_bind";
    readonly apply: (value: unknown) => WrappedRaw<Raw>;
    readonly source: Raw;
    readonly state: false;
    runs: number;
    compiled: Compiled | undefined;
  }
  | {
    readonly tag: "state_bind";
    readonly apply: (value: unknown) => WrappedRaw<Raw>;
    readonly source: Raw;
    readonly state: true;
    runs: number;
    compiled: Compiled | undefined;
  }
  | {
    readonly tag: "bind";
    readonly apply: (
      value: unknown,
      context: unknown,
    ) => readonly [Raw, unknown];
    readonly source: Raw;
    readonly state: false;
    runs: number;
    compiled: Compiled | undefined;
  };
type Compiled = {
  readonly source: Raw;
  readonly frames: readonly Plan[];
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
  return compose({
    tag: "map",
    apply: fn as (value: unknown) => unknown,
    source: source as Raw,
    state: false,
    runs: 0,
    compiled: undefined,
  }) as (context: context) => to;
}

export function bind_computation<context, from, to>(
  source: (context: context) => from,
  fn: (
    value: from,
    context: context,
  ) => readonly [(context: context) => to, context],
): (context: context) => to {
  return compose({
    tag: "bind",
    apply: fn as (value: unknown, context: unknown) => readonly [Raw, unknown],
    source: source as Raw,
    state: false,
    runs: 0,
    compiled: undefined,
  }) as (context: context) => to;
}

/** @ignore Reader-specific bind unwraps the returned Data wrapper directly. */
export function bind_reader_computation<context, from, to>(
  source: (context: context) => from,
  fn: (value: from) => WrappedRaw<(context: context) => to>,
): (context: context) => to {
  return compose({
    tag: "reader_bind",
    apply: fn as (value: unknown) => WrappedRaw<Raw>,
    source: source as Raw,
    state: false,
    runs: 0,
    compiled: undefined,
  }) as (context: context) => to;
}

/** @ignore State-specific frames keep value and state in invocation-local registers. */
export function map_state_computation<state, from, to>(
  source: (state: state) => readonly [from, state],
  fn: (value: from) => to,
): (state: state) => readonly [to, state] {
  return compose({
    tag: "state_map",
    apply: fn as (value: unknown) => unknown,
    source: source as Raw,
    state: true,
    runs: 0,
    compiled: undefined,
  }) as (state: state) => readonly [to, state];
}

/** @ignore */
export function bind_state_computation<state, from, to>(
  source: (state: state) => readonly [from, state],
  fn: (value: from) => WrappedRaw<(state: state) => readonly [to, state]>,
): (state: state) => readonly [to, state] {
  return compose({
    tag: "state_bind",
    apply: fn as (value: unknown) => WrappedRaw<Raw>,
    source: source as Raw,
    state: true,
    runs: 0,
    compiled: undefined,
  }) as (state: state) => readonly [to, state];
}

function compose(plan: Plan): Raw {
  const composed: PlannedRaw = (context) => run_plan(plan, context);
  composed[computation_plan] = plan;
  return composed;
}

function run_plan(initial_plan: Plan, initial_context: unknown): unknown {
  let plan = initial_plan;
  let context = initial_context;
  while (true) {
    const source_plan = plan_of(plan.source);
    if (source_plan !== undefined && source_plan.state === plan.state) {
      // 2-step left-associated fast path avoids compile() on cold/short chains.
      const grand_plan = plan_of(source_plan.source);
      if (
        (grand_plan === undefined || grand_plan.state !== plan.state) &&
        source_plan.tag !== "bind"
      ) {
        if (plan.state) {
          let [value, next_state] = source_plan.source(context) as readonly [
            unknown,
            unknown,
          ];
          if (source_plan.tag === "state_map") {
            value = source_plan.apply(value);
          } else {
            const mid = (source_plan as Extract<Plan, { tag: "state_bind" }>)
              .apply(
                value,
              ).value();
            const mid_plan = plan_of(mid);
            if (mid_plan === undefined || !mid_plan.state) {
              [value, next_state] = mid(next_state) as readonly [
                unknown,
                unknown,
              ];
            } else {
              return evaluate_state(compile(mid_plan), next_state, plan);
            }
          }
          if (plan.tag === "state_map") {
            return [plan.apply(value), next_state];
          }
          context = next_state;
          const next = (plan as Extract<Plan, { tag: "state_bind" }>)
            .apply(value).value();
          const next_plan = plan_of(next);
          if (next_plan === undefined || !next_plan.state) return next(context);
          plan = next_plan;
          continue;
        }
        let value = source_plan.source(context);
        if (source_plan.tag === "map") {
          value = source_plan.apply(value);
        } else {
          const mid = (source_plan as Extract<Plan, { tag: "reader_bind" }>)
            .apply(
              value,
            ).value();
          const mid_plan = plan_of(mid);
          if (mid_plan === undefined || mid_plan.state) {
            value = mid(context);
          } else {
            return evaluate_reader(compile(mid_plan), context, plan);
          }
        }
        switch (plan.tag) {
          case "map":
            return plan.apply(value);
          case "reader_bind": {
            const next = plan.apply(value).value();
            const next_plan = plan_of(next);
            if (next_plan === undefined || next_plan.state) {
              return next(context);
            }
            plan = next_plan;
            continue;
          }
          case "bind": {
            const [next, next_context] = plan.apply(value, context);
            context = next_context;
            const next_plan = plan_of(next);
            if (next_plan === undefined || next_plan.state) {
              return next(context);
            }
            plan = next_plan;
            continue;
          }
        }
      }
      const compiled = compile(plan);
      return compiled.state
        ? evaluate_state(compiled, context)
        : evaluate_reader(compiled, context);
    }
    switch (plan.tag) {
      case "map":
        return plan.apply(plan.source(context));
      case "state_map": {
        const [value, next_state] = plan.source(context) as readonly [
          unknown,
          unknown,
        ];
        return [plan.apply(value), next_state];
      }
      case "reader_bind": {
        const next = plan.apply(plan.source(context)).value();
        const next_plan = plan_of(next);
        if (next_plan === undefined || next_plan.state) return next(context);
        plan = next_plan;
        continue;
      }
      case "state_bind": {
        const [value, next_state] = plan.source(context) as readonly [
          unknown,
          unknown,
        ];
        context = next_state;
        const next = plan.apply(value).value();
        const next_plan = plan_of(next);
        if (next_plan === undefined || !next_plan.state) return next(context);
        plan = next_plan;
        continue;
      }
      case "bind": {
        const [next, next_context] = plan.apply(plan.source(context), context);
        context = next_context;
        const next_plan = plan_of(next);
        if (next_plan === undefined || next_plan.state) return next(context);
        plan = next_plan;
        continue;
      }
    }
  }
}

// Bound strong retention by total frames, making hot plans stable across GC.
// Reused plans exceeding 4096 frames cache weakly on plan.runs >= 2 so active
// chains do not recompile per run while unreachable plans free immediately.
const hot = new Map<Plan, Compiled>();
const large_hot = new WeakMap<Plan, Compiled>();
let hot_frames = 0;

function compile(plan: Plan): Compiled {
  const cached = plan.compiled;
  if (cached !== undefined) return cached;
  if (plan.runs >= 2) {
    const large = large_hot.get(plan);
    if (large !== undefined) return large;
  }
  const state = plan.state;
  // Frames are stored outer-to-inner and executed backwards (no reverse()).
  const frames: Plan[] = [plan];
  let source = plan.source;
  let nested = plan_of(source);
  while (nested !== undefined && nested.state === state) {
    frames.push(nested);
    source = nested.source;
    nested = plan_of(source);
  }
  const result: Compiled = { source, frames, state };
  plan.runs += 1;
  if (frames.length <= 4096) {
    if (frames.length >= 16 || plan.runs >= 2) {
      retain_hot(plan, result);
    }
  } else if (plan.runs >= 2) {
    large_hot.set(plan, result);
  }
  return result;
}

function retain_hot(plan: Plan, segment: Compiled): void {
  if (plan.compiled !== undefined || segment.frames.length > 4096) return;
  plan.compiled = segment;
  hot.set(plan, segment);
  hot_frames += segment.frames.length;
  while (hot_frames > 4096) {
    const oldest = hot.entries().next().value!;
    hot.delete(oldest[0]);
    oldest[0].compiled = undefined;
    hot_frames -= oldest[1].frames.length;
  }
}

function evaluate_state(
  initial_segment: Compiled,
  initial_state: unknown,
  after_plan?: Plan,
): readonly [unknown, unknown] {
  let segment = initial_segment;
  let frames = segment.frames;
  let index = frames.length - 1;
  let pending_seg: Compiled[] | undefined = after_plan !== undefined
    ? [{ source: after_plan.source, frames: [after_plan], state: true }]
    : undefined;
  let pending_idx: number[] | undefined = after_plan !== undefined
    ? [0]
    : undefined;
  let [value, state] = segment.source(initial_state) as readonly [
    unknown,
    unknown,
  ];
  while (true) {
    if (index < 0) {
      if (pending_seg === undefined || pending_seg.length === 0) {
        return [value, state];
      }
      segment = pending_seg.pop()!;
      frames = segment.frames;
      index = pending_idx!.pop()!;
      continue;
    }
    const frame = frames[index--];
    if (frame.tag === "state_map") {
      value = frame.apply(value);
      continue;
    }
    let source = (frame as Extract<Plan, { tag: "state_bind" }>)
      .apply(value).value();
    let plan = plan_of(source);
    while (true) {
      if (plan === undefined || !plan.state) {
        [value, state] = source(state) as readonly [unknown, unknown];
        break;
      }
      const inner_source_plan = plan_of(plan.source);
      if (inner_source_plan !== undefined && inner_source_plan.state) {
        if (index >= 0) {
          if (pending_seg === undefined) {
            pending_seg = [segment];
            pending_idx = [index];
          } else {
            pending_seg.push(segment);
            pending_idx!.push(index);
          }
        }
        segment = compile(plan);
        frames = segment.frames;
        index = frames.length - 1;
        [value, state] = segment.source(state) as readonly [unknown, unknown];
        break;
      }
      [value, state] = plan.source(state) as readonly [unknown, unknown];
      if (plan.tag === "state_map") {
        value = plan.apply(value);
        break;
      }
      source = (plan as Extract<Plan, { tag: "state_bind" }>)
        .apply(value).value();
      plan = plan_of(source);
    }
  }
}

function evaluate_reader(
  initial_segment: Compiled,
  initial_context: unknown,
  after_plan?: Plan,
): unknown {
  let segment = initial_segment;
  let frames = segment.frames;
  let index = frames.length - 1;
  let context = initial_context;
  let pending_seg: Compiled[] | undefined = after_plan !== undefined
    ? [{ source: after_plan.source, frames: [after_plan], state: false }]
    : undefined;
  let pending_idx: number[] | undefined = after_plan !== undefined
    ? [0]
    : undefined;
  let value = segment.source(context);
  while (true) {
    if (index < 0) {
      if (pending_seg === undefined || pending_seg.length === 0) {
        return value;
      }
      segment = pending_seg.pop()!;
      frames = segment.frames;
      index = pending_idx!.pop()!;
      continue;
    }
    const frame = frames[index--];
    switch (frame.tag) {
      case "map":
        value = frame.apply(value);
        break;
      case "reader_bind": {
        let source = frame.apply(value).value();
        let plan = plan_of(source);
        while (true) {
          if (plan === undefined || plan.state) {
            value = source(context);
            break;
          }
          const inner_source_plan = plan_of(plan.source);
          if (inner_source_plan !== undefined && !inner_source_plan.state) {
            if (index >= 0) {
              if (pending_seg === undefined) {
                pending_seg = [segment];
                pending_idx = [index];
              } else {
                pending_seg.push(segment);
                pending_idx!.push(index);
              }
            }
            segment = compile(plan);
            frames = segment.frames;
            index = frames.length - 1;
            value = segment.source(context);
            break;
          }
          if (plan.tag === "map") {
            value = plan.apply(plan.source(context));
            break;
          }
          if (plan.tag === "reader_bind") {
            source = plan.apply(plan.source(context)).value();
            plan = plan_of(source);
            continue;
          }
          const [next_source, next_context] =
            (plan as Extract<Plan, { tag: "bind" }>).apply(
              plan.source(context),
              context,
            );
          context = next_context;
          source = next_source;
          plan = plan_of(source);
        }
        break;
      }
      case "bind": {
        const [source, next_context] = frame.apply(value, context);
        context = next_context;
        const plan = plan_of(source);
        if (plan === undefined || plan.state) {
          value = source(context);
        } else {
          if (index >= 0) {
            if (pending_seg === undefined) {
              pending_seg = [segment];
              pending_idx = [index];
            } else {
              pending_seg.push(segment);
              pending_idx!.push(index);
            }
          }
          segment = compile(plan);
          frames = segment.frames;
          index = frames.length - 1;
          value = segment.source(context);
        }
        break;
      }
    }
  }
}
