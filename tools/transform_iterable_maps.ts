import type {
  ArrowFunctionExpression,
  CallExpression,
  Expression,
  Function,
  IdentifierReference,
  Node,
  ObjectProperty,
  Program,
  Statement,
  StaticMemberExpression,
  TSType,
  VariableDeclarator,
} from "oxc-parser";
import {
  arrow,
  block,
  call,
  id,
  literal,
  member,
  node,
  parameter,
  ret,
  type_ref,
  unwrap,
  value_visitor_keys,
  variable,
  walk,
} from "./transform_ast.ts";
import { create_binding_analysis } from "./transform_bindings.ts";

const constructors = new Set([
  "IterableT",
  "from_array",
  "from_array_view",
  "from_factory",
  "from_iterable",
  "from_snapshot",
  "filter",
  "filter_map",
  "take",
]);

type IterRootKind = "array" | "snapshot" | "factory";
type IterStage =
  | { readonly tag: "map"; readonly fn: Expression }
  | { readonly tag: "filter"; readonly fn: Expression }
  | { readonly tag: "filter_map"; readonly fn: Expression }
  | { readonly tag: "bind"; readonly fn: Expression }
  | { readonly tag: "take"; readonly count: Expression };
type IterRoot = { readonly kind: IterRootKind; readonly arg: Expression };
type IterTerminal =
  | {
    readonly kind: "to_array";
    readonly pipeline: Expression;
    readonly extra_take?: Expression;
  }
  | {
    readonly kind: "fold";
    readonly pipeline: Expression;
    readonly init: Expression;
    readonly step: Expression;
  }
  | {
    readonly kind: "fold_while";
    readonly pipeline: Expression;
    readonly init: Expression;
    readonly step: Expression;
  }
  | {
    readonly kind: "some" | "find";
    readonly pipeline: Expression;
    readonly pred: Expression;
  };

function root_kind_for(name: string): IterRootKind | undefined {
  switch (name) {
    case "from_array":
    case "from_array_view":
      return "array";
    case "from_iterable":
    case "from_snapshot":
      return "snapshot";
    case "from_factory":
    case "IterableT":
      return "factory";
  }
  return undefined;
}

/** @ignore */
export function might_contain_iterable_maps(
  source: string,
  check_unicode = true,
): boolean {
  if (check_unicode && source.includes("\\u")) return true;
  if (!source.includes("iterable") && !source.includes("IterableT")) {
    return false;
  }
  return /\.\s*(?:map|fold)\b/.test(source) ||
    source.includes("to_array") || source.includes("preview") ||
    source.includes("compile_fold") || source.includes("Foldable");
}

/** @ignore */
export function create_iterable_map_fusion(
  program: Program,
  library_specifiers: readonly string[] = [],
  analysis?: ReturnType<typeof create_binding_analysis>,
  fresh?: (name: string) => string,
  skip_statement?: (statement: Statement) => boolean,
  source?: string,
) {
  const functions = new Set<string>();
  const namespaces = new Set<string>();
  const roots = new Set<string>();
  const root_namespaces = new Set<string>();
  const root_locals = new Map<string, IterRootKind>();
  const stage_locals = new Map<string, "filter" | "filter_map" | "take">();
  const to_array_locals = new Set<string>();
  const preview_locals = new Set<string>();
  const compile_fold_locals = new Set<string>();
  const foldable_locals = new Set<string>();
  const foldable_namespaces = new Set<string>();
  const just_locals = new Set<string>();
  const nothing_locals = new Set<string>();

  for (const statement of program.body) {
    if (
      statement.type !== "ImportDeclaration" || statement.importKind === "type"
    ) continue;
    const specifier = statement.source.value;
    const module = source_module(specifier);
    const iterable = module === "iterable" ||
      /^(@mewhhaha\/typeclasses|jsr:@mewhhaha\/typeclasses(?:@[^/]+)?)\/iterable$/
        .test(specifier);
    const maybe_mod = module === "maybe" ||
      /^(@mewhhaha\/typeclasses|jsr:@mewhhaha\/typeclasses(?:@[^/]+)?)\/maybe$/
        .test(specifier);
    const root = module === "mod" || specifier === "@mewhhaha/typeclasses" ||
      /^jsr:@mewhhaha\/typeclasses(?:@[^/]+)?$/.test(specifier) ||
      library_specifiers.includes(specifier);
    const foldable_mod = root || module === "typeclasses" ||
      module === "foldable" ||
      /^(@mewhhaha\/typeclasses|jsr:@mewhhaha\/typeclasses(?:@[^/]+)?)\/(?:typeclasses|foldable)$/
        .test(specifier);
    if (!iterable && !root && !foldable_mod && !maybe_mod) continue;
    for (const binding of statement.specifiers) {
      if (binding.type === "ImportNamespaceSpecifier") {
        if (iterable) namespaces.add(binding.local.name);
        else if (root) {
          root_namespaces.add(binding.local.name);
          foldable_namespaces.add(binding.local.name);
        } else if (foldable_mod) {
          foldable_namespaces.add(binding.local.name);
        }
      } else if (
        binding.type === "ImportSpecifier" && binding.importKind !== "type"
      ) {
        let name: string;
        if (binding.imported.type === "Identifier") {
          name = binding.imported.name;
        } else name = binding.imported.value;
        if (iterable) {
          if (constructors.has(name)) functions.add(binding.local.name);
          const rk = root_kind_for(name);
          if (rk !== undefined) root_locals.set(binding.local.name, rk);
          if (name === "filter" || name === "filter_map" || name === "take") {
            stage_locals.set(binding.local.name, name);
          }
          if (name === "to_array") to_array_locals.add(binding.local.name);
          if (name === "preview") preview_locals.add(binding.local.name);
          if (name === "compile_fold") {
            compile_fold_locals.add(binding.local.name);
          }
        }
        if ((root || maybe_mod) && name === "Just") {
          just_locals.add(binding.local.name);
        }
        if ((root || maybe_mod) && name === "Nothing") {
          nothing_locals.add(binding.local.name);
        }
        if (root && name === "iterable") roots.add(binding.local.name);
        if (foldable_mod && name === "Foldable") {
          foldable_locals.add(binding.local.name);
        }
      }
    }
  }

  const enabled =
    functions.size + namespaces.size + roots.size + root_namespaces.size > 0;
  if (!enabled) {
    return {
      enabled: false,
      fuse(_current: CallExpression): Expression | undefined {
        return undefined;
      },
      helper_declaration(): Function | undefined {
        return undefined;
      },
      add_helper(file: Program): Program {
        return file;
      },
    };
  }

  const bindings = analysis ?? create_binding_analysis(program);
  const immutable = new Set<VariableDeclarator>();
  const callbacks = new Map<Node, Function | ArrowFunctionExpression>();
  const writes = new Set<Node>();
  const collect_names = fresh === undefined;
  const used_names = new Set<string>();
  const skipped_stmts: Statement[] = [];
  const fn_write_checked = new Map<Node, boolean>();

  function mark_write(target: Node): void {
    if (target.type === "Identifier") {
      const declaration = bindings.resolve(target);
      if (declaration !== null) writes.add(declaration);
    } else if (
      target.type === "ObjectPattern" || target.type === "ArrayPattern" ||
      target.type === "AssignmentPattern" || target.type === "RestElement"
    ) {
      walk(target, (child) => {
        if (child.type === "MemberExpression") return false;
        if (child.type === "Identifier") {
          const declaration = bindings.resolve(child);
          if (declaration !== null) writes.add(declaration);
        }
      });
    }
  }

  const observe = (current: Node) => {
    if (collect_names && current.type === "Identifier") {
      used_names.add(current.name);
    }
    if (current.type === "VariableDeclaration" && current.kind === "const") {
      for (const declaration of current.declarations) {
        if (declaration.id.type !== "Identifier" || declaration.init === null) {
          continue;
        }
        immutable.add(declaration);
        const initial = unwrap(declaration.init);
        if (
          initial.type === "ArrowFunctionExpression" ||
          initial.type === "FunctionExpression"
        ) callbacks.set(declaration, initial);
      }
    }
    if (current.type === "FunctionDeclaration" && current.id !== null) {
      callbacks.set(current, current);
    }
    if (current.type === "AssignmentExpression") mark_write(current.left);
    if (current.type === "UpdateExpression") mark_write(current.argument);
    if (
      (current.type === "ForOfStatement" ||
        current.type === "ForInStatement") &&
      current.left.type !== "VariableDeclaration"
    ) mark_write(current.left);
  };

  if (skip_statement === undefined) {
    walk(program, observe);
  } else {
    for (let index = 0; index < program.body.length; index += 1) {
      const stmt = program.body[index] as Statement;
      if (stmt.type === "ImportDeclaration") continue;
      if (skip_statement(stmt)) {
        skipped_stmts.push(stmt);
        let target: Node = stmt;
        if (
          stmt.type === "ExportNamedDeclaration" && stmt.declaration !== null
        ) target = stmt.declaration;
        if (target.type === "FunctionDeclaration" && target.id !== null) {
          callbacks.set(target, target);
        } else if (
          target.type === "VariableDeclaration" && target.kind === "const"
        ) {
          for (const declaration of target.declarations) {
            if (
              declaration.id.type !== "Identifier" || declaration.init === null
            ) continue;
            immutable.add(declaration);
            const initial = unwrap(declaration.init);
            if (
              initial.type === "ArrowFunctionExpression" ||
              initial.type === "FunctionExpression"
            ) callbacks.set(declaration, initial);
          }
        }
        continue;
      }
      walk(stmt, observe);
    }
  }

  function is_written_in_skipped(declaration: Function): boolean {
    if (skipped_stmts.length === 0 || declaration.id === null) return false;
    const cached = fn_write_checked.get(declaration);
    if (cached !== undefined) return cached;
    const target_name = declaration.id.name;
    let found = false;
    if (source !== undefined) {
      for (let i = 0; i < skipped_stmts.length; i += 1) {
        const stmt = skipped_stmts[i];
        if (
          stmt === declaration ||
          (stmt.type === "ExportNamedDeclaration" &&
            stmt.declaration === declaration)
        ) continue;
        const pos = source.indexOf(target_name, stmt.start);
        if (pos >= 0 && pos < stmt.end) {
          found = true;
          break;
        }
      }
    } else {
      found = true;
    }
    fn_write_checked.set(declaration, found);
    return found;
  }

  function make_fresh(prefix: string): IdentifierReference {
    if (fresh !== undefined) return id(fresh(prefix));
    let suffix = 1;
    let name = `${prefix}_${suffix}`;
    while (used_names.has(name)) {
      suffix += 1;
      name = `${prefix}_${suffix}`;
    }
    used_names.add(name);
    return id(name);
  }

  function is_iterable_namespace(receiver: Expression): boolean {
    if (
      receiver.type === "Identifier" &&
      (namespaces.has(receiver.name) || roots.has(receiver.name)) &&
      bindings.imported(receiver)
    ) return true;
    return static_member(receiver) && receiver.property.name === "iterable" &&
      receiver.object.type === "Identifier" &&
      root_namespaces.has(receiver.object.name) &&
      bindings.imported(receiver.object);
  }

  function is_foldable_object(receiver: Expression): boolean {
    if (
      receiver.type === "Identifier" && foldable_locals.has(receiver.name) &&
      bindings.imported(receiver)
    ) return true;
    return static_member(receiver) && receiver.property.name === "Foldable" &&
      receiver.object.type === "Identifier" &&
      foldable_namespaces.has(receiver.object.name) &&
      bindings.imported(receiver.object);
  }

  function is_iterable_named_call(
    callee: Expression,
    locals: ReadonlySet<string>,
    member_name: string,
  ): boolean {
    if (
      callee.type === "Identifier" && locals.has(callee.name) &&
      bindings.imported(callee)
    ) return true;
    return static_member(callee) && callee.property.name === member_name &&
      is_iterable_namespace(unwrap(callee.object));
  }

  function match_inline_root(expression: Expression): IterRoot | undefined {
    const current = unwrap(expression);
    if (
      current.type !== "CallExpression" || current.optional ||
      current.typeArguments != null || current.arguments.length !== 1 ||
      current.arguments[0].type === "SpreadElement"
    ) return undefined;
    const callee = unwrap(current.callee);
    let rk: IterRootKind | undefined;
    if (callee.type === "Identifier" && bindings.imported(callee)) {
      rk = root_locals.get(callee.name);
    } else if (
      static_member(callee) && is_iterable_namespace(unwrap(callee.object))
    ) {
      rk = root_kind_for(callee.property.name);
    }
    if (rk === undefined) return undefined;
    return { kind: rk, arg: current.arguments[0] as Expression };
  }

  function extract_inline_pipeline(
    expression: Expression,
    allow_empty_stages = false,
  ):
    | { readonly root: IterRoot; readonly stages: readonly IterStage[] }
    | undefined {
    const stages: IterStage[] = [];
    let cursor = unwrap(expression);
    while (true) {
      const root = match_inline_root(cursor);
      if (root !== undefined) {
        if (!allow_empty_stages && stages.length === 0) return undefined;
        stages.reverse();
        return { root, stages };
      }
      if (
        cursor.type !== "CallExpression" || cursor.optional ||
        cursor.typeArguments != null
      ) return undefined;
      const callee = unwrap(cursor.callee);
      // Method form: prev.map(fn) | prev.filter(fn) | prev.take(n)
      if (
        static_member(callee) && cursor.arguments.length === 1 &&
        cursor.arguments[0].type !== "SpreadElement"
      ) {
        const method = callee.property.name;
        if (method === "map" || method === "filter" || method === "bind") {
          stages.push({ tag: method, fn: cursor.arguments[0] as Expression });
          cursor = unwrap(callee.object);
          continue;
        }
        if (method === "take") {
          stages.push({
            tag: "take",
            count: cursor.arguments[0] as Expression,
          });
          cursor = unwrap(callee.object);
          continue;
        }
      }
      // Standalone form: filter(prev, fn) | filter_map(prev, fn) | take(prev, n)
      if (
        cursor.arguments.length === 2 &&
        cursor.arguments[0].type !== "SpreadElement" &&
        cursor.arguments[1].type !== "SpreadElement"
      ) {
        let stage_tag: "filter" | "filter_map" | "take" | undefined;
        if (callee.type === "Identifier" && bindings.imported(callee)) {
          stage_tag = stage_locals.get(callee.name);
        } else if (
          static_member(callee) &&
          (callee.property.name === "filter" ||
            callee.property.name === "filter_map" ||
            callee.property.name === "take") &&
          is_iterable_namespace(unwrap(callee.object))
        ) {
          stage_tag = callee.property.name;
        }
        if (stage_tag !== undefined) {
          if (stage_tag === "filter" || stage_tag === "filter_map") {
            stages.push({
              tag: stage_tag,
              fn: cursor.arguments[1] as Expression,
            });
          } else {
            stages.push({
              tag: "take",
              count: cursor.arguments[1] as Expression,
            });
          }
          cursor = unwrap(cursor.arguments[0] as Expression);
          continue;
        }
      }
      return undefined;
    }
  }

  function match_terminal(current: CallExpression): IterTerminal | undefined {
    if (
      current.optional || current.typeArguments != null ||
      current.arguments.some((arg) => arg.type === "SpreadElement")
    ) return undefined;
    const callee = unwrap(current.callee);
    // to_array(pipeline)
    if (
      current.arguments.length === 1 &&
      is_iterable_named_call(callee, to_array_locals, "to_array")
    ) {
      return {
        kind: "to_array",
        pipeline: current.arguments[0] as Expression,
      };
    }
    // preview(pipeline, limit?)
    if (
      (current.arguments.length === 1 || current.arguments.length === 2) &&
      is_iterable_named_call(callee, preview_locals, "preview")
    ) {
      return {
        kind: "to_array",
        pipeline: current.arguments[0] as Expression,
        extra_take: current.arguments.length === 2
          ? current.arguments[1] as Expression
          : literal(100),
      };
    }
    // compile_fold(pipeline)(init, step)
    if (
      current.arguments.length === 2 &&
      callee.type === "CallExpression" && !callee.optional &&
      callee.typeArguments == null && callee.arguments.length === 1 &&
      callee.arguments[0].type !== "SpreadElement" &&
      is_iterable_named_call(
        unwrap(callee.callee),
        compile_fold_locals,
        "compile_fold",
      )
    ) {
      return {
        kind: "fold",
        pipeline: callee.arguments[0] as Expression,
        init: current.arguments[0] as Expression,
        step: current.arguments[1] as Expression,
      };
    }
    if (static_member(callee)) {
      const method = callee.property.name;
      const receiver = unwrap(callee.object);
      // Foldable.fold(pipeline, init, step) | Foldable.fold_while(pipeline, init, step)
      if (
        (method === "fold" || method === "fold_while") &&
        current.arguments.length === 3 &&
        is_foldable_object(receiver)
      ) {
        return {
          kind: method,
          pipeline: current.arguments[0] as Expression,
          init: current.arguments[1] as Expression,
          step: current.arguments[2] as Expression,
        };
      }
      // Foldable.some(pipeline, pred) | Foldable.find(pipeline, pred)
      if (
        (method === "some" || method === "find") &&
        current.arguments.length === 2 && is_foldable_object(receiver)
      ) {
        return {
          kind: method,
          pipeline: current.arguments[0] as Expression,
          pred: current.arguments[1] as Expression,
        };
      }
      // pipeline.fold(init, step)
      if (method === "fold" && current.arguments.length === 2) {
        return {
          kind: "fold",
          pipeline: receiver,
          init: current.arguments[0] as Expression,
          step: current.arguments[1] as Expression,
        };
      }
    }
    return undefined;
  }

  function inline_unary_expr(
    callback: Expression,
    arg_id: IdentifierReference,
  ): Expression | undefined {
    const fn = unwrap(callback);
    if (
      fn.type !== "ArrowFunctionExpression" || fn.async || fn.generator ||
      fn.typeParameters != null || fn.returnType != null ||
      fn.body.type === "BlockStatement" || fn.params.length !== 1
    ) return undefined;
    const param = fn.params[0];
    if (
      param.type !== "Identifier" || param.optional ||
      param.typeAnnotation != null ||
      (param.decorators !== undefined && param.decorators.length > 0)
    ) return undefined;
    const body = fn.body as Expression;
    if (has_lexical_hazard(body) || has_await_or_yield(body)) return undefined;
    return substitute_ident(body, param, arg_id, bindings);
  }

  function inline_binary_fold_expr(
    callback: Expression,
    acc_id: IdentifierReference,
    val_id: IdentifierReference,
  ): Expression | undefined {
    const fn = unwrap(callback);
    if (
      fn.type !== "ArrowFunctionExpression" || fn.async || fn.generator ||
      fn.typeParameters != null || fn.returnType != null ||
      fn.body.type === "BlockStatement" || fn.params.length !== 2
    ) return undefined;
    const p0 = fn.params[0];
    const p1 = fn.params[1];
    if (
      p0.type !== "Identifier" || p0.optional ||
      p1.type !== "Identifier" || p1.optional ||
      (p0.decorators !== undefined && p0.decorators.length > 0) ||
      (p1.decorators !== undefined && p1.decorators.length > 0)
    ) return undefined;
    const body = fn.body as Expression;
    if (
      has_lexical_hazard(body) || has_await_or_yield(body) ||
      contains_function(body)
    ) return undefined;
    return substitute_two_idents(body, p0, acc_id, p1, val_id, bindings);
  }

  function match_maybe_ctor(
    expr: Expression,
  ):
    | { readonly ok: true; readonly arg: Expression }
    | { readonly ok: false }
    | undefined {
    const val = unwrap(expr);
    if (
      val.type !== "CallExpression" || val.optional ||
      val.typeArguments != null || val.callee.type !== "Identifier" ||
      !bindings.imported(val.callee)
    ) return undefined;
    if (
      just_locals.has(val.callee.name) && val.arguments.length === 1 &&
      val.arguments[0].type !== "SpreadElement"
    ) return { ok: true, arg: val.arguments[0] as Expression };
    if (nothing_locals.has(val.callee.name) && val.arguments.length === 0) {
      return { ok: false };
    }
    return undefined;
  }

  function match_fold_step_tuple(
    expr: Expression,
  ):
    | { readonly tag: "Continue" | "Done"; readonly next: Expression }
    | undefined {
    const val = unwrap(expr);
    if (
      val.type !== "ArrayExpression" || val.elements.length !== 2 ||
      val.elements[0] === null || val.elements[1] === null ||
      val.elements[0].type === "SpreadElement" ||
      val.elements[1].type === "SpreadElement"
    ) return undefined;
    const tag_el = unwrap(val.elements[0]);
    if (
      tag_el.type === "Literal" &&
      (tag_el.value === "Continue" || tag_el.value === "Done")
    ) {
      return { tag: tag_el.value, next: val.elements[1] as Expression };
    }
    return undefined;
  }

  function fuse_terminal(current: CallExpression): Expression | undefined {
    const matched_term = match_terminal(current);
    if (matched_term === undefined) return undefined;
    const term: IterTerminal = matched_term;
    const extra_take = term.kind === "to_array" ? term.extra_take : undefined;
    const parsed = extract_inline_pipeline(
      term.pipeline,
      extra_take !== undefined,
    );
    if (parsed === undefined) return undefined;
    const root = parsed.root;
    const stages: readonly IterStage[] = extra_take !== undefined
      ? [...parsed.stages, { tag: "take", count: extra_take }]
      : parsed.stages;
    if (has_lexical_hazard(root.arg) || has_await_or_yield(root.arg)) {
      return undefined;
    }
    for (const stage of stages) {
      const expr = stage.tag === "take" ? stage.count : stage.fn;
      if (has_lexical_hazard(expr) || has_await_or_yield(expr)) {
        return undefined;
      }
    }
    if (term.kind === "fold" || term.kind === "fold_while") {
      if (
        has_lexical_hazard(term.init) || has_await_or_yield(term.init) ||
        has_lexical_hazard(term.step) || has_await_or_yield(term.step)
      ) return undefined;
      const step_unwrapped = unwrap(term.step);
      let acc_type: TSType | undefined;
      if (
        (step_unwrapped.type === "ArrowFunctionExpression" ||
          step_unwrapped.type === "FunctionExpression") &&
        step_unwrapped.params.length >= 1
      ) {
        const p0 = step_unwrapped.params[0];
        if (p0.type !== "TSParameterProperty") {
          acc_type = p0.typeAnnotation?.typeAnnotation;
        }
      }
      const init_unwrapped = unwrap(term.init);
      if (
        acc_type === undefined &&
        ((init_unwrapped.type === "ArrayExpression" &&
          init_unwrapped.elements.length === 0) ||
          (init_unwrapped.type === "Literal" &&
            init_unwrapped.value === null) ||
          (init_unwrapped.type === "Identifier" &&
            init_unwrapped.name === "undefined"))
      ) return undefined;
    } else if (term.kind === "some" || term.kind === "find") {
      if (has_lexical_hazard(term.pred) || has_await_or_yield(term.pred)) {
        return undefined;
      }
    }

    const setup_stmts: Statement[] = [];
    const src_id = make_fresh(
      root.kind === "factory" ? "iter_factory" : "iter_src",
    );
    if (root.kind === "snapshot") {
      setup_stmts.push(
        variable(
          "const",
          src_id,
          node({
            type: "ArrayExpression",
            elements: Array.from([
              node({ type: "SpreadElement", argument: root.arg }),
            ]),
          }),
        ),
      );
    } else {
      setup_stmts.push(variable("const", src_id, root.arg));
    }

    // Track stages, hoisting non-inlined callbacks and take validations in left-to-right order.
    type LoweredStage =
      | {
        readonly tag: "map";
        readonly inline_cb?: Expression;
        readonly fn_id?: IdentifierReference;
      }
      | {
        readonly tag: "filter";
        readonly inline_cb?: Expression;
        readonly fn_id?: IdentifierReference;
      }
      | {
        readonly tag: "filter_map";
        readonly inline_cb?: Expression;
        readonly fn_id?: IdentifierReference;
      }
      | {
        readonly tag: "bind";
        readonly inline_cb?: Expression;
        readonly fn_id?: IdentifierReference;
      }
      | {
        readonly tag: "take";
        readonly count_id: IdentifierReference;
        readonly rem_id: IdentifierReference;
      };

    const src_elem_type = (): TSType | undefined => {
      if (root.kind === "factory") return undefined;
      return node({
        type: "TSIndexedAccessType",
        objectType: node({
          type: "TSTypeQuery",
          exprName: src_id,
          typeArguments: null,
        }),
        indexType: node({ type: "TSNumberKeyword" }),
      });
    };

    const annotate_unary_callback = (
      cb: Expression,
      can_use_src_elem: boolean,
    ): Expression | undefined => {
      const fn = unwrap(cb);
      if (
        fn.type !== "ArrowFunctionExpression" &&
        fn.type !== "FunctionExpression"
      ) return cb;
      if (fn.params.length === 0) return cb;
      const p0 = fn.params[0];
      if (p0.type === "TSParameterProperty") return cb;
      if (p0.typeAnnotation != null) return cb;
      if (p0.type !== "Identifier" || !can_use_src_elem) return undefined;
      const elem_type = src_elem_type();
      if (elem_type === undefined) return undefined;
      return {
        ...fn,
        params: [
          {
            ...p0,
            typeAnnotation: node({
              type: "TSTypeAnnotation",
              typeAnnotation: elem_type,
            }),
          },
          ...fn.params.slice(1),
        ],
      };
    };

    const lowered_stages: LoweredStage[] = [];
    const take_count_ids: IdentifierReference[] = [];
    let first_take_index = -1;
    let saw_map_stage = false;
    let has_bind = false;

    for (let i = 0; i < stages.length; i += 1) {
      const stage = stages[i];
      if (stage.tag === "bind") {
        // Keep take-before-bind conservative so outer take limits do not drop inner items.
        if (first_take_index >= 0) return undefined;
        has_bind = true;
      }
      if (stage.tag === "take") {
        if (first_take_index < 0) first_take_index = i;
        const count_id = make_fresh("iter_take");
        const rem_id = make_fresh("iter_rem");
        take_count_ids.push(count_id);
        setup_stmts.push(
          node({
            type: "VariableDeclaration",
            kind: "const",
            declarations: [
              node({
                type: "VariableDeclarator",
                id: {
                  ...count_id,
                  typeAnnotation: node({
                    type: "TSTypeAnnotation",
                    typeAnnotation: node({ type: "TSNumberKeyword" }),
                  }),
                },
                init: stage.count,
              }),
            ],
          }),
        );
        setup_stmts.push(
          node({
            type: "IfStatement",
            test: node({
              type: "LogicalExpression",
              operator: "||",
              left: node({
                type: "UnaryExpression",
                operator: "!",
                prefix: true,
                argument: call(member(id("Number"), "isSafeInteger"), [
                  count_id,
                ]),
              }),
              right: node({
                type: "BinaryExpression",
                operator: "<",
                left: count_id,
                right: literal(0),
              }),
            }),
            consequent: node({
              type: "ThrowStatement",
              argument: node({
                type: "NewExpression",
                callee: id("RangeError"),
                arguments: [
                  literal("take count must be a nonnegative safe integer"),
                ],
              }),
            }),
            alternate: null,
          }),
        );
        lowered_stages.push({ tag: "take", count_id, rem_id });
      } else {
        // Test if callback is inlineable expression-body arrow.
        const dummy = id("_");
        const can_inline = inline_unary_expr(stage.fn, dummy) !== undefined;
        if (can_inline) {
          lowered_stages.push({ tag: stage.tag, inline_cb: stage.fn });
        } else {
          const annotated = annotate_unary_callback(stage.fn, !saw_map_stage);
          if (annotated === undefined) return undefined;
          const fn_id = make_fresh(
            stage.tag === "map"
              ? "iter_map"
              : stage.tag === "filter_map"
              ? "iter_fmap"
              : stage.tag === "bind"
              ? "iter_bind"
              : "iter_pred",
          );
          setup_stmts.push(variable("const", fn_id, annotated));
          lowered_stages.push({ tag: stage.tag, fn_id });
        }
        if (
          stage.tag === "map" || stage.tag === "filter_map" ||
          stage.tag === "bind"
        ) {
          saw_map_stage = true;
        }
      }
    }

    // Terminal setup.
    let out_id: IdentifierReference | undefined;
    let acc_id: IdentifierReference | undefined;
    let step_fn_id: IdentifierReference | undefined;
    let pred_fn_id: IdentifierReference | undefined;

    if (term.kind === "to_array") {
      out_id = make_fresh("iter_out");
      setup_stmts.push(
        variable(
          "const",
          out_id,
          node({
            type: "ArrayExpression",
            elements: Array.from<Expression>([]),
          }),
        ),
      );
    } else if (term.kind === "fold" || term.kind === "fold_while") {
      acc_id = make_fresh("iter_acc");
      const step_unwrapped = unwrap(term.step);
      let acc_type: TSType | undefined;
      if (
        (step_unwrapped.type === "ArrowFunctionExpression" ||
          step_unwrapped.type === "FunctionExpression") &&
        step_unwrapped.params.length >= 1
      ) {
        const p0 = step_unwrapped.params[0];
        if (p0.type !== "TSParameterProperty") {
          acc_type = p0.typeAnnotation?.typeAnnotation;
        }
      }
      const acc_binding = acc_type !== undefined
        ? {
          ...acc_id,
          typeAnnotation: node({
            type: "TSTypeAnnotation",
            typeAnnotation: acc_type,
          }),
        }
        : acc_id;
      setup_stmts.push(
        node({
          type: "VariableDeclaration",
          kind: "let",
          declarations: [
            node({
              type: "VariableDeclarator",
              id: acc_binding,
              init: term.init,
            }),
          ],
        }),
      );
      if (
        inline_binary_fold_expr(term.step, acc_id, id("_")) === undefined
      ) {
        const step_fn = unwrap(term.step);
        if (
          (step_fn.type === "ArrowFunctionExpression" ||
            step_fn.type === "FunctionExpression") &&
          step_fn.params.some((p) =>
            p.type !== "TSParameterProperty" && p.typeAnnotation == null
          )
        ) return undefined;
        step_fn_id = make_fresh("iter_step");
        setup_stmts.push(variable("const", step_fn_id, term.step));
      }
    } else {
      if (inline_unary_expr(term.pred, id("_")) === undefined) {
        const annotated = annotate_unary_callback(term.pred, !saw_map_stage);
        if (annotated === undefined) return undefined;
        pred_fn_id = make_fresh("iter_pred");
        setup_stmts.push(variable("const", pred_fn_id, annotated));
      }
    }

    const needs_stop_flag = first_take_index >= 0 &&
      (first_take_index < lowered_stages.length - 1 ||
        term.kind === "some" || term.kind === "find" ||
        term.kind === "fold_while");
    const stop_id = needs_stop_flag ? make_fresh("iter_stop") : undefined;

    const loop_prefix: Statement[] = [];
    for (const stage of lowered_stages) {
      if (stage.tag === "take") {
        loop_prefix.push(variable("let", stage.rem_id, stage.count_id));
      }
    }
    if (stop_id !== undefined) {
      loop_prefix.push(variable("let", stop_id, literal(false)));
    }

    const outer_label = has_bind &&
        (first_take_index >= 0 || term.kind === "fold_while")
      ? make_fresh("iter_loop")
      : undefined;
    const make_break = (): Statement =>
      node({ type: "BreakStatement", label: outer_label ?? null });

    // Build loop body recursively to support nested bind (flat_map) loops cleanly.
    const loop_body: Statement[] = [];
    const first_val = make_fresh("iter_v");
    let index_id: IdentifierReference | undefined;
    if (root.kind !== "factory") {
      index_id = make_fresh("iter_i");
      loop_body.push(
        variable(
          "const",
          first_val,
          node({
            type: "MemberExpression",
            object: src_id,
            property: index_id,
            computed: true,
            optional: false,
          }),
        ),
      );
    }

    function emit_stages(
      start_idx: number,
      initial_val: IdentifierReference,
      initial_after_take: boolean,
    ): Statement[] {
      const body: Statement[] = [];
      let current_val = initial_val;
      let after_take = initial_after_take;
      let trailing_take_rem: IdentifierReference | undefined;

      for (let i = start_idx; i < lowered_stages.length; i += 1) {
        const stage = lowered_stages[i];
        if (stage.tag === "bind") {
          const inner_expr = stage.inline_cb !== undefined
            ? inline_unary_expr(stage.inline_cb, current_val)!
            : call(stage.fn_id!, [current_val]);
          const inner_root = match_inline_root(inner_expr);
          const next_val = make_fresh("iter_v");
          const inner_tail = emit_stages(i + 1, next_val, after_take);
          if (
            inner_root !== undefined &&
            (inner_root.kind === "array" || inner_root.kind === "snapshot")
          ) {
            const sub_id = make_fresh("iter_sub");
            const sub_idx = make_fresh("iter_j");
            body.push(
              variable(
                "const",
                sub_id,
                inner_root.kind === "snapshot"
                  ? node({
                    type: "ArrayExpression",
                    elements: Array.from([
                      node({ type: "SpreadElement", argument: inner_root.arg }),
                    ]),
                  })
                  : inner_root.arg,
              ),
              node({
                type: "ForStatement",
                init: variable("let", sub_idx, literal(0)),
                test: node({
                  type: "BinaryExpression",
                  operator: "<",
                  left: sub_idx,
                  right: member(sub_id, "length"),
                }),
                update: node({
                  type: "AssignmentExpression",
                  operator: "+=",
                  left: sub_idx,
                  right: literal(1),
                }),
                body: block([
                  variable(
                    "const",
                    next_val,
                    node({
                      type: "MemberExpression",
                      object: sub_id,
                      property: sub_idx,
                      computed: true,
                      optional: false,
                    }),
                  ),
                  ...inner_tail,
                ]),
              }),
            );
          } else {
            const iterable_expr = inner_root !== undefined
              ? call(inner_root.arg, [])
              : call(call(member(inner_expr, "value"), []), []);
            body.push(
              node({
                type: "ForOfStatement",
                await: false,
                left: node({
                  type: "VariableDeclaration",
                  kind: "const",
                  declarations: [
                    node({
                      type: "VariableDeclarator",
                      id: next_val,
                      init: null,
                    }),
                  ],
                }),
                right: iterable_expr,
                body: block(inner_tail),
              }),
            );
          }
          return body;
        }
        if (stage.tag === "map") {
          const next_val = make_fresh("iter_v");
          const mapped = stage.inline_cb !== undefined
            ? inline_unary_expr(stage.inline_cb, current_val)!
            : call(stage.fn_id!, [current_val]);
          body.push(variable("const", next_val, mapped));
          current_val = next_val;
        } else if (stage.tag === "filter") {
          const cond = stage.inline_cb !== undefined
            ? inline_unary_expr(stage.inline_cb, current_val)!
            : call(stage.fn_id!, [current_val]);
          const fail_branch: Statement = after_take && stop_id !== undefined
            ? block([
              node({
                type: "IfStatement",
                test: stop_id,
                consequent: make_break(),
                alternate: null,
              }),
              node({ type: "ContinueStatement", label: null }),
            ])
            : node({ type: "ContinueStatement", label: null });
          body.push(
            node({
              type: "IfStatement",
              test: node({
                type: "UnaryExpression",
                operator: "!",
                prefix: true,
                argument: cond,
              }),
              consequent: fail_branch,
              alternate: null,
            }),
          );
        } else if (stage.tag === "filter_map") {
          const next_val = make_fresh("iter_v");
          const fail_branch: Statement = after_take && stop_id !== undefined
            ? block([
              node({
                type: "IfStatement",
                test: stop_id,
                consequent: make_break(),
                alternate: null,
              }),
              node({ type: "ContinueStatement", label: null }),
            ])
            : node({ type: "ContinueStatement", label: null });
          const inlined = stage.inline_cb !== undefined
            ? inline_unary_expr(stage.inline_cb, current_val)!
            : undefined;
          let elided_fm = false;
          if (inlined !== undefined) {
            const direct = match_maybe_ctor(inlined);
            if (direct !== undefined) {
              if (direct.ok) {
                body.push(variable("const", next_val, direct.arg));
                current_val = next_val;
                elided_fm = true;
              } else {
                body.push(fail_branch);
                elided_fm = true;
              }
            } else {
              const cond_node = unwrap(inlined);
              if (cond_node.type === "ConditionalExpression") {
                const c_yes = match_maybe_ctor(cond_node.consequent);
                const c_no = match_maybe_ctor(cond_node.alternate);
                if (
                  c_yes !== undefined && c_no !== undefined &&
                  c_yes.ok !== c_no.ok
                ) {
                  const keep_test = c_yes.ok ? cond_node.test : node({
                    type: "UnaryExpression",
                    operator: "!",
                    prefix: true,
                    argument: cond_node.test,
                  });
                  const ok_expr = c_yes.ok
                    ? c_yes.arg
                    : (c_no as { readonly ok: true; readonly arg: Expression })
                      .arg;
                  body.push(
                    node({
                      type: "IfStatement",
                      test: node({
                        type: "UnaryExpression",
                        operator: "!",
                        prefix: true,
                        argument: keep_test,
                      }),
                      consequent: fail_branch,
                      alternate: null,
                    }),
                    variable("const", next_val, ok_expr),
                  );
                  current_val = next_val;
                  elided_fm = true;
                }
              }
            }
          }
          if (!elided_fm) {
            const fm_raw = make_fresh("iter_fm");
            const step_call = inlined !== undefined
              ? inlined
              : call(stage.fn_id!, [current_val]);
            body.push(
              variable("const", fm_raw, call(member(step_call, "value"), [])),
              node({
                type: "IfStatement",
                test: node({
                  type: "BinaryExpression",
                  operator: "===",
                  left: node({
                    type: "MemberExpression",
                    object: fm_raw,
                    property: literal(0),
                    computed: true,
                    optional: false,
                  }),
                  right: literal("Nothing"),
                }),
                consequent: fail_branch,
                alternate: null,
              }),
              variable(
                "const",
                next_val,
                node({
                  type: "MemberExpression",
                  object: fm_raw,
                  property: literal(1),
                  computed: true,
                  optional: false,
                }),
              ),
            );
            current_val = next_val;
          }
        } else {
          after_take = true;
          if (!needs_stop_flag && i === lowered_stages.length - 1) {
            trailing_take_rem = stage.rem_id;
          } else {
            body.push(
              node({
                type: "IfStatement",
                test: node({
                  type: "BinaryExpression",
                  operator: "===",
                  left: node({
                    type: "UpdateExpression",
                    operator: "--",
                    prefix: true,
                    argument: stage.rem_id,
                  }),
                  right: literal(0),
                }),
                consequent: node({
                  type: "ExpressionStatement",
                  expression: node({
                    type: "AssignmentExpression",
                    operator: "=",
                    left: stop_id!,
                    right: literal(true),
                  }),
                }),
                alternate: null,
              }),
            );
          }
        }
      }

      // Terminal action inside innermost loop body.
      if (term.kind === "to_array") {
        body.push(
          node({
            type: "ExpressionStatement",
            expression: call(member(out_id!, "push"), [current_val]),
          }),
        );
      } else if (term.kind === "fold") {
        const next_acc = step_fn_id !== undefined
          ? call(step_fn_id, [acc_id!, current_val])
          : inline_binary_fold_expr(term.step, acc_id!, current_val)!;
        body.push(
          node({
            type: "ExpressionStatement",
            expression: node({
              type: "AssignmentExpression",
              operator: "=",
              left: acc_id!,
              right: next_acc,
            }),
          }),
        );
      } else if (term.kind === "fold_while") {
        const inlined = step_fn_id === undefined
          ? inline_binary_fold_expr(term.step, acc_id!, current_val)!
          : undefined;
        let elided_fw = false;
        if (inlined !== undefined) {
          const cond_node = unwrap(inlined);
          if (cond_node.type === "ConditionalExpression") {
            const c_yes = match_fold_step_tuple(cond_node.consequent);
            const c_no = match_fold_step_tuple(cond_node.alternate);
            if (
              c_yes !== undefined && c_no !== undefined &&
              c_yes.tag !== c_no.tag
            ) {
              const done_test = c_yes.tag === "Done" ? cond_node.test : node({
                type: "UnaryExpression",
                operator: "!",
                prefix: true,
                argument: cond_node.test,
              });
              const done_val = c_yes.tag === "Done" ? c_yes.next : c_no.next;
              const cont_val = c_yes.tag === "Continue"
                ? c_yes.next
                : c_no.next;
              body.push(
                node({
                  type: "IfStatement",
                  test: done_test,
                  consequent: block([
                    node({
                      type: "ExpressionStatement",
                      expression: node({
                        type: "AssignmentExpression",
                        operator: "=",
                        left: acc_id!,
                        right: done_val,
                      }),
                    }),
                    make_break(),
                  ]),
                  alternate: null,
                }),
                node({
                  type: "ExpressionStatement",
                  expression: node({
                    type: "AssignmentExpression",
                    operator: "=",
                    left: acc_id!,
                    right: cont_val,
                  }),
                }),
              );
              elided_fw = true;
            }
          }
        }
        if (!elided_fw) {
          const fw_step = make_fresh("iter_step");
          const step_expr = inlined !== undefined
            ? inlined
            : call(step_fn_id!, [acc_id!, current_val]);
          body.push(
            variable("const", fw_step, step_expr),
            node({
              type: "ExpressionStatement",
              expression: node({
                type: "AssignmentExpression",
                operator: "=",
                left: acc_id!,
                right: node({
                  type: "MemberExpression",
                  object: fw_step,
                  property: literal(1),
                  computed: true,
                  optional: false,
                }),
              }),
            }),
            node({
              type: "IfStatement",
              test: node({
                type: "BinaryExpression",
                operator: "===",
                left: node({
                  type: "MemberExpression",
                  object: fw_step,
                  property: literal(0),
                  computed: true,
                  optional: false,
                }),
                right: literal("Done"),
              }),
              consequent: make_break(),
              alternate: null,
            }),
          );
        }
      } else {
        const pred_test = pred_fn_id !== undefined
          ? call(pred_fn_id, [current_val])
          : inline_unary_expr(term.pred, current_val)!;
        body.push(
          node({
            type: "IfStatement",
            test: pred_test,
            consequent: ret(term.kind === "some" ? literal(true) : current_val),
            alternate: null,
          }),
        );
      }

      if (trailing_take_rem !== undefined) {
        body.push(
          node({
            type: "IfStatement",
            test: node({
              type: "BinaryExpression",
              operator: "===",
              left: node({
                type: "UpdateExpression",
                operator: "--",
                prefix: true,
                argument: trailing_take_rem,
              }),
              right: literal(0),
            }),
            consequent: make_break(),
            alternate: null,
          }),
        );
      } else if (stop_id !== undefined) {
        body.push(
          node({
            type: "IfStatement",
            test: stop_id,
            consequent: make_break(),
            alternate: null,
          }),
        );
      }

      return body;
    }

    loop_body.push(...emit_stages(0, first_val, false));

    const raw_loop_stmt: Statement = root.kind === "factory"
      ? node({
        type: "ForOfStatement",
        await: false,
        left: node({
          type: "VariableDeclaration",
          kind: "const",
          declarations: [
            node({ type: "VariableDeclarator", id: first_val, init: null }),
          ],
        }),
        right: call(src_id, []),
        body: block(loop_body),
      })
      : node({
        type: "ForStatement",
        init: variable("let", index_id!, literal(0)),
        test: node({
          type: "BinaryExpression",
          operator: "<",
          left: index_id!,
          right: member(src_id, "length"),
        }),
        update: node({
          type: "AssignmentExpression",
          operator: "+=",
          left: index_id!,
          right: literal(1),
        }),
        body: block(loop_body),
      });
    const loop_stmt: Statement = outer_label !== undefined
      ? node({
        type: "LabeledStatement",
        label: outer_label,
        body: raw_loop_stmt,
      })
      : raw_loop_stmt;

    if (take_count_ids.length > 0) {
      let guard: Expression = node({
        type: "BinaryExpression",
        operator: "!==",
        left: take_count_ids[0],
        right: literal(0),
      });
      for (let i = 1; i < take_count_ids.length; i += 1) {
        guard = node({
          type: "LogicalExpression",
          operator: "&&",
          left: guard,
          right: node({
            type: "BinaryExpression",
            operator: "!==",
            left: take_count_ids[i],
            right: literal(0),
          }),
        });
      }
      setup_stmts.push(
        node({
          type: "IfStatement",
          test: guard,
          consequent: block([...loop_prefix, loop_stmt]),
          alternate: null,
        }),
      );
    } else {
      setup_stmts.push(...loop_prefix, loop_stmt);
    }

    if (term.kind === "to_array") setup_stmts.push(ret(out_id!));
    else if (term.kind === "fold" || term.kind === "fold_while") {
      setup_stmts.push(ret(acc_id!));
    } else if (term.kind === "some") setup_stmts.push(ret(literal(false)));
    else setup_stmts.push(ret(id("undefined")));

    return call(arrow([], block(setup_stmts)), []);
  }

  function mapper(expression: Expression): boolean {
    const current = unwrap(expression);
    if (current.type !== "Identifier") {
      return current.type === "ArrowFunctionExpression" &&
        unary_mapper(current);
    }
    const declaration = bindings.resolve(current);
    if (declaration === null || writes.has(declaration)) return false;
    const callback = callbacks.get(declaration);
    if (callback === undefined) return false;
    if (
      declaration.type === "FunctionDeclaration" &&
      is_written_in_skipped(declaration)
    ) return false;
    let owner: Node = declaration;
    if (declaration.type === "FunctionDeclaration") {
      owner = bindings.parent(declaration) ?? declaration;
    }
    if (bindings.scope(current) !== bindings.scope(owner)) return false;
    if (
      declaration.type !== "FunctionDeclaration" &&
      declaration.end >= current.start
    ) return false;
    return unary_mapper(callback);
  }

  function known_iterable(
    expression: Expression,
    seen = new Set<Node>(),
  ): boolean {
    const current = unwrap(expression);
    if (current.type === "Identifier") {
      const declaration = bindings.resolve(current);
      if (
        declaration === null || declaration.type !== "VariableDeclarator" ||
        declaration.init === null || !immutable.has(declaration) ||
        writes.has(declaration) || declaration.end >= current.start ||
        seen.has(declaration) ||
        bindings.scope(current) !== bindings.scope(declaration)
      ) return false;
      seen.add(declaration);
      return known_iterable(declaration.init, seen);
    }
    if (current.type !== "CallExpression" || current.optional) return false;
    const callee = unwrap(current.callee);
    if (callee.type === "Identifier") {
      return functions.has(callee.name) && bindings.imported(callee);
    }
    if (!static_member(callee)) return false;
    const receiver = unwrap(callee.object);
    const method = callee.property.name;
    if (constructors.has(method) && is_iterable_namespace(receiver)) {
      return true;
    }
    return (method === "map" || method === "filter" || method === "take" ||
      method === "bind") && known_iterable(receiver, seen);
  }

  let helper: IdentifierReference | undefined;
  return {
    enabled:
      functions.size + namespaces.size + roots.size + root_namespaces.size > 0,
    fuse(current: CallExpression): Expression | undefined {
      const terminal = fuse_terminal(current);
      if (terminal !== undefined) return terminal;
      const maps: CallExpression[] = [];
      let expression: Expression = current;
      while (true) {
        const candidate = unwrap(expression);
        if (
          candidate.type !== "CallExpression" || candidate.optional ||
          candidate.typeArguments != null || candidate.arguments.length !== 1 ||
          !static_member(candidate.callee) ||
          candidate.callee.property.name !== "map" ||
          candidate.arguments[0].type === "SpreadElement" ||
          !mapper(candidate.arguments[0])
        ) break;
        maps.push(candidate);
        expression = candidate.callee.object;
      }
      if (maps.length < 2 || !known_iterable(expression)) return undefined;
      if (helper === undefined) {
        let name = "compose_iterable_maps";
        if (fresh !== undefined) name = fresh(name);
        else {
          let suffix = 1;
          while (used_names.has(name)) {
            name = `compose_iterable_maps_${suffix++}`;
          }
          used_names.add(name);
        }
        helper = id(name);
      }
      maps.reverse();
      let composed = maps[0].arguments[0] as Expression;
      for (const map of maps.slice(1)) {
        composed = call(helper, [composed, map.arguments[0] as Expression]);
      }
      return call(maps[0].callee, [composed]);
    },
    helper_declaration(): Function | undefined {
      if (helper === undefined) return undefined;
      return compose_helper(helper);
    },
    add_helper(file: Program): Program {
      if (helper === undefined) return file;
      return { ...file, body: [...file.body, compose_helper(helper)] };
    },
  };
}

function static_member(
  expression: Expression,
): expression is StaticMemberExpression {
  return expression.type === "MemberExpression" && !expression.optional &&
    !expression.computed && expression.property.type === "Identifier";
}

function unary_mapper(current: Function | ArrowFunctionExpression): boolean {
  if (
    current.typeParameters != null || current.async || current.generator ||
    current.params.length !== 1
  ) return false;
  const parameter = current.params[0];
  return parameter.type === "Identifier" && !parameter.optional &&
    (parameter.decorators === undefined || parameter.decorators.length === 0);
}

function has_lexical_hazard(root: Node): boolean {
  let found = false;
  walk(root, (child, parent) => {
    if (found) return false;
    if (
      child.type === "ThisExpression" || child.type === "Super" ||
      child.type === "MetaProperty" ||
      (child.type === "CallExpression" && !child.optional &&
        child.callee.type === "Identifier" && child.callee.name === "eval")
    ) {
      found = true;
      return false;
    }
    if (child.type === "Identifier" && child.name === "arguments") {
      if (
        parent?.type === "MemberExpression" && !parent.computed &&
        parent.property === child
      ) return;
      if (
        parent?.type === "Property" && !parent.computed &&
        parent.key === child && !parent.shorthand
      ) return;
      found = true;
      return false;
    }
  });
  return found;
}

function has_await_or_yield(root: Node): boolean {
  let found = false;
  walk(root, (child) => {
    if (found) return false;
    if (
      child.type === "FunctionDeclaration" ||
      child.type === "FunctionExpression" ||
      child.type === "ArrowFunctionExpression"
    ) return false;
    if (child.type === "AwaitExpression" || child.type === "YieldExpression") {
      found = true;
      return false;
    }
  });
  return found;
}

function contains_function(root: Node): boolean {
  let found = false;
  walk(root, (child) => {
    if (found) return false;
    if (
      child.type === "FunctionDeclaration" ||
      child.type === "FunctionExpression" ||
      child.type === "ArrowFunctionExpression"
    ) {
      found = true;
      return false;
    }
  });
  return found;
}

function substitute_ident(
  expr: Expression,
  target_key: Node,
  replacement: Expression,
  bindings: ReturnType<typeof create_binding_analysis>,
): Expression {
  return substitute_two_idents(
    expr,
    target_key,
    replacement,
    undefined,
    undefined,
    bindings,
  );
}

function substitute_two_idents(
  expr: Expression,
  key1: Node,
  rep1: Expression,
  key2: Node | undefined,
  rep2: Expression | undefined,
  bindings: ReturnType<typeof create_binding_analysis>,
): Expression {
  function clone(current: Node): Node {
    if (current.type === "Identifier") {
      const resolved = bindings.resolve(current);
      if (resolved === key1) return rep1;
      if (key2 !== undefined && resolved === key2) return rep2!;
      return current;
    }
    const keys = value_visitor_keys[current.type];
    if (keys === undefined || keys.length === 0) return current;
    if (current.type === "Property" && current.shorthand) {
      const next_val = clone(current.value) as Expression;
      if (next_val !== current.value) {
        return {
          ...(current as ObjectProperty),
          value: next_val,
          shorthand: false,
        };
      }
      return current;
    }
    let result = current;
    const record = current as unknown as Record<string, unknown>;
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      if (
        current.type === "MemberExpression" && !current.computed &&
        key === "property"
      ) continue;
      if (
        current.type === "Property" && !current.computed && key === "key"
      ) continue;
      const val = record[key];
      if (val === null || typeof val !== "object") continue;
      if (Array.isArray(val)) {
        let next_arr: unknown[] | undefined;
        for (let j = 0; j < val.length; j += 1) {
          const item = val[j];
          if (
            item !== null && typeof item === "object" &&
            typeof (item as { type?: unknown }).type === "string"
          ) {
            const next_item = clone(item as Node);
            if (next_item !== item) {
              next_arr ??= val.slice(0, j);
              next_arr.push(next_item);
            } else if (next_arr !== undefined) next_arr.push(item);
          } else if (next_arr !== undefined) next_arr.push(item);
        }
        if (next_arr !== undefined) result = { ...result, [key]: next_arr };
      } else if (typeof (val as { type?: unknown }).type === "string") {
        const next_val = clone(val as Node);
        if (next_val !== val) result = { ...result, [key]: next_val };
      }
    }
    return result;
  }
  return clone(expr) as Expression;
}

function source_module(specifier: string): string | undefined {
  if (
    /^(?:\.\.?\/)+src\/(?:typeclasses\/)?(iterable|maybe|mod|typeclasses|foldable)(?:\.ts)?$/
      .test(specifier)
  ) {
    return specifier.match(
      /(iterable|maybe|mod|typeclasses|foldable)(?:\.ts)?$/,
    )?.[1];
  }
  for (const module of ["iterable", "maybe", "mod", "typeclasses"]) {
    try {
      const url = new URL(`../src/${module}.ts`, import.meta.url);
      if (specifier === url.href || specifier === url.pathname) return module;
    } catch { /* Bundles still recognize package and relative imports. */ }
  }
  try {
    const url = new URL("../src/typeclasses/foldable.ts", import.meta.url);
    if (specifier === url.href || specifier === url.pathname) return "foldable";
  } catch { /* Bundles still recognize package and relative imports. */ }
  return undefined;
}

function compose_helper(name: IdentifierReference): Function {
  function unary(input: string, output: string): TSType {
    return node({
      type: "TSFunctionType",
      typeParameters: null,
      params: [parameter("value", type_ref(input))],
      returnType: node({
        type: "TSTypeAnnotation",
        typeAnnotation: type_ref(output),
      }),
    });
  }
  return node({
    type: "FunctionDeclaration",
    id: name,
    async: false,
    generator: false,
    expression: false,
    typeParameters: node({
      type: "TSTypeParameterDeclaration",
      params: ["from", "middle", "to"].map((name) =>
        node({
          type: "TSTypeParameter",
          name: id(name),
          constraint: null,
          default: null,
          in: false,
          out: false,
          const: false,
        })
      ),
    }),
    params: [
      parameter("first", unary("from", "middle")),
      parameter("second", unary("middle", "to")),
    ],
    returnType: node({
      type: "TSTypeAnnotation",
      typeAnnotation: unary("from", "to"),
    }),
    body: block([
      ret(
        arrow(
          [parameter("value")],
          call(id("second"), [call(id("first"), [id("value")])]),
        ),
      ),
    ]),
  });
}
