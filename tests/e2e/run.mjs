#!/usr/bin/env node
// Every browser check against one production preview, with deterministic live data:
//
//   npm run build
//   npm run test:e2e              (node tests/e2e/run.mjs [--only pages,analysis])
//
// Starts `npm run preview` on a free 127.0.0.1 port with GRIDIRON_LIVE_FIXTURE=cookie and the
// offline guard preloaded (tests/e2e/offline-guard.mjs), runs each script against it in turn,
// then always stops the whole server process tree. Fails when a script fails, when the server
// tried to reach any host other than loopback, or when the server does not stop.

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { OFFLINE_MARKER } from "./offline-guard.mjs";
import { parseArgs } from "./optimizer-support.mjs";

/** @typedef {import("node:child_process").ChildProcess} ChildProcess */
/** @typedef {{ name: string; file: string; args: (base: string) => string[]; env: (base: string) => NodeJS.ProcessEnv; timeoutMs: number }} Script */
/** @typedef {{ script: string; name: string; ok: boolean; detail?: string }} Row */

const WIN = process.platform === "win32";
const args = parseArgs(process.argv.slice(2));

/** @type {Script[]} */
const SCRIPTS = [
  { name: "pages", file: "tests/e2e/pages.mjs", args: (base) => ["--base", base], env: () => ({}), timeoutMs: 5 * 60_000 },
  // Keeps its ~35 s polling check: it is the only proof that /live and the provider share one loop.
  { name: "data-freshness", file: "tests/e2e/data-freshness.mjs", args: () => [], env: (base) => ({ GRIDIRON_E2E_URL: base }), timeoutMs: 6 * 60_000 },
  { name: "optimizer-flows", file: "tests/e2e/optimizer-flows.mjs", args: (base) => ["--base", base], env: () => ({}), timeoutMs: 8 * 60_000 },
  { name: "analysis", file: "tests/e2e/analysis.mjs", args: () => [], env: (base) => ({ GRIDIRON_E2E_URL: base }), timeoutMs: 8 * 60_000 },
];

/** @param {unknown} err */
const errText = (err) => (err instanceof Error ? err.message : String(err));

/** @returns {Promise<number>} */
function freePort() {
  return new Promise((done, fail) => {
    const srv = createServer();
    srv.once("error", fail);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => done(port));
    });
  });
}

/**
 * Kills a child and everything it started. On Windows npm runs through a shell, and killing that
 * process leaves node/vite running, so taskkill takes the whole tree; elsewhere the child leads its
 * own process group.
 * @param {ChildProcess | null} child
 * @param {NodeJS.Signals} [signal]
 */
function killTree(child, signal = "SIGTERM") {
  if (!child || child.pid == null || child.exitCode != null || child.signalCode != null) return;
  if (WIN) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

/**
 * npm is a .cmd shim on Windows, which only a shell can start. Node itself never needs one (and its
 * path usually has spaces), so only npm goes through the shell.
 * @param {string} command
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} env
 */
function start(command, argv, env) {
  /** @type {import("node:child_process").SpawnOptions} */
  const options = { env, stdio: ["ignore", "pipe", "pipe"] };
  if (!WIN) return spawn(command, argv, { ...options, detached: true });
  return command === "npm" ? spawn([command, ...argv].join(" "), { ...options, shell: true }) : spawn(command, argv, options);
}

/** @param {string} url */
async function answers(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Server state shared with the exit handlers. */
const server = { child: /** @type {ChildProcess | null} */ (null), log: "" };

function stopServerNow() {
  killTree(server.child, "SIGKILL");
}
process.on("exit", stopServerNow);
for (const sig of /** @type {NodeJS.Signals[]} */ (["SIGINT", "SIGTERM"])) {
  process.on(sig, () => {
    stopServerNow();
    process.exit(130);
  });
}

/** @param {string} base */
async function startServer(base) {
  const port = new URL(base).port;
  const guard = pathToFileURL(resolve("tests/e2e/offline-guard.mjs")).href;
  const env = {
    ...process.env,
    GRIDIRON_LIVE_FIXTURE: "cookie",
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${guard}`].filter(Boolean).join(" "),
  };
  const child = start("npm", ["run", "preview", "--", "--port", port, "--strictPort"], env);
  server.child = child;
  child.stdout?.on("data", (d) => (server.log += d));
  child.stderr?.on("data", (d) => (server.log += d));
  const end = Date.now() + 120_000;
  while (Date.now() < end) {
    if (child.exitCode != null) throw new Error(`preview exited with code ${child.exitCode} before answering`);
    if (await answers(base)) return;
    await sleep(500);
  }
  throw new Error(`preview did not answer at ${base} within 120 s`);
}

/** Stops the server and waits until the port no longer answers. @param {string} base */
async function stopServer(base) {
  killTree(server.child);
  const end = Date.now() + 15_000;
  while (Date.now() < end) {
    if (!(await answers(base))) return true;
    await sleep(250);
  }
  killTree(server.child, "SIGKILL");
  await sleep(1_000);
  return !(await answers(base));
}

/**
 * Runs one script with its output streamed under a prefix, and collects its scenario lines.
 * @param {Script} script
 * @param {string} base
 * @returns {Promise<{ code: number | null; rows: Row[]; ms: number; timedOut: boolean }>}
 */
function runScript(script, base) {
  const started = Date.now();
  // Node 22 needs the flag for the scripts' .ts imports; newer Node accepts and ignores it.
  const child = start(process.execPath, ["--experimental-strip-types", script.file, ...script.args(base)], { ...process.env, ...script.env(base) });
  /** @type {Row[]} */
  const rows = [];
  let pending = "";
  /** @param {Buffer} chunk */
  const onData = (chunk) => {
    pending += chunk.toString();
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      process.stdout.write(`[${script.name}] ${line}\n`);
      const m = /^(PASS|ok|FAIL)\s+(.+?)(?:\s+\(\d+ ms\))?$/.exec(line);
      if (m && m[2]) rows.push({ script: script.name, name: m[2], ok: m[1] !== "FAIL" });
    }
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killTree(child, "SIGKILL");
  }, script.timeoutMs);
  return new Promise((done) => {
    child.on("close", (code) => {
      clearTimeout(timer);
      if (pending) onData(Buffer.from("\n"));
      done({ code, rows, ms: Date.now() - started, timedOut });
    });
  });
}

/** @type {Row[]} */
const summary = [];
/** @type {{ name: string; code: number | null; ms: number }[]} */
const scriptRuns = [];
const only = args.only ? new Set(args.only.split(",")) : null;
const selected = SCRIPTS.filter((s) => !only || only.has(s.name));
const startedAll = Date.now();
let base = "";

try {
  if (!selected.length) throw new Error(`--only matched no script (known: ${SCRIPTS.map((s) => s.name).join(", ")})`);
  if (!existsSync(".vercel/output")) throw new Error("no production build in .vercel/output; run npm run build first");
  base = `http://127.0.0.1:${await freePort()}`;
  await startServer(base);
  console.log(`preview with GRIDIRON_LIVE_FIXTURE=cookie at ${base}`);
  for (const script of selected) {
    const run = await runScript(script, base);
    scriptRuns.push({ name: script.name, code: run.code, ms: run.ms });
    summary.push(...run.rows);
    const failedRows = run.rows.filter((r) => !r.ok).length;
    if (run.timedOut) summary.push({ script: script.name, name: `finished within ${script.timeoutMs / 60_000} min`, ok: false });
    else if (run.code !== 0 && failedRows === 0) summary.push({ script: script.name, name: "exited cleanly", ok: false, detail: `exit code ${run.code}` });
    else if (run.code === 0 && run.rows.length === 0) summary.push({ script: script.name, name: "reported its checks", ok: false, detail: "exit 0 with no scenario lines" });
    if (server.child?.exitCode != null) throw new Error(`preview server exited (code ${server.child.exitCode}) during ${script.name}`);
  }
} catch (err) {
  summary.push({ script: "run", name: "setup", ok: false, detail: `${errText(err)}\n${server.log.slice(-3_000)}` });
} finally {
  const blocked = server.log.split(/\r?\n/).filter((l) => l.includes(`${OFFLINE_MARKER} blocked`));
  if (server.child) {
    summary.push({ script: "run", name: "server made no request outside 127.0.0.1", ok: blocked.length === 0, detail: blocked.slice(0, 10).join("\n") });
    summary.push({ script: "run", name: "preview server stopped", ok: await stopServer(base) });
  }
}

const failed = summary.filter((r) => !r.ok);
console.log("\nBrowser checks");
for (const s of scriptRuns) console.log(`  ${s.name}: exit ${s.code} in ${Math.round(s.ms / 1000)} s`);
for (const r of summary) console.log(`  ${r.ok ? "PASS" : "FAIL"} ${r.script} · ${r.name}${!r.ok && r.detail ? `\n       ${r.detail.replace(/\n/g, "\n       ")}` : ""}`);
console.log(`${summary.length - failed.length}/${summary.length} passed in ${Math.round((Date.now() - startedAll) / 1000)} s`);
process.exitCode = failed.length ? 1 : 0;
