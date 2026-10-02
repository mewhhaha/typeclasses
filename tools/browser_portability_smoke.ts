import { build } from "esbuild";

const result = await build({
  stdin: {
    contents: `
import { Effect, from_fn, Just, run_task } from "./src/mod.ts";

run_task(Effect.lift(from_fn(async () => Just(20).map((value) => value + 22).value()[1])))
  .then((value) => fetch("/result?value=" + encodeURIComponent(String(value))))
  .catch((error) => fetch("/result?error=" + encodeURIComponent(String(error))));
`,
    loader: "ts",
    resolveDir: Deno.cwd(),
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  write: false,
});
const output = result.outputFiles[0]?.text;

if (output === undefined) {
  throw new Error("Browser portability build produced no JavaScript");
}

let report_result!: (value: URLSearchParams) => void;
const reported = new Promise<URLSearchParams>((resolve) => {
  report_result = resolve;
});
const html = `<!doctype html><script>
function report_browser_error(error) {
  fetch("/result?error=" + encodeURIComponent(String(error))).catch(() => {});
}
addEventListener("error", (event) => report_browser_error(event.error ?? event.message));
addEventListener("unhandledrejection", (event) => report_browser_error(event.reason));
</script><script>${output.replaceAll("</script", "<\\/script")}</script>`;
const server = Deno.serve({
  hostname: "127.0.0.1",
  port: 0,
  onListen() {},
}, (request) => {
  const url = new URL(request.url);

  if (url.pathname === "/result") {
    report_result(url.searchParams);
    return new Response("recorded");
  }

  return new Response(html, { headers: { "content-type": "text/html" } });
});
const address = server.addr as Deno.NetAddr;
const profile = await Deno.makeTempDir({ prefix: "typeclasses-browser-" });
const browser = await browser_command(
  `http://127.0.0.1:${address.port.toString()}`,
  profile,
);
const child = browser.command.spawn();
let browser_status: Deno.CommandStatus | undefined;
const exited = child.status.then((status) => {
  browser_status = status;
  return status;
});
const stderr_reader = child.stderr.getReader();
let stderr_tail = "";
const append_stderr = (text: string) => {
  stderr_tail = (stderr_tail + text).slice(-8192);
};
const stderr_drained = (async () => {
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await stderr_reader.read();
      if (done) break;
      append_stderr(decoder.decode(value, { stream: true }));
    }
    append_stderr(decoder.decode());
  } catch (error) {
    append_stderr(`\nCould not read browser stderr: ${String(error)}`);
  }
})();
let timeout: ReturnType<typeof setTimeout> | undefined;

try {
  try {
    const report = await Promise.race([
      reported,
      exited.then(() => {
        throw new Error("Browser exited before reporting a result");
      }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error("Browser portability smoke test timed out"));
        }, 15_000);
      }),
    ]);
    const error = report.get("error");

    if (error !== null) {
      throw new Error(`Browser portability smoke test failed: ${error}`);
    }

    if (report.get("value") !== "42") {
      throw new Error(
        `Browser portability smoke test expected 42; received ${
          String(report.get("value"))
        }`,
      );
    }
  } finally {
    clearTimeout(timeout);
    try {
      child.kill("SIGTERM");
    } catch {
      // The browser may have exited after reporting the result.
    }
    try {
      await exited;
    } finally {
      // Helpers can inherit stderr after the main browser exits. Cancel the
      // reader so cleanup never waits for those helpers to close the pipe.
      try {
        await stderr_reader.cancel();
      } catch (error) {
        append_stderr(`\nCould not cancel browser stderr: ${String(error)}`);
      }
      await stderr_drained;
      stderr_reader.releaseLock();
      try {
        await server.shutdown();
      } finally {
        await remove_browser_profile(profile);
      }
    }
  }
} catch (error) {
  throw new Error(
    `${
      error instanceof Error ? error.message : String(error)
    }\nBrowser: ${browser.path}\nExit: ${
      browser_status === undefined
        ? "unavailable"
        : `code=${browser_status.code.toString()}, signal=${
          String(browser_status.signal)
        }`
    }\nBrowser stderr (last 8192 characters):\n${stderr_tail || "(empty)"}`,
    { cause: error },
  );
}

async function remove_browser_profile(profile: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await Deno.remove(profile, { recursive: true });
      return;
    } catch (error) {
      const code = error instanceof Error
        ? (error as Error & { readonly code?: string }).code
        : undefined;

      if (code !== "ENOTEMPTY" || attempt === 9) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function browser_command(
  url: string,
  profile: string,
): Promise<{ readonly path: string; readonly command: Deno.Command }> {
  const candidates = [
    {
      path: "/usr/bin/google-chrome-stable",
      args: [
        "--headless=new",
        "--no-sandbox",
        `--user-data-dir=${profile}`,
        url,
      ],
    },
    {
      path: "/usr/bin/google-chrome",
      args: [
        "--headless=new",
        "--no-sandbox",
        `--user-data-dir=${profile}`,
        url,
      ],
    },
    {
      path: "/usr/bin/chromium",
      args: ["--headless", "--no-sandbox", `--user-data-dir=${profile}`, url],
    },
    {
      path: "/usr/bin/firefox",
      args: ["--headless", "--profile", profile, url],
    },
  ];

  for (const candidate of candidates) {
    try {
      const file = await Deno.stat(candidate.path);

      if (file.isFile) {
        return {
          path: candidate.path,
          command: new Deno.Command(candidate.path, {
            args: candidate.args,
            stdout: "null",
            stderr: "piped",
          }),
        };
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }

  throw new Error(
    "Browser portability smoke test needs Chrome, Chromium, or Firefox",
  );
}
