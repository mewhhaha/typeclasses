import type {
  CallExpression,
  Expression,
  IdentifierReference,
  Node,
  Program,
} from "oxc-parser";
import type { create_binding_analysis } from "./transform_bindings.ts";

/** A source location and explanation for a construct that was not lowered. */
export type TransformDiagnostic = {
  readonly file_name: string;
  readonly line: number;
  readonly column: number;
  readonly message: string;
};
/** A version 3 source map from rewritten TypeScript back to its input. */
export type TransformSourceMap = {
  readonly version: 3;
  readonly file: string;
  readonly sourceRoot: string;
  readonly sources: readonly string[];
  readonly sourcesContent?: readonly (string | null)[];
  readonly names: readonly string[];
  readonly mappings: string;
};
/** One optimization decision at an original source location. */
export type TransformReport = TransformDiagnostic & {
  readonly outcome: "transformed" | "preserved";
  readonly optimization:
    | "generator"
    | "terminal"
    | "terminal-body"
    | "iterable-map"
    | "flatten"
    | "loop";
};
/** The rewritten TypeScript, its source map, and transformation diagnostics. */
export type TransformResult = {
  readonly code: string;
  readonly diagnostics: readonly TransformDiagnostic[];
  readonly map: TransformSourceMap | null;
  readonly transformed: number;
  readonly reports: readonly TransformReport[];
};
/** Recognized package entrypoints, source-map behavior and lowering controls. */
export type TransformConfig = {
  readonly source_map?: boolean;
  readonly explain?: boolean;
  readonly optimizations?: Partial<
    Record<
      | "generator"
      | "terminal"
      | "terminal_body"
      | "interpreter"
      | "iterable_map"
      | "loop"
      | "flatten"
      | "candidate_scan",
      boolean
    >
  >;
  readonly library_specifiers?: readonly string[];
  readonly terminal_library_specifiers?: readonly string[];
};
export type TransformKind = "do" | "program";
export type TerminalFunctionName =
  | "run"
  | "run_reader"
  | "run_state"
  | "run_writer"
  | "run_except"
  | "run_reader_terminal"
  | "run_state_terminal"
  | "run_writer_terminal";
export type PrimitiveFunctionName =
  | "ask"
  | "asks"
  | "get"
  | "gets"
  | "put"
  | "modify"
  | "writer"
  | "tell";
export type ExceptPrimitiveName =
  | "fail"
  | "from_either"
  | "from_maybe"
  | "from_nullable"
  | "from_validation";
export type StateEvalName = "eval_state" | "exec_state";
export type OperationRunnerName = "handle_operations" | "prepare_operations";
export type OperationHelperName = "operation" | "send" | "pure";
export type CellFactoryKind = "reader" | "state" | "writer";
export type CellRunnerName =
  | "run_cells"
  | "prepare_cells"
  | "handle_cells"
  | "prepare_handle_cells";
export type StmPrimitiveName =
  | "read_tvar"
  | "write_tvar"
  | "modify_tvar"
  | "retry"
  | "abort"
  | "or_else";
export type ImportedBindings = {
  readonly do_names: ReadonlySet<string>;
  readonly program_names: ReadonlySet<string>;
  readonly effect_names: ReadonlySet<string>;
  readonly namespaces: ReadonlySet<string>;
  readonly terminal_functions: ReadonlyMap<
    string,
    { readonly imported: TerminalFunctionName }
  >;
  readonly terminal_namespaces: ReadonlyMap<
    string,
    ReadonlySet<TerminalFunctionName>
  >;
  readonly primitive_functions: ReadonlyMap<string, PrimitiveFunctionName>;
  readonly primitive_namespaces: ReadonlyMap<
    string,
    ReadonlySet<PrimitiveFunctionName>
  >;
  readonly except_primitives?: ReadonlyMap<string, ExceptPrimitiveName>;
  readonly except_namespaces?: ReadonlyMap<
    string,
    ReadonlySet<ExceptPrimitiveName>
  >;
  readonly state_eval_functions?: ReadonlyMap<string, StateEvalName>;
  readonly state_eval_namespaces?: ReadonlyMap<
    string,
    ReadonlySet<StateEvalName>
  >;
  readonly operation_runners?: ReadonlyMap<string, OperationRunnerName>;
  readonly operation_runner_namespaces?: ReadonlyMap<
    string,
    ReadonlySet<OperationRunnerName>
  >;
  readonly operation_helpers?: ReadonlyMap<string, OperationHelperName>;
  readonly cell_factories?: ReadonlyMap<string, CellFactoryKind>;
  readonly cell_namespaces?: ReadonlyMap<string, ReadonlySet<CellFactoryKind>>;
  readonly cell_runners?: ReadonlyMap<string, CellRunnerName>;
  readonly cell_runner_namespaces?: ReadonlyMap<
    string,
    ReadonlySet<CellRunnerName>
  >;
  readonly cell_providers?: ReadonlyMap<string, CellFactoryKind>;
  readonly cell_provider_namespaces?: ReadonlyMap<
    string,
    ReadonlySet<CellFactoryKind>
  >;
  readonly direct_maybe_dictionaries?: ReadonlySet<string>;
  readonly just_constructors?: ReadonlySet<string>;
  readonly nothing_constructors?: ReadonlySet<string>;
  readonly from_nullable_functions?: ReadonlySet<string>;
  readonly from_maybe_functions?: ReadonlySet<string>;
  readonly to_nullable_functions?: ReadonlySet<string>;
  readonly maybe_get_or_else_functions?: ReadonlySet<string>;
  readonly maybe_fold_functions?: ReadonlySet<string>;
  readonly maybe_filter_functions?: ReadonlySet<string>;
  readonly maybe_to_either_functions?: ReadonlySet<string>;
  readonly direct_either_dictionaries?: ReadonlySet<string>;
  readonly left_constructors?: ReadonlySet<string>;
  readonly right_constructors?: ReadonlySet<string>;
  readonly either_fold_functions?: ReadonlySet<string>;
  readonly either_from_right_functions?: ReadonlySet<string>;
  readonly either_from_left_functions?: ReadonlySet<string>;
  readonly either_recover_functions?: ReadonlySet<string>;
  readonly either_hush_functions?: ReadonlySet<string>;
  readonly either_note_functions?: ReadonlySet<string>;
  readonly either_from_number_functions?: ReadonlySet<string>;
  readonly either_try_catch_functions?: ReadonlySet<string>;
  readonly either_is_left_functions?: ReadonlySet<string>;
  readonly either_is_right_functions?: ReadonlySet<string>;
  readonly either_map_left_functions?: ReadonlySet<string>;
  readonly either_bind_widen_functions?: ReadonlySet<string>;
  readonly direct_identity_dictionaries?: ReadonlySet<string>;
  readonly identity_constructors?: ReadonlySet<string>;
  readonly array_constructors?: ReadonlySet<string>;
  readonly array_from_array_functions?: ReadonlySet<string>;
  readonly array_view_functions?: ReadonlySet<string>;
  readonly array_to_array_functions?: ReadonlySet<string>;
  readonly array_indexed_functions?: ReadonlySet<string>;
  readonly array_flat_map_streaming_functions?: ReadonlySet<string>;
  readonly array_namespaces?: ReadonlySet<string>;
  readonly typed_array_constructors?: ReadonlySet<string>;
  readonly set_constructors?: ReadonlySet<string>;
  readonly map_constructors?: ReadonlySet<string>;
  readonly record_constructors?: ReadonlySet<string>;
  readonly foldable_objects?: ReadonlySet<string>;
  readonly foldable_namespaces?: ReadonlySet<string>;
  readonly alternative_objects?: ReadonlySet<string>;
  readonly alternative_namespaces?: ReadonlySet<string>;
  readonly bifunctor_objects?: ReadonlySet<string>;
  readonly bifunctor_namespaces?: ReadonlySet<string>;
  readonly monad_error_objects?: ReadonlySet<string>;
  readonly monad_error_namespaces?: ReadonlySet<string>;
  readonly stm_dictionaries?: ReadonlySet<string>;
  readonly stm_namespaces?: ReadonlySet<string>;
  readonly stm_atomically_functions?: ReadonlySet<string>;
  readonly stm_primitive_functions?: ReadonlyMap<string, StmPrimitiveName>;
  readonly stm_retry_classes?: ReadonlySet<string>;
  readonly stm_error_classes?: ReadonlySet<string>;
  readonly list_constructors?: ReadonlySet<string>;
  readonly list_from_array_functions?: ReadonlySet<string>;
  readonly list_to_array_functions?: ReadonlySet<string>;
  readonly list_namespaces?: ReadonlySet<string>;
  readonly nil_constructors?: ReadonlySet<string>;
  readonly cons_constructors?: ReadonlySet<string>;
  readonly direct_reader_dictionaries?: ReadonlySet<string>;
  readonly direct_state_dictionaries?: ReadonlySet<string>;
  readonly direct_writer_dictionaries?: ReadonlySet<string>;
  readonly parallel_task_dictionaries?: ReadonlySet<string>;
  readonly task_parallel_functions?: ReadonlySet<string>;
  readonly task_sequential_functions?: ReadonlySet<string>;
  readonly task_from_fn_functions?: ReadonlySet<string>;
  readonly task_from_promise_functions?: ReadonlySet<string>;
  readonly task_succeed_functions?: ReadonlySet<string>;
  readonly task_run_functions?: ReadonlySet<string>;
  readonly task_run_exit_functions?: ReadonlySet<string>;
  readonly task_traverse_functions?: ReadonlySet<string>;
  readonly task_is_cancellation_functions?: ReadonlySet<string>;
  readonly task_namespaces?: ReadonlySet<string>;
  readonly traversable_objects?: ReadonlySet<string>;
  readonly traversable_namespaces?: ReadonlySet<string>;
  readonly traverse_sequential_functions?: ReadonlySet<string>;
  readonly traverse_sequential_namespaces?: ReadonlySet<string>;
  readonly match_functions?: ReadonlySet<string>;
  readonly match_namespaces?: ReadonlySet<string>;
  readonly tagged_type_names?: ReadonlyMap<
    string,
    "maybe" | "either" | "validation" | "list"
  >;
  readonly validation_constructors?: ReadonlySet<string>;
  readonly direct_validation_dictionaries?: ReadonlySet<string>;
  readonly valid_constructors?: ReadonlySet<string>;
  readonly invalid_constructors?: ReadonlySet<string>;
  readonly invalid_messages_constructors?: ReadonlySet<string>;
  readonly validation_to_either_functions?: ReadonlySet<string>;
  readonly validation_map_error_functions?: ReadonlySet<string>;
  readonly collect_functions?: ReadonlySet<string>;
  readonly collect_namespaces?: ReadonlySet<string>;
  readonly applicative_objects?: ReadonlySet<string>;
  readonly applicative_namespaces?: ReadonlySet<string>;
  readonly prelude_fmap_functions?: ReadonlySet<string>;
  readonly prelude_bind_functions?: ReadonlySet<string>;
  readonly prelude_ap_functions?: ReadonlySet<string>;
  readonly prelude_lift_functions?: ReadonlySet<string>;
  readonly prelude_traverse_functions?: ReadonlySet<string>;
  readonly prelude_sequence_functions?: ReadonlySet<string>;
  readonly prelude_foldl_functions?: ReadonlySet<string>;
  readonly prelude_fold_while_functions?: ReadonlySet<string>;
  readonly prelude_some_functions?: ReadonlySet<string>;
  readonly prelude_find_functions?: ReadonlySet<string>;
  readonly prelude_to_array_functions?: ReadonlySet<string>;
  readonly prelude_length_functions?: ReadonlySet<string>;
  readonly prelude_sum_functions?: ReadonlySet<string>;
  readonly prelude_product_functions?: ReadonlySet<string>;
  readonly prelude_alt_functions?: ReadonlySet<string>;
  readonly prelude_concat_functions?: ReadonlySet<string>;
  readonly prelude_namespaces?: ReadonlySet<string>;
  readonly iterable_locals?: ReadonlySet<string>;
  readonly async_iterable_locals?: ReadonlySet<string>;
  readonly shadowed_names?: ReadonlySet<string>;
  readonly effect_helper_shadowed: boolean;
  readonly program_module?: string;
};

/** Shared Oxc syntax and lexical services used by lowering passes. */
export type TransformServices = {
  readonly program: Program;
  readonly source: string;
  readonly file_name: string;
  readonly config: TransformConfig;
  readonly bindings: ReturnType<typeof create_binding_analysis>;
  readonly imports: ImportedBindings;
  readonly program_scopes?: ReadonlySet<string>;
  readonly recursive_dictionaries: ReadonlySet<string>;
  readonly task_dictionaries: ReadonlySet<string>;
  fresh(prefix: string): IdentifierReference;
  diagnose(node: Node, message: string): void;
  report(
    node: Node,
    optimization: TransformReport["optimization"],
    outcome: TransformReport["outcome"],
    message: string,
  ): void;
  kind(call: CallExpression): TransformKind | undefined;
  effect(): Expression;
  loop(): IdentifierReference | undefined;
  flat_dictionary(expression: Expression): Expression | undefined;
  terminal(imported: string, source_local_name: string): IdentifierReference;
  import_from_module?(
    anchor_local: string,
    sub_module: string,
    imported: string,
  ): IdentifierReference | undefined;
  compile(call: CallExpression): Expression | undefined;
};
