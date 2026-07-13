import {
  call_typeclass_method,
  type Data,
  type Dictionary,
  type Typeclass,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";
import type { Monad as MonadDictionary } from "./monad.ts";

/** Runtime token for the MonadError typeclass. */
export const monad_error_typeclass = Symbol("MonadError");
/** Phantom key for a MonadError dictionary's associated error type. */
export declare const monad_error_error: unique symbol;

/** @ignore */
export type MonadErrorImplementation<dictionary extends Dictionary, error> = {
  throw_error: <item>(
    this: dictionary,
    error: error,
  ) => Data<dictionary, item>;
  catch_error: <item>(
    this: Data<dictionary, item>,
    handler: (error: error) => Data<dictionary, item>,
  ) => Data<dictionary, item>;
};

/** Monad dictionary capability for throwing and recovering typed errors. */
export interface MonadError<dictionary extends Dictionary, error = unknown>
  extends
    TypeclassDictionary<
      dictionary,
      typeof monad_error_typeclass,
      MonadErrorImplementation<dictionary, error>
    >,
    MonadDictionary<dictionary> {
  /** Error type associated with this dictionary. */
  readonly [monad_error_error]: error;
}

/** Structural constraint accepted by generic MonadError operations. */
export type MonadErrorDictionary = Dictionary & {
  readonly [monad_error_error]: unknown;
  readonly [monad_error_typeclass]: object;
};

/** Extract the error type associated with a MonadError dictionary. */
export type MonadErrorType<dictionary extends MonadErrorDictionary> =
  dictionary[typeof monad_error_error];

/** @ignore */
export type MonadErrorTypeclass = Typeclass<typeof monad_error_typeclass, {
  throw_error<dictionary extends MonadErrorDictionary, item>(
    witness: Data<dictionary, unknown>,
    error: MonadErrorType<dictionary>,
  ): Data<dictionary, item>;
  throw_error<dictionary extends MonadErrorDictionary, item>(
    dictionary: dictionary,
    error: MonadErrorType<dictionary>,
  ): Data<dictionary, item>;
  catch_error<dictionary extends MonadErrorDictionary, item>(
    value: Data<dictionary, item>,
    handler: (
      error: MonadErrorType<dictionary>,
    ) => Data<dictionary, item>,
  ): Data<dictionary, item>;
}>;

/** Operations for throwing and recovering typed monadic errors. */
export const MonadError: MonadErrorTypeclass = typeclass(
  monad_error_typeclass,
  {
    throw_error<dictionary extends MonadErrorDictionary, item>(
      witness: dictionary | Data<dictionary, unknown>,
      error: MonadErrorType<dictionary>,
    ): Data<dictionary, item> {
      const implementation = this.instance_for(
        witness,
      ) as MonadErrorImplementation<dictionary, MonadErrorType<dictionary>>;

      return call_typeclass_method(
        implementation.throw_error<item>,
        witness as dictionary,
        error,
      );
    },

    catch_error<dictionary extends MonadErrorDictionary, item>(
      value: Data<dictionary, item>,
      handler: (
        error: MonadErrorType<dictionary>,
      ) => Data<dictionary, item>,
    ): Data<dictionary, item> {
      const implementation = this.instance_for(
        value,
      ) as MonadErrorImplementation<dictionary, MonadErrorType<dictionary>>;

      return call_typeclass_method(
        implementation.catch_error<item>,
        value,
        handler,
      );
    },
  },
);
