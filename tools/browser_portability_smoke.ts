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
const html = `<!doctype html><script>${
  output.replaceAll("</script", "<\\/script")
}</script>`;
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
const child = browser.spawn();
let timeout: ReturnType<typeof setTimeout> | undefined;

try {
  const report = await Promise.race([
    reported,
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
  await child.status;
  await server.shutdown();
  await Deno.remove(profile, { recursive: true });
}

async function browser_command(
  url: string,
  profile: string,
): Promise<Deno.Command> {
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
        return new Deno.Command(candidate.path, {
          args: candidate.args,
          stdout: "null",
          stderr: "piped",
        });
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }

  throw new Error(
    "Browser portability smoke test needs Chrome, Chromium, or Firefox",
  );
}
