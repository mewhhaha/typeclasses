import type { LoopStep } from "../loop.ts";
import {
  type Data,
  type Dictionary,
  instance_for_token,
  type Typeclass,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";
import type { Monad as MonadDictionary } from "./monad.ts";

/** Runtime token for the MonadRec typeclass. */
export const monad_rec_typeclass = /* @__PURE__ */ Symbol("MonadRec");

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
export const MonadRec: MonadRecTypeclass = /* @__PURE__ */ typeclass(
  monad_rec_typeclass,
  {
    tail_rec_m<dictionary extends Dictionary, state, output>(
      dictionary: MonadRec<dictionary>,
      initial: state,
      step: (state: state) => Data<dictionary, LoopStep<state, output>>,
    ): Data<dictionary, output> {
      return (instance_for_token(monad_rec_typeclass, dictionary)
        .tail_rec_m<state, output>).call(
          dictionary as unknown as dictionary,
          initial,
          step,
        );
    },
  },
);
