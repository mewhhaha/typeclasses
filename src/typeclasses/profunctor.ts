import {
  type AppliedData,
  call_typeclass_method,
  type Data,
  type DataType,
  type Dictionary,
  type type_data,
  type type_item,
  type Typeclass,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";

export const profunctor_typeclass = Symbol("Profunctor");
export declare const profunctor_input: unique symbol;
export declare const profunctor_context: unique symbol;

export interface ProfunctorContext extends DataType {
  readonly [type_data]: Dictionary;
}

type SameProfunctorContext<dictionary extends Dictionary> = {
  readonly [type_item]: unknown;
  readonly [type_data]: dictionary;
};

type ProfunctorDefinition = Dictionary & {
  readonly [profunctor_input]: unknown;
  readonly [profunctor_context]: ProfunctorContext;
  readonly [profunctor_typeclass]: object;
};

type ProfunctorInput<dictionary extends ProfunctorDefinition> =
  dictionary[typeof profunctor_input];

type ProfunctorContextOf<dictionary extends ProfunctorDefinition> =
  dictionary[typeof profunctor_context];

type ProfunctorImplementation<dictionary extends ProfunctorDefinition> = {
  dimap: <to, next_input, next_to>(
    this: Data<dictionary, to>,
    input: (value: next_input) => ProfunctorInput<dictionary>,
    output: (value: to) => next_to,
  ) => Data<
    AppliedData<ProfunctorContextOf<dictionary>, next_input>,
    next_to
  >;
};

export interface Profunctor<
  dictionary extends Dictionary,
  input = unknown,
  context extends ProfunctorContext = SameProfunctorContext<dictionary>,
> extends
  TypeclassDictionary<
    dictionary,
    typeof profunctor_typeclass,
    {
      dimap: <to, next_input, next_to>(
        this: Data<dictionary, to>,
        input: (value: next_input) => input,
        output: (value: to) => next_to,
      ) => Data<AppliedData<context, next_input>, next_to>;
    }
  > {
  readonly [profunctor_input]: input;
  readonly [profunctor_context]: context;
}

type ProfunctorTypeclass = Typeclass<typeof profunctor_typeclass, {
  dimap<
    dictionary extends ProfunctorDefinition,
    to,
    next_input,
    next_to,
  >(
    value: Data<dictionary, to>,
    map_input: (value: next_input) => ProfunctorInput<dictionary>,
    map_output: (value: to) => next_to,
  ): Data<
    AppliedData<ProfunctorContextOf<dictionary>, next_input>,
    next_to
  >;
  lmap<dictionary extends ProfunctorDefinition, to, next_input>(
    value: Data<dictionary, to>,
    map_input: (value: next_input) => ProfunctorInput<dictionary>,
  ): Data<AppliedData<ProfunctorContextOf<dictionary>, next_input>, to>;
  rmap<dictionary extends ProfunctorDefinition, to, next_to>(
    value: Data<dictionary, to>,
    map_output: (value: to) => next_to,
  ): Data<
    AppliedData<
      ProfunctorContextOf<dictionary>,
      ProfunctorInput<dictionary>
    >,
    next_to
  >;
}>;

export const Profunctor: ProfunctorTypeclass = typeclass(
  profunctor_typeclass,
  {
    dimap<
      dictionary extends ProfunctorDefinition,
      to,
      next_input,
      next_to,
    >(
      value: Data<dictionary, to>,
      map_input: (value: next_input) => ProfunctorInput<dictionary>,
      map_output: (value: to) => next_to,
    ): Data<
      AppliedData<ProfunctorContextOf<dictionary>, next_input>,
      next_to
    > {
      const implementation =
        value[profunctor_typeclass] as unknown as ProfunctorImplementation<
          dictionary
        >;

      return call_typeclass_method(
        implementation.dimap<to, next_input, next_to>,
        value,
        map_input,
        map_output,
      );
    },

    lmap<dictionary extends ProfunctorDefinition, to, next_input>(
      value: Data<dictionary, to>,
      map_input: (value: next_input) => ProfunctorInput<dictionary>,
    ): Data<AppliedData<ProfunctorContextOf<dictionary>, next_input>, to> {
      return this.dimap(value, map_input, identity);
    },

    rmap<dictionary extends ProfunctorDefinition, to, next_to>(
      value: Data<dictionary, to>,
      map_output: (value: to) => next_to,
    ): Data<
      AppliedData<
        ProfunctorContextOf<dictionary>,
        ProfunctorInput<dictionary>
      >,
      next_to
    > {
      return this.dimap(
        value,
        identity<ProfunctorInput<dictionary>>,
        map_output,
      );
    },
  },
);

function identity<item>(value: item): item {
  return value;
}
