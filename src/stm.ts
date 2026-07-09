import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import {
  Applicative,
  applicative_lift_method,
  Functor,
  Monad,
  Show,
} from "./typeclasses.ts";

const tvar_value = Symbol("TVar.value");

export type TVar<item> = object & {
  readonly _TVar?: (item: item) => item;
};

type TVarBox<item> = TVar<item> & {
  [tvar_value]: item;
};

type StmJournal = {
  readonly writes: Map<TVar<unknown>, unknown>;
};

export type Stm<item> = (journal: StmJournal) => item;

export interface AsStm extends As<AsStm>, Show<AsStm>, Monad<AsStm> {
  readonly [type_item]: unknown;
  readonly [type_data]: Stm<this[typeof type_item]>;
}

type StmValue<item> = Data<AsStm, item>;

export const Stm: AsStm = data<AsStm>();

export class StmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StmError";
  }
}

export class StmRetry extends Error {
  constructor() {
    super("Stm retry has no alternative");
    this.name = "StmRetry";
  }
}

export function new_tvar<item>(value: item): TVar<item> {
  return { [tvar_value]: value } as TVarBox<item>;
}

export function read_tvar<item>(variable: TVar<item>): StmValue<item> {
  return Stm((journal) => read_journal(journal, variable));
}

export function write_tvar<item>(
  variable: TVar<item>,
  value: item,
): StmValue<void> {
  return Stm((journal) => {
    write_journal(journal, variable, value);
  });
}

export function modify_tvar<item>(
  variable: TVar<item>,
  fn: (value: item) => item,
): StmValue<item> {
  return Stm((journal) => {
    const next = fn(read_journal(journal, variable));
    write_journal(journal, variable, next);

    return next;
  });
}

export function abort<item = never>(message: string): StmValue<item> {
  return Stm(() => {
    throw new StmError(message);
  });
}

export function retry<item = never>(): StmValue<item> {
  return Stm(() => {
    throw new StmRetry();
  });
}

export function or_else<item>(
  left: StmValue<item>,
  right: StmValue<item>,
): StmValue<item> {
  return Stm((journal) => {
    const writes = new Map(journal.writes);

    try {
      return run_stm(left, journal);
    } catch (error) {
      if (!(error instanceof StmRetry)) {
        throw error;
      }

      restore_journal(journal, writes);
      return run_stm(right, journal);
    }
  });
}

export function atomically<item>(transaction: StmValue<item>): item {
  const journal: StmJournal = { writes: new Map() };
  const value = run_stm(transaction, journal);

  commit_journal(journal);

  return value;
}

Show.instance(Stm)({
  show() {
    return "Stm(?)";
  },
});

Functor.instance(Stm)({
  map(fn) {
    return Stm((journal) => fn(run_stm(this, journal)));
  },
});

Applicative.instance(Stm)({
  pure(value) {
    return Stm(() => value);
  },

  [applicative_lift_method](fn, rest) {
    const first = this.value();
    const transactions = rest.map((current) => current.value());

    return Stm((journal) => {
      const values = [first(journal)];

      for (const transaction of transactions) {
        values.push(transaction(journal));
      }

      return fn(...values);
    });
  },

  ap(value) {
    return Stm((journal) => {
      const fn = run_stm(this, journal);
      return fn(run_stm(value, journal));
    });
  },
});

Monad.instance(Stm)({
  bind(fn) {
    return Stm((journal) => {
      const value = run_stm(this, journal);
      return run_stm(fn(value), journal);
    });
  },
});

function run_stm<item>(
  transaction: StmValue<item>,
  journal: StmJournal,
): item {
  return transaction.value()(journal);
}

function read_journal<item>(
  journal: StmJournal,
  variable: TVar<item>,
): item {
  const key = variable as TVar<unknown>;

  if (journal.writes.has(key)) {
    return journal.writes.get(key) as item;
  }

  return read_current(variable);
}

function write_journal<item>(
  journal: StmJournal,
  variable: TVar<item>,
  value: item,
): void {
  journal.writes.set(variable as TVar<unknown>, value);
}

function commit_journal(journal: StmJournal): void {
  for (const [variable, value] of journal.writes) {
    write_current(variable, value);
  }
}

function restore_journal(
  journal: StmJournal,
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
