import type { LoopStep } from "../loop.ts";
import {
  call_typeclass_method,
  type Data,
  type Dictionary,
  type Typeclass,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";
import type { Monad as MonadDictionary } from "./monad.ts";

/** Runtime token for the MonadRec typeclass. */
export const monad_rec_typeclass = Symbol("MonadRec");

/** Monad capability for recursion without growing the JavaScript stack. */
export interface MonadRec<dictionary extends Dictionary>
  extends
    TypeclassDictionary<
      dictionary,
      typeof monad_rec_typeclass,
      {
        tail_rec_m: <state, output>(
          this: dictionary,
          initial: state,
          step: (
            state: state,
          ) => Data<dictionary, LoopStep<state, output>>,
        ) => Data<dictionary, output>;
      }
    >,
    MonadDictionary<dictionary> {}

/** @ignore */
export type MonadRecTypeclass = Typeclass<
  typeof monad_rec_typeclass,
  {
    tail_rec_m<dictionary extends Dictionary, state, output>(
      dictionary: MonadRec<dictionary>,
      initial: state,
      step: (state: state) => Data<dictionary, LoopStep<state, output>>,
    ): Data<dictionary, output>;
  }
>;

/** Operations for stack-safe recursive monadic computations. */
export const MonadRec: MonadRecTypeclass = typeclass(monad_rec_typeclass, {
  tail_rec_m<dictionary extends Dictionary, state, output>(
    dictionary: MonadRec<dictionary>,
    initial: state,
    step: (state: state) => Data<dictionary, LoopStep<state, output>>,
  ): Data<dictionary, output> {
    return call_typeclass_method(
      this.instance_for(dictionary).tail_rec_m<state, output>,
      dictionary as unknown as dictionary,
      initial,
      step,
    );
  },
});
