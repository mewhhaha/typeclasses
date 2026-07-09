import {
  call_typeclass_method,
  type Data,
  type Dictionary,
  type Typeclass,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";
import type { Monad as MonadDictionary } from "./monad.ts";

export const monad_error_typeclass = Symbol("MonadError");

export interface MonadError<dictionary extends Dictionary>
  extends
    TypeclassDictionary<
      dictionary,
      typeof monad_error_typeclass,
      {
        throw_error: <item>(
          this: dictionary,
          error: unknown,
        ) => Data<dictionary, item>;
        catch_error: <item>(
          this: Data<dictionary, item>,
          handler: (error: unknown) => Data<dictionary, item>,
        ) => Data<dictionary, item>;
      }
    >,
    MonadDictionary<dictionary> {}

type MonadErrorTypeclass = Typeclass<typeof monad_error_typeclass, {
  throw_error<dictionary extends MonadError<dictionary>, item>(
    witness: Data<dictionary, unknown>,
    error: unknown,
  ): Data<dictionary, item>;
  throw_error<dictionary extends MonadError<dictionary>, item>(
    dictionary: MonadError<dictionary>,
    error: unknown,
  ): Data<dictionary, item>;
  catch_error<dictionary extends MonadError<dictionary>, item>(
    value: Data<dictionary, item>,
    handler: (error: unknown) => Data<dictionary, item>,
  ): Data<dictionary, item>;
}>;

export const MonadError: MonadErrorTypeclass = typeclass(
  monad_error_typeclass,
  {
    throw_error<
      dictionary extends MonadError<dictionary>,
      item,
    >(
      witness: dictionary | Data<dictionary, unknown>,
      error: unknown,
    ): Data<dictionary, item> {
      return call_typeclass_method(
        this.instance_for(witness).throw_error<item>,
        witness as dictionary,
        error,
      );
    },

    catch_error<
      dictionary extends MonadError<dictionary>,
      item,
    >(
      value: Data<dictionary, item>,
      handler: (error: unknown) => Data<dictionary, item>,
    ): Data<dictionary, item> {
      return call_typeclass_method(
        this.instance_for(value).catch_error<item>,
        value,
        handler,
      );
    },
  },
);
