import { type As, define, type Value } from "./trait.ts";
import { Applicative, Format, Functor, Monad } from "./traits.ts";

const tvar_value = Symbol("TVar.value");

export type TVar<item> = object & {
  readonly _TVar?: (item: item) => item;
};

type TVarBox<item> = TVar<item> & {
  [tvar_value]: item;
};

type STMJournal = {
  readonly writes: Map<TVar<unknown>, unknown>;
};

export type STM<item> = (journal: STMJournal) => item;

export const stm_kind = Symbol("STM");

declare module "./trait.ts" {
  interface TraitTypes<dictionary, item> {
    [stm_kind]: STM<item>;
  }
}

export interface AsSTM extends As<typeof stm_kind> {}

type STMValue<item> = Value<AsSTM, item>;

export const STM = define<AsSTM>(
  stm_kind,
);

export class STMError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "STMError";
  }
}

export class STMRetry extends Error {
  constructor() {
    super("STM retry has no alternative");
    this.name = "STMRetry";
  }
}

export function new_tvar<item>(value: item): TVar<item> {
  return { [tvar_value]: value } as TVarBox<item>;
}

export function read_tvar<item>(variable: TVar<item>): STMValue<item> {
  return STM((journal) => read_journal(journal, variable));
}

export function write_tvar<item>(
  variable: TVar<item>,
  value: item,
): STMValue<void> {
  return STM((journal) => {
    write_journal(journal, variable, value);
  });
}

export function modify_tvar<item>(
  variable: TVar<item>,
  fn: (value: item) => item,
): STMValue<item> {
  return STM((journal) => {
    const next = fn(read_journal(journal, variable));
    write_journal(journal, variable, next);

    return next;
  });
}

export function abort<item = never>(message: string): STMValue<item> {
  return STM(() => {
    throw new STMError(message);
  });
}

export function retry<item = never>(): STMValue<item> {
  return STM(() => {
    throw new STMRetry();
  });
}

export function or_else<item>(
  left: STMValue<item>,
  right: STMValue<item>,
): STMValue<item> {
  return STM((journal) => {
    const writes = new Map(journal.writes);

    try {
      return run_stm(left, journal);
    } catch (error) {
      if (!(error instanceof STMRetry)) {
        throw error;
      }

      restore_journal(journal, writes);
      return run_stm(right, journal);
    }
  });
}

export function atomically<item>(transaction: STMValue<item>): item {
  const journal: STMJournal = { writes: new Map() };
  const value = run_stm(transaction, journal);

  commit_journal(journal);

  return value;
}

Format.implement(STM)({
  fmt() {
    return "STM(?)";
  },
});

export interface AsSTM extends Format<AsSTM> {}

Functor.implement(STM)({
  map(fn) {
    return STM((journal) => fn(run_stm(this, journal)));
  },
});

export interface AsSTM extends Functor<AsSTM> {}

Applicative.implement(STM)({
  pure(value) {
    return STM(() => value);
  },

  ap(value) {
    return STM((journal) => {
      const fn = run_stm(this, journal);
      return fn(run_stm(value, journal));
    });
  },
});

export interface AsSTM extends Applicative<AsSTM> {}

Monad.implement(STM)({
  bind(fn) {
    return STM((journal) => {
      const value = run_stm(this, journal);
      return run_stm(fn(value), journal);
    });
  },
});

export interface AsSTM extends Monad<AsSTM> {}

function run_stm<item>(
  transaction: STMValue<item>,
  journal: STMJournal,
): item {
  return transaction.value()(journal);
}

function read_journal<item>(
  journal: STMJournal,
  variable: TVar<item>,
): item {
  const key = variable as TVar<unknown>;

  if (journal.writes.has(key)) {
    return journal.writes.get(key) as item;
  }

  return read_current(variable);
}

function write_journal<item>(
  journal: STMJournal,
  variable: TVar<item>,
  value: item,
): void {
  journal.writes.set(variable as TVar<unknown>, value);
}

function commit_journal(journal: STMJournal): void {
  for (const [variable, value] of journal.writes) {
    write_current(variable, value);
  }
}

function restore_journal(
  journal: STMJournal,
  writes: Map<TVar<unknown>, unknown>,
): void {
  journal.writes.clear();

  for (const [variable, value] of writes) {
    journal.writes.set(variable, value);
  }
}

function read_current<item>(variable: TVar<item>): item {
  return (variable as TVarBox<item>)[tvar_value];
}

function write_current<item>(variable: TVar<item>, value: item): void {
  (variable as TVarBox<item>)[tvar_value] = value;
}
