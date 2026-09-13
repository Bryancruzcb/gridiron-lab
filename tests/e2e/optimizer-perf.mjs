// Main-thread responsiveness while lineup solves run, measured in Chromium.
//
//   node tests/e2e/optimizer-perf.mjs --base http://127.0.0.1:18480 --label after-dev \
//     [--probe main,worker] [--runs 8] [--out artifacts/perf/after-dev.json]
//
// Page phases (dev or preview): the real 114-player slate through the page's own controls, typing
// into the search box while solves run. Probe phases (dev server only, they import /src modules):
// the same lineup job on the real slate and the 300-player fixture, on the main thread ("main") or
// in the optimizer worker ("worker"), while keys go into a plain input.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { arch, cpus, release, type } from "node:os";
import { chromium } from "playwright";
import { seeded } from "../domain/support/prng.ts";
import { randomPool } from "../domain/support/slates.ts";
import { isolateNetwork, parseArgs, readSlate, round, summarize, weekFixture } from "./optimizer-support.mjs";

/** @typedef {import("playwright").Page} Page */
/** @typedef {import("playwright").Browser} Browser */

const args = parseArgs(process.argv.slice(2));
const base = args.base ?? "http://127.0.0.1:18480";
const label = args.label ?? "run";
const runs = Number(args.runs ?? 8);
const probes = (args.probe ?? "").split(",").filter(Boolean);
const slate = readSlate();
const pool300 = randomPool(seeded(300), 300, { unit: 100, teams: 12 });

function observeResponsiveness() {
  /** @type {{ longtasks: any[], gaps: any[], keys: any[], events: any[] }} */
  const perf = { longtasks: [], gaps: [], keys: [], events: [] };
  /** @type {any} */ (window).__perf = perf;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) perf.longtasks.push({ start: e.startTime, dur: e.duration });
    }).observe({ type: "longtask", buffered: true });
  } catch {
    // Long Tasks API unavailable; the rAF gaps still measure blocking.
  }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) perf.events.push({ name: e.name, start: e.startTime, dur: e.duration });
    }).observe(/** @type {any} */ ({ type: "event", durationThreshold: 16, buffered: true }));
  } catch {
    // Event Timing unavailable.
  }
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    if (now - last > 17) perf.gaps.push({ at: last, gap: now - last });
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  document.addEventListener(
    "keydown",
    (e) => {
      const ts = e.timeStamp;
      requestAnimationFrame(() => perf.keys.push({ at: ts, lat: performance.now() - ts }));
    },
    true,
  );
}

/** @param {Page} page */
const now = (page) => page.evaluate(() => performance.now());

/** @param {Page} page @param {number} t0 @param {number} t1 */
async function windowMetrics(page, t0, t1) {
  const p = await page.evaluate(() => /** @type {any} */ (window).__perf);
  /** @param {number} t */
  const inWin = (t) => t >= t0 && t <= t1;
  /** @type {{ start: number, dur: number }[]} */
  const lt = p.longtasks.filter((/** @type {any} */ e) => inWin(e.start));
  /** @type {number[]} */
  const gaps = p.gaps.filter((/** @type {any} */ g) => inWin(g.at)).map((/** @type {any} */ g) => g.gap);
  /** @type {number[]} */
  const keys = p.keys.filter((/** @type {any} */ k) => inWin(k.at)).map((/** @type {any} */ k) => k.lat);
  /** @type {number[]} */
  const keyEvents = p.events
    .filter((/** @type {any} */ e) => inWin(e.start) && /^key|^input|^beforeinput/.test(e.name))
    .map((/** @type {any} */ e) => e.dur);
  return {
    windowMs: round(t1 - t0),
    longTasks: { count: lt.length, maxMs: round(Math.max(0, ...lt.map((e) => e.dur))), totalMs: round(lt.reduce((s, e) => s + e.dur, 0)) },
    maxFrameGapMs: round(Math.max(0, ...gaps)),
    keyToNextFrameMs: summarize(keys),
    eventTimingKeyMaxMs: keyEvents.length ? round(Math.max(...keyEvents)) : null,
  };
}

/** @param {Page} page */
async function waitIdle(page) {
  await page.waitForFunction(
    () => {
      const btns = [...document.querySelectorAll("button")];
      return !btns.some((b) => (b.textContent ?? "").includes("Solving"));
    },
    null,
    { timeout: 60000 },
  );
}

/** @param {Page} page @param {string} selector @param {() => boolean} stop */
async function typeUntil(page, selector, stop) {
  const box = page.locator(selector).first();
  do {
    await box.pressSequentially("kelce", { delay: 0 });
    await box.fill("");
  } while (!stop());
}

/** @param {Browser} browser */
async function pagePhases(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const net = await isolateNetwork(context, base, { week: weekFixture(slate.players), hold: true });
  await context.addInitScript(observeResponsiveness);
  const page = await context.newPage();
  /** @type {string[]} */
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/optimizer`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.getByRole("heading", { name: /^(Optimal|Best found)$/ }).waitFor({ timeout: 60000 });
  await waitIdle(page);
  await page.waitForTimeout(500);
  /** @type {Record<string, unknown>} */
  const out = {};

  // 1. Week scores arrive: the Backtest comparison (exact, hill-climb, greedy-value, hindsight).
  let t0 = await now(page);
  net.release();
  await page.getByRole("heading", { name: "Backtest" }).waitFor({ timeout: 60000 });
  await page.waitForFunction(() => !(document.body.textContent ?? "").includes("Comparing"), null, { timeout: 60000 });
  await page.waitForTimeout(300);
  out.weekArrivesCompare = await windowMetrics(page, t0, await now(page));

  const search = 'input[placeholder="Search player or team"]';
  const actualsBox = page.getByRole("checkbox").nth(1);
  const stackBox = page.getByRole("checkbox").nth(0);

  // 2. Hindsight on/off while typing.
  t0 = await now(page);
  for (let i = 0; i < Math.max(2, Math.floor(runs / 2)); i++) {
    for (const heading of [/^Hindsight$/, /^(Optimal|Best found)$/]) {
      await actualsBox.click();
      let done = false;
      const typing = typeUntil(page, search, () => done);
      await page.getByRole("heading", { name: heading }).waitFor({ timeout: 60000 });
      await waitIdle(page);
      done = true;
      await typing;
    }
  }
  out.hindsightToggleTyping = await windowMetrics(page, t0, await now(page));

  // 3. Stacked Build lineup while typing.
  await stackBox.click();
  await page.waitForTimeout(300);
  t0 = await now(page);
  for (let i = 0; i < runs; i++) {
    await page.getByRole("button", { name: /Build lineup/ }).click();
    await page.locator(search).pressSequentially("kelce", { delay: 0 });
    await page.locator(search).fill("");
    await waitIdle(page);
  }
  await page.waitForTimeout(200);
  out.stackedRunTyping = await windowMetrics(page, t0, await now(page));
  out.pageErrors = errors;
  out.serverFnCalls = net.calls;
  await context.close();
  return out;
}

/** @param {Browser} browser @param {string} kind */
async function probePhase(browser, kind) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await isolateNetwork(context, base, {});
  await context.addInitScript(observeResponsiveness);
  const page = await context.newPage();
  await page.goto(`${base}/optimizer`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.getByRole("heading", { name: /^(Optimal|Best found)$/ }).waitFor({ timeout: 60000 });
  await waitIdle(page);
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.id = "probe-input";
    input.style.cssText = "position:fixed;top:4px;left:4px;z-index:9999;width:120px";
    document.body.appendChild(input);
  });
  /** @type {Record<string, unknown>} */
  const results = {};
  for (const { name, players } of [
    { name: "real114", players: slate.players },
    { name: "fixture300", players: pool300 },
  ]) {
    const t0 = await now(page);
    let done = false;
    const typing = typeUntil(page, "#probe-input", () => done);
    const timings = await page.evaluate(
      /** @param {{ kind: string, players: any[], cap: number, reps: number }} arg */
      async ({ kind, players, cap, reps }) => {
        /** @param {number} ms */
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        /** @type {{ plain: number[], stack: number[], roundTrip: number[], methods: string[] }} */
        const out = { plain: [], stack: [], roundTrip: [], methods: [] };
        if (kind === "main") {
          const moduleUrl = "/src/lib/optimizer.ts";
          const { optimizeLineup, solveLineup } = await import(/* @vite-ignore */ moduleUrl);
          await sleep(50);
          for (let i = 0; i < reps; i++) {
            for (const requireStack of [false, true]) {
              const t = performance.now();
              const best = optimizeLineup({ players, cap, requireStack });
              solveLineup({ players, cap, requireStack, method: "greedy-value" });
              (requireStack ? out.stack : out.plain).push(performance.now() - t);
              out.methods.push(best.status === "ok" ? `${best.method}/${best.optimality}/${best.lineup.proj.toFixed(2)}` : best.status);
              await sleep(40);
            }
          }
        } else {
          const worker = new Worker("/src/workers/optimizer.worker.ts", { type: "module" });
          let id = 0;
          /** @param {boolean} requireStack @returns {Promise<{ data: any, rt: number }>} */
          const solve = (requireStack) =>
            new Promise((resolve, reject) => {
              const requestId = ++id;
              const t = performance.now();
              worker.onmessage = (e) => resolve({ data: e.data, rt: performance.now() - t });
              worker.onerror = (e) => reject(new Error(e.message));
              worker.postMessage({
                type: "solve",
                protocol: 1,
                requestId,
                fingerprint: `probe-${requestId}`,
                job: { kind: "lineup", mode: "proj", players, cap, locked: [], excluded: [], requireStack },
              });
            });
          await solve(false); // warm-up: module load and first-call JIT are not part of the timing
          for (let i = 0; i < reps; i++) {
            for (const requireStack of [false, true]) {
              const { data, rt } = await solve(requireStack);
              (requireStack ? out.stack : out.plain).push(data.elapsedMs);
              out.roundTrip.push(rt);
              const best = data.outcome?.best;
              out.methods.push(best?.status === "ok" ? `${best.method}/${best.optimality}/${best.lineup.proj.toFixed(2)}` : String(best?.status ?? data.type));
              await sleep(40);
            }
          }
          worker.terminate();
        }
        return out;
      },
      { kind, players, cap: slate.cap, reps: 5 },
    );
    done = true;
    await typing;
    const t1 = await now(page);
    results[name] = {
      players: players.length,
      cap: slate.cap,
      solverMs: { plain: summarize(timings.plain), stack: summarize(timings.stack) },
      roundTripMs: summarize(timings.roundTrip),
      results: [...new Set(timings.methods)],
      responsiveness: await windowMetrics(page, t0, t1),
    };
  }
  await context.close();
  return results;
}

const browser = await chromium.launch();
const cpu = cpus()[0];
/** @type {Record<string, unknown>} */
const probeResults = {};
const report = {
  label,
  base,
  measuredAt: new Date().toISOString(),
  env: {
    os: `${type()} ${release()} ${arch()}`,
    cpu: `${cpu?.model ?? "unknown"} (${cpus().length} logical)`,
    node: process.version,
    chromium: browser.version(),
    headless: true,
  },
  page: await pagePhases(browser),
  probes: probeResults,
};
for (const kind of probes) probeResults[kind] = await probePhase(browser, kind);
await browser.close();

const outPath = args.out ?? `artifacts/perf/${label}.json`;
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
