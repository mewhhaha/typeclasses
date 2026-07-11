type RuntimeDeno = {
  inspect?: (value: unknown, options?: { colors?: boolean }) => string;
};

/** Render a value without requiring a particular JavaScript runtime. */
export function inspect(value: unknown): string {
  const runtime = (globalThis as { Deno?: RuntimeDeno }).Deno;

  if (runtime?.inspect !== undefined) {
    return runtime.inspect(value, { colors: false });
  }

  return inspect_fallback(value, new Set<object>());
}

function inspect_fallback(value: unknown, seen: Set<object>): string {
  if (value === null) {
    return "null";
  }

  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "undefined":
      return "undefined";
    case "boolean":
      return String(value);
    case "number":
      if (Number.isNaN(value)) {
        return "NaN";
      }

      if (Object.is(value, -0)) {
        return "-0";
      }

      return String(value);
    case "bigint":
      return String(value) + "n";
    case "symbol":
      return String(value);
    case "function":
      return value.name === ""
        ? "[Function]"
        : "[Function: " + value.name + "]";
    case "object":
      return inspect_object(value, seen);
  }

  return String(value);
}

function inspect_object(value: object, seen: Set<object>): string {
  if (seen.has(value)) {
    return "[Circular]";
  }

  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time)
      ? "Invalid Date"
      : 'Date("' + value.toISOString() + '")';
  }

  if (value instanceof RegExp) {
    return String(value);
  }

  if (value instanceof Error) {
    return value.name + ": " + value.message;
  }

  seen.add(value);

  try {
    if (Array.isArray(value)) {
      return "[ " + value.map((item) =>
        inspect_fallback(item, seen)
      ).join(", ") +
        " ]";
    }

    if (value instanceof Map) {
      const entries = [...value].map(([key, item]) => {
        return inspect_fallback(key, seen) + " => " +
          inspect_fallback(item, seen);
      });
      return "Map(" + String(value.size) + ") { " + entries.join(", ") +
        " }";
    }

    if (value instanceof Set) {
      const items = [...value].map((item) => inspect_fallback(item, seen));
      return "Set(" + String(value.size) + ") { " + items.join(", ") + " }";
    }

    if (ArrayBuffer.isView(value)) {
      const name = value.constructor.name;
      const items = Array.from(value as unknown as ArrayLike<unknown>);
      return name + "(" + String(items.length) + ") [ " +
        items.map((item) => inspect_fallback(item, seen)).join(", ") + " ]";
    }

    if (value instanceof ArrayBuffer) {
      return "ArrayBuffer { byteLength: " + String(value.byteLength) + " }";
    }

    const record = value as Record<string, unknown>;
    const entries = Object.keys(record).sort().map((key) => {
      return inspect_key(key) + ": " + inspect_fallback(record[key], seen);
    });
    const constructor = value.constructor?.name;
    const prefix = constructor === undefined || constructor === "Object"
      ? ""
      : constructor + " ";

    return prefix + "{ " + entries.join(", ") + " }";
  } finally {
    seen.delete(value);
  }
}

function inspect_key(key: string): string {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) {
    return key;
  }

  return JSON.stringify(key);
}
