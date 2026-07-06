import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "../../src/typeclass.ts";
import {
  Alternative,
  Applicative,
  Functor,
  Monad,
  Show,
} from "../../src/typeclasses.ts";

export type SourcePosition = {
  readonly source: string;
  readonly offset: number;
  readonly line: number;
  readonly column: number;
};

export type ParseState = SourcePosition & {
  readonly input: string;
};

export type ParseError = {
  readonly position: SourcePosition;
  readonly expected: readonly string[];
  readonly message: string | undefined;
};

export type ParseOutcome<item> =
  | readonly ["parsed", item]
  | readonly ["failed", ParseError];

export type ParseReply<item> =
  | readonly ["right", ParseSuccess<item>]
  | ParseFailure;

type ParseSuccess<item> = {
  readonly value: item;
  readonly state: ParseState;
  readonly consumed: boolean;
};

type ParseFailure = readonly ["left", {
  readonly error: ParseError;
  readonly consumed: boolean;
}];

export type Parser<item> = {
  readonly label: string;
  parse(state: ParseState): ParseReply<item>;
};

export interface AsParser
  extends
    As<AsParser>,
    Show<AsParser>,
    Functor<AsParser>,
    Applicative<AsParser>,
    Monad<AsParser>,
    Alternative<AsParser> {
  readonly [type_item]: unknown;
  readonly [type_data]: Parser<this[typeof type_item]>;
}

export type ParserValue<item> = Data<AsParser, item>;

export const Parser = data<AsParser>();

Show.instance(Parser)({
  show() {
    return "Parser(" + this.value().label + ")";
  },
});

Functor.instance(Parser)({
  map(fn) {
    const source = this.value();

    return define_parser(source.label, (state) => {
      const reply = source.parse(state);
      const [tag, payload] = reply;

      switch (tag) {
        case "left":
          return reply;
        case "right":
          return ok_with(
            fn(payload.value),
            payload.state,
            payload.consumed,
          );
      }
    });
  },
});

Applicative.instance(Parser)({
  pure(value) {
    return succeed(value);
  },

  ap(value) {
    const fn_parser = this.value();
    const value_parser = value.value();

    return define_parser(
      fn_parser.label + " <*> " + value_parser.label,
      (state) => {
        const fn_reply = fn_parser.parse(state);
        const [fn_tag, fn_payload] = fn_reply;

        switch (fn_tag) {
          case "left":
            return fn_reply;
          case "right": {
            const value_reply = value_parser.parse(fn_payload.state);
            const [value_tag, value_payload] = value_reply;

            switch (value_tag) {
              case "left":
                return carry_consumed(value_reply, fn_payload.consumed);
              case "right":
                return ok_with(
                  fn_payload.value(value_payload.value),
                  value_payload.state,
                  consumed_any(fn_payload.consumed, value_payload.consumed),
                );
            }
          }
        }
      },
    );
  },
});

Monad.instance(Parser)({
  bind(fn) {
    const source = this.value();

    return define_parser(source.label, (state) => {
      const reply = source.parse(state);
      const [tag, payload] = reply;

      switch (tag) {
        case "left":
          return reply;
        case "right": {
          const next = fn(payload.value).value().parse(payload.state);
          const [next_tag, next_payload] = next;

          switch (next_tag) {
            case "left":
              return carry_consumed(next, payload.consumed);
            case "right":
              return ok_with(
                next_payload.value,
                next_payload.state,
                consumed_any(payload.consumed, next_payload.consumed),
              );
          }
        }
      }
    });
  },
});

Alternative.instance(Parser)({
  empty() {
    return empty_parser();
  },

  alt(right) {
    const left_parser = this.value();
    const right_parser = right.value();

    return define_parser(
      left_parser.label + " | " + right_parser.label,
      (state) => {
        const left = left_parser.parse(state);
        const [left_tag, left_payload] = left;

        switch (left_tag) {
          case "right":
            return left;
          case "left": {
            if (left_payload.consumed) {
              return left;
            }

            const right_reply = right_parser.parse(state);
            const [right_tag, right_payload] = right_reply;

            switch (right_tag) {
              case "right":
                return right_reply;
              case "left": {
                const error = merge_errors(
                  left_payload.error,
                  right_payload.error,
                );

                return ["left", {
                  error,
                  consumed: right_payload.consumed,
                }];
              }
            }
          }
        }
      },
    );
  },
});

export function define_parser<item>(
  label: string,
  parse: (state: ParseState) => ParseReply<item>,
): ParserValue<item> {
  return Parser({
    label,
    parse,
  });
}

export function initial_state(input: string, source = "input"): ParseState {
  return {
    source,
    input,
    offset: 0,
    line: 1,
    column: 1,
  };
}

export function parse_all<item>(
  parser: ParserValue<item>,
  input: string,
  source = "input",
): ParseOutcome<item> {
  const start = initial_state(input, source);
  const reply = parser.value().parse(start);
  const [tag, payload] = reply;

  switch (tag) {
    case "left":
      return ["failed", payload.error];
    case "right": {
      const end = eof().value().parse(payload.state);
      const [end_tag, end_payload] = end;

      switch (end_tag) {
        case "left":
          return ["failed", end_payload.error];
        case "right":
          return ["parsed", payload.value];
      }
    }
  }
}

export function format_error(error: ParseError): string {
  const expected = format_expected(error.expected);
  let message = error.position.source + ":" +
    error.position.line.toString() + ":" +
    error.position.column.toString() +
    ": expected " + expected;

  if (error.message !== undefined) {
    message = message + " (" + error.message + ")";
  }

  return message;
}

export function succeed<item>(value: item): ParserValue<item> {
  return define_parser("pure", (state) => {
    return ok_with(value, state, false);
  });
}

export function fail<item = never>(
  expected: string,
  message?: string,
): ParserValue<item> {
  return define_parser(expected, (state) => {
    return failure(state, [expected], message, false);
  });
}

function empty_parser<item = never>(): ParserValue<item> {
  return define_parser("empty", (state) => {
    return failure(state, [], undefined, false);
  });
}

export function label<item>(
  parser: ParserValue<item>,
  expected: string,
): ParserValue<item> {
  return define_parser(expected, (state) => {
    const reply = parser.value().parse(state);
    const [tag, payload] = reply;

    switch (tag) {
      case "right":
        return reply;
      case "left":
        if (payload.consumed) {
          return reply;
        }

        return ["left", {
          error: {
            ...payload.error,
            expected: [expected],
          },
          consumed: payload.consumed,
        }];
    }
  });
}

export function attempt<item>(parser: ParserValue<item>): ParserValue<item> {
  return define_parser("try " + parser.value().label, (state) => {
    const reply = parser.value().parse(state);
    const [tag, payload] = reply;

    switch (tag) {
      case "right":
        return reply;
      case "left":
        return ["left", {
          error: payload.error,
          consumed: false,
        }];
    }
  });
}

export function look_ahead<item>(
  parser: ParserValue<item>,
): ParserValue<item> {
  return define_parser("lookAhead " + parser.value().label, (state) => {
    const reply = parser.value().parse(state);
    const [tag, payload] = reply;

    switch (tag) {
      case "left":
        return reply;
      case "right":
        return ok_with(payload.value, state, false);
    }
  });
}

export function not_followed_by<item>(
  parser: ParserValue<item>,
  expected: string,
): ParserValue<void> {
  return define_parser("notFollowedBy " + parser.value().label, (state) => {
    const reply = parser.value().parse(state);
    const [tag] = reply;

    switch (tag) {
      case "left":
        return ok_with(undefined, state, false);
      case "right":
        return failure(state, [expected], "unexpected input", false);
    }
  });
}

export function eof(): ParserValue<void> {
  return define_parser("end of input", (state) => {
    if (state.offset >= state.input.length) {
      return ok_with(undefined, state, false);
    }

    return failure(state, ["end of input"], undefined, false);
  });
}

export function satisfy(
  expected: string,
  predicate: (char: string) => boolean,
): ParserValue<string> {
  return define_parser(expected, (state) => {
    const char = current_char(state);

    if (char === undefined) {
      return failure(state, [expected], "end of input", false);
    }

    if (predicate(char)) {
      const next = advance(state, char);
      return ok_with(char, next, true);
    }

    return failure(state, [expected], undefined, false);
  });
}

export function char(expected: string): ParserValue<string> {
  return satisfy(Deno.inspect(expected), (actual) => {
    return actual === expected;
  });
}

export function chunk(expected: string): ParserValue<string> {
  return define_parser(Deno.inspect(expected), (state) => {
    const rest = state.input.slice(state.offset);

    if (rest.startsWith(expected)) {
      const next = advance_text(state, expected);
      let consumed = false;

      if (expected.length > 0) {
        consumed = true;
      }

      return ok_with(expected, next, consumed);
    }

    return failure(state, [Deno.inspect(expected)], undefined, false);
  });
}

export function take_while(
  expected: string,
  predicate: (char: string) => boolean,
  minimum = 0,
): ParserValue<string> {
  return define_parser(expected, (state) => {
    let current = state;
    let count = 0;

    while (true) {
      const char = current_char(current);

      if (char === undefined) {
        break;
      }

      if (!predicate(char)) {
        break;
      }

      current = advance(current, char);
      count += 1;
    }

    if (count < minimum) {
      return failure(state, [expected], undefined, false);
    }

    let consumed = false;

    if (count > 0) {
      consumed = true;
    }

    const text = state.input.slice(state.offset, current.offset);

    return ok_with(text, current, consumed);
  });
}

export function take_until(
  terminator: string,
  expected: string,
): ParserValue<string> {
  return define_parser(expected, (state) => {
    const index = state.input.indexOf(terminator, state.offset);

    if (index < 0) {
      return failure(
        state,
        [Deno.inspect(terminator)],
        "unterminated input",
        false,
      );
    }

    const text = state.input.slice(state.offset, index);
    const next = advance_text(state, text);
    let consumed = false;

    if (text.length > 0) {
      consumed = true;
    }

    return ok_with(text, next, consumed);
  });
}

export function nested_delimited(
  open: string,
  close: string,
  expected: string,
): ParserValue<void> {
  return define_parser(expected, (state) => {
    if (!state.input.startsWith(open, state.offset)) {
      return failure(state, [Deno.inspect(open)], undefined, false);
    }

    let current = advance_text(state, open);
    let depth = 1;

    while (depth > 0) {
      if (current.offset >= current.input.length) {
        return failure(
          current,
          [Deno.inspect(close)],
          "unterminated input",
          true,
        );
      }

      if (current.input.startsWith(open, current.offset)) {
        current = advance_text(current, open);
        depth += 1;
        continue;
      }

      if (current.input.startsWith(close, current.offset)) {
        current = advance_text(current, close);
        depth -= 1;
        continue;
      }

      const char = current_char(current);

      if (char === undefined) {
        return failure(
          current,
          [Deno.inspect(close)],
          "unterminated input",
          true,
        );
      }

      current = advance(current, char);
    }

    return ok_with(undefined, current, true);
  });
}

export function many<item>(parser: ParserValue<item>): ParserValue<item[]> {
  return define_parser("many " + parser.value().label, (state) => {
    const values: item[] = [];
    let current = state;
    let consumed = false;

    while (true) {
      const reply = parser.value().parse(current);
      const [tag, payload] = reply;

      switch (tag) {
        case "left":
          if (payload.consumed) {
            return carry_consumed(reply, consumed);
          }

          return ok_with(values, current, consumed);
        case "right":
          if (!payload.consumed) {
            return failure(
              current,
              ["parser that consumes input"],
              "many parser accepted empty input",
              consumed,
            );
          }

          values.push(payload.value);
          current = payload.state;
          consumed = true;
      }
    }
  });
}

export function just<item>(parser: ParserValue<item>): ParserValue<item[]> {
  return parser.bind((first) => {
    return many(parser).map((rest) => {
      return [first, ...rest];
    });
  });
}

export function optional<item>(
  parser: ParserValue<item>,
): ParserValue<item | undefined> {
  return define_parser("optional " + parser.value().label, (state) => {
    const reply = parser.value().parse(state);
    const [tag, payload] = reply;

    switch (tag) {
      case "right":
        return reply;
      case "left":
        if (payload.consumed) {
          return reply;
        }

        return ok_with(undefined, state, false);
    }
  });
}

export function choice<item>(
  parsers: readonly ParserValue<item>[],
): ParserValue<item> {
  return define_parser("choice", (state) => {
    let merged: ParseError | undefined;

    for (const parser of parsers) {
      const reply = parser.value().parse(state);
      const [tag, payload] = reply;

      switch (tag) {
        case "right":
          return reply;
        case "left":
          if (payload.consumed) {
            return reply;
          }

          if (merged === undefined) {
            merged = payload.error;
          } else {
            merged = merge_errors(merged, payload.error);
          }
      }
    }

    if (merged !== undefined) {
      return ["left", {
        error: merged,
        consumed: false,
      }];
    }

    return failure(state, ["choice"], undefined, false);
  });
}

export function left<left_item, right_item>(
  left_parser: ParserValue<left_item>,
  right_parser: ParserValue<right_item>,
): ParserValue<left_item> {
  return left_parser.bind((value) => {
    return right_parser.map(() => {
      return value;
    });
  });
}

export function right<left_item, right_item>(
  left_parser: ParserValue<left_item>,
  right_parser: ParserValue<right_item>,
): ParserValue<right_item> {
  return left_parser.bind(() => {
    return right_parser;
  });
}

export function between<open, item, close>(
  open_parser: ParserValue<open>,
  item_parser: ParserValue<item>,
  close_parser: ParserValue<close>,
): ParserValue<item> {
  return right(open_parser, left(item_parser, close_parser));
}

export function sep_by<item, separator>(
  item_parser: ParserValue<item>,
  separator_parser: ParserValue<separator>,
): ParserValue<item[]> {
  return define_parser("sepBy " + item_parser.value().label, (state) => {
    const first = item_parser.value().parse(state);
    const [first_tag, first_payload] = first;

    switch (first_tag) {
      case "left":
        if (first_payload.consumed) {
          return first;
        }

        return ok_with([], state, false);
      case "right":
        break;
    }

    const values: item[] = [first_payload.value];
    let current = first_payload.state;
    let consumed = first_payload.consumed;

    while (true) {
      const separator = separator_parser.value().parse(current);
      const [separator_tag, separator_payload] = separator;

      switch (separator_tag) {
        case "left":
          if (separator_payload.consumed) {
            return carry_consumed(separator, consumed);
          }

          return ok_with(values, current, consumed);
        case "right": {
          const next = item_parser.value().parse(separator_payload.state);
          const [next_tag, next_payload] = next;

          switch (next_tag) {
            case "left":
              return carry_consumed(next, true);
            case "right":
              values.push(next_payload.value);
              current = next_payload.state;
              consumed = true;
          }
        }
      }
    }
  });
}

export function sep_end_by<item, separator>(
  item_parser: ParserValue<item>,
  separator_parser: ParserValue<separator>,
): ParserValue<item[]> {
  return define_parser("sepEndBy " + item_parser.value().label, (state) => {
    const first = item_parser.value().parse(state);
    const [first_tag, first_payload] = first;

    switch (first_tag) {
      case "left":
        if (first_payload.consumed) {
          return first;
        }

        return ok_with([], state, false);
      case "right":
        if (!first_payload.consumed) {
          return failure(
            state,
            ["parser that consumes input"],
            "sepEndBy item parser accepted empty input",
            false,
          );
        }
        break;
    }

    const values: item[] = [first_payload.value];
    let current = first_payload.state;
    let consumed = first_payload.consumed;

    while (true) {
      const separator = separator_parser.value().parse(current);
      const [separator_tag, separator_payload] = separator;

      switch (separator_tag) {
        case "left":
          if (separator_payload.consumed) {
            return carry_consumed(separator, consumed);
          }

          return ok_with(values, current, consumed);
        case "right": {
          if (!separator_payload.consumed) {
            return failure(
              current,
              ["separator that consumes input"],
              "sepEndBy separator accepted empty input",
              consumed,
            );
          }

          const after_separator = separator_payload.state;
          const next = item_parser.value().parse(after_separator);
          const [next_tag, next_payload] = next;

          switch (next_tag) {
            case "left":
              if (next_payload.consumed) {
                return carry_consumed(next, true);
              }

              return ok_with(values, after_separator, true);
            case "right":
              if (!next_payload.consumed) {
                return failure(
                  after_separator,
                  ["parser that consumes input"],
                  "sepEndBy item parser accepted empty input",
                  true,
                );
              }

              values.push(next_payload.value);
              current = next_payload.state;
              consumed = true;
          }
        }
      }
    }
  });
}

export function lazy<item>(
  name: string,
  build: () => ParserValue<item>,
): ParserValue<item> {
  let cached: ParserValue<item> | undefined;

  return define_parser(name, (state) => {
    if (cached === undefined) {
      cached = build();
    }

    return cached.value().parse(state);
  });
}

export function current_char(state: ParseState): string | undefined {
  const code_point = state.input.codePointAt(state.offset);

  if (code_point === undefined) {
    return undefined;
  }

  return String.fromCodePoint(code_point);
}

function ok_with<item>(
  value: item,
  state: ParseState,
  consumed: boolean,
): ParseReply<item> {
  return ["right", {
    value,
    state,
    consumed,
  }];
}

function failure(
  state: ParseState,
  expected: readonly string[],
  message: string | undefined,
  consumed: boolean,
): ParseFailure {
  return ["left", {
    error: {
      position: {
        source: state.source,
        offset: state.offset,
        line: state.line,
        column: state.column,
      },
      expected: unique(expected),
      message,
    },
    consumed,
  }];
}

function carry_consumed<item>(
  reply: ParseFailure,
  previous_consumed: boolean,
): ParseReply<item> {
  if (!previous_consumed) {
    return reply;
  }

  return ["left", {
    error: reply[1].error,
    consumed: true,
  }];
}

function consumed_any(left_value: boolean, right_value: boolean): boolean {
  if (left_value) {
    return true;
  }

  if (right_value) {
    return true;
  }

  return false;
}

function advance_text(state: ParseState, text: string): ParseState {
  let current = state;

  for (const char of text) {
    current = advance(current, char);
  }

  return current;
}

function advance(state: ParseState, char: string): ParseState {
  let line = state.line;
  let column = state.column + 1;

  if (char === "\n") {
    line = state.line + 1;
    column = 1;
  }

  return {
    ...state,
    offset: state.offset + char.length,
    line,
    column,
  };
}

function merge_errors(
  left_error: ParseError,
  right_error: ParseError,
): ParseError {
  if (left_error.position.offset > right_error.position.offset) {
    return left_error;
  }

  if (right_error.position.offset > left_error.position.offset) {
    return right_error;
  }

  let message = left_error.message;

  if (message === undefined) {
    message = right_error.message;
  }

  return {
    position: left_error.position,
    expected: unique([...left_error.expected, ...right_error.expected]),
    message,
  };
}

function format_expected(expected: readonly string[]): string {
  if (expected.length === 0) {
    return "unknown input";
  }

  if (expected.length === 1) {
    return expected[0];
  }

  const initial = expected.slice(0, expected.length - 1);
  const last = expected[expected.length - 1];

  return initial.join(", ") + ", or " + last;
}

function unique(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    out.push(value);
  }

  return out;
}
