/** @ignore */
export const loop_done = Symbol("loop.done");
/** @ignore */
export const loop_rec = Symbol("loop.rec");

/** A terminal loop step carrying the final output. */
export type LoopDone<output> = readonly [typeof loop_done, output];
/** A recursive loop step carrying the next state. */
export type LoopRec<state> = readonly [typeof loop_rec, state];
/** One result from a stack-safe loop body. */
export type LoopStep<state, output> = LoopDone<output> | LoopRec<state>;

/** Repeatedly evaluate a synchronous loop body without growing the stack. */
export function loop<state, output>(
  initial: state,
  step: (state: state) => LoopStep<state, output>,
): output {
  let state = initial;

  while (true) {
    const [tag, value] = step(state);

    switch (tag) {
      case loop_done:
        return value;
      case loop_rec:
        state = value;
        break;
    }
  }
}

/** Finish a loop with its final output. */
export function done<output>(value: output): LoopDone<output> {
  return [loop_done, value] as const;
}

/** Continue a loop with a new state. */
export function rec<state>(state: state): LoopRec<state> {
  return [loop_rec, state] as const;
}
