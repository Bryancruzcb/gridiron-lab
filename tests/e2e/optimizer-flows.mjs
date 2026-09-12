// Lineup page flows against a running server (dev or `vite preview` of a production build):
//
//   node tests/e2e/optimizer-flows.mjs --base http://127.0.0.1:8080 [--only cancel,rapid-runs-no-leak]
//
// Live feeds are never contacted: getWeekPpr gets a fixture, other server functions answer 503,
// third-party hosts are aborted. Workers are counted by wrapping window.Worker in an init script.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { validateRoster } from "../../src/lib/football/lineup-validation.ts";
import { slateId } from "../../src/lib/lineup/selection.ts";
import { optimizeLineup } from "../../src/lib/optimizer.ts";
import { instrumentWorkers, isolateNetwork, parseArgs, readSlate, weekFixture, workerStats } from "./optimizer-support.mjs";

/** @typedef {import("playwright").Page} Page */
/** @typedef {import("playwright").Browser} Browser */
/** @typedef {import("playwright").BrowserContext} BrowserContext */
/** @typedef {import("../../src/lib/optimizer.ts").SolveOk} SolveOk */

const args = parseArgs(process.argv.slice(2));
const base = args.base ?? "http://127.0.0.1:8080";
const only = args.only ? new Set(args.only.split(",")) : null;
const TIMEOUT = 60000;
/** The lineup route with or without its selection in the query string. */
const OPTIMIZER_URL = /\/optimizer(\?.*)?$/;

const slate = readSlate();
const pool = slate.players;
const SLATE = slateId(slate.season, pool, slate.cap);

const qb = pool
  .filter((p) => p.pos === "QB")
  .sort((a, b) => a.salary - b.salary)
  .find((q) => pool.some((p) => p.team === q.team && (p.pos === "WR" || p.pos === "TE")));
const topWr = pool.filter((p) => p.pos === "WR" && p.team !== qb.team).sort((a, b) => b.proj - a.proj)[0];
const unscoredTe = pool.filter((p) => p.pos === "TE" && p.team !== qb.team).sort((a, b) => b.proj - a.proj)[0];
const partial = pool.filter((p) => p.pos === "RB").slice(0, 2).map((p) => p.id);
const week = weekFixture(pool, { missing: [unscoredTe.id], partial });
const fixtureActuals = new Map(week.players.map((r) => [r.espnId.slice("e2e-".length), r.ppr]));

/**
 * The Node solver's answer for what the page should show.
 * @param {{ mode?: string, locked?: string[], excluded?: string[], requireStack?: boolean }} opts
 * @returns {SolveOk}
 */
function expected({ mode = "proj", locked = [], excluded = [], requireStack = false }) {
  const players = mode === "actual" ? pool.filter((p) => fixtureActuals.has(p.id)).map((p) => ({ ...p, proj: fixtureActuals.get(p.id) })) : pool;
  const inPool = new Set(players.map((p) => p.id));
  const r = optimizeLineup({ players, cap: slate.cap, locked, excluded: excluded.filter((id) => inPool.has(id)), requireStack });
  if (r.status !== "ok") throw new Error(`Node solve failed: ${r.message}`);
  return r;
}

/** @type {{ name: string, ok: boolean, ms: number, error?: string }[]} */
const results = [];

/** @param {string} name @param {() => Promise<void>} fn */
async function scenario(name, fn) {
  if (only && !only.has(name)) return;
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`ok   ${name} (${Date.now() - started} ms)`);
  } catch (err) {
    const text = String(/** @type {any} */ (err)?.stack ?? err);
    results.push({ name, ok: false, ms: Date.now() - started, error: text });
    console.log(`FAIL ${name}\n${text}`);
  }
}

/**
 * @param {Browser} browser
 * @param {{ withWeek?: boolean, spinMs?: number, failConstruct?: boolean, memory?: unknown }} [opts]
 */
async function open(browser, { withWeek = true, spinMs = 0, failConstruct = false, memory } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await isolateNetwork(context, base, { week: withWeek ? week : undefined });
  await context.addInitScript(instrumentWorkers);
  await context.addInitScript(
    /** @param {{ spinMs: number, failConstruct: boolean, memory: unknown }} o */
    (o) => {
      const w = /** @type {any} */ (window);
      w.__e2eWorker.spinMs = o.spinMs;
      w.__e2eWorker.failConstruct = o.failConstruct;
      if (o.memory !== undefined) w.__gridironLabLineupSelection = o.memory;
    },
    { spinMs, failConstruct, memory },
  );
  const page = await context.newPage();
  /** @type {string[]} */
  const errors = [];
  /** @type {{ url: string, status: number, type: string | undefined }[]} */
  const workerAssets = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => {
    if (r.url().includes("optimizer.worker")) workerAssets.push({ url: r.url(), status: r.status(), type: r.headers()["content-type"] });
  });
  await page.goto(`${base}/optimizer`, { waitUntil: "domcontentloaded", timeout: 120000 });
  return { context, page, errors, workerAssets };
}

/** @param {Page} page @returns {Promise<any>} */
async function readCard(page) {
  return page.evaluate(() => {
    const el = /** @type {HTMLElement | null} */ (document.querySelector('[data-testid="lineup-result"]'));
    if (!el) return null;
    return {
      ...el.dataset,
      ids: [...el.querySelectorAll("li[data-player-id]")].map((li) => /** @type {HTMLElement} */ (li).dataset.playerId),
      text: el.textContent ?? "",
    };
  });
}

/**
 * Waits for a current result newer than `after` with nothing running.
 * @param {Page} page @param {number} [after]
 */
async function waitForResult(page, after = 0) {
  await page.waitForFunction(
    (after) => {
      const el = /** @type {HTMLElement | null} */ (document.querySelector('[data-testid="lineup-result"]'));
      const busy = [...document.querySelectorAll("button")].some((b) => (b.textContent ?? "").includes("Solving"));
      return el !== null && el.dataset.current === "true" && Number(el.dataset.requestId) > after && !busy;
    },
    after,
    { timeout: TIMEOUT },
  );
  return readCard(page);
}

/** @param {any} card @param {SolveOk} want */
function assertMatches(card, want) {
  assert.equal(card.method, want.method);
  assert.equal(card.optimality, want.optimality);
  assert.deepEqual(card.ids.slice().sort(), want.lineup.players.map((p) => p.id).sort());
  assert.equal(new Set(card.ids).size, 9);
  assert.ok(card.text.includes(`${want.lineup.proj.toFixed(1)} pts`), `card shows ${want.lineup.proj.toFixed(1)} pts`);
}

/** @param {Page} page @param {string} id */
const row = (page, id) => page.locator(`tr[data-player-id="${id}"]`);
/** @param {Page} page @param {string} id */
const lockBtn = (page, id) => row(page, id).locator("button").nth(0);
/** @param {Page} page @param {string} id */
const benchBtn = (page, id) => row(page, id).locator("button").nth(1);
/** @param {Page} page */
const stackBox = (page) => page.getByRole("checkbox").nth(0);
/** @param {Page} page */
const actualsBox = (page) => page.getByRole("checkbox").nth(1);
/** @param {Page} page */
const counts = (page) => page.getByTestId("selection-counts").innerText();

/**
 * The URL changes before the old route unmounts, so poll (bounded) for every worker to be terminated.
 * @param {Page} page @param {string} label
 */
async function waitNoLiveWorkers(page, label) {
  try {
    await page.waitForFunction(
      () => {
        const s = /** @type {any} */ (window).__workerStats;
        return s.constructed === s.terminated;
      },
      null,
      { timeout: 15000 },
    );
  } catch {
    assert.fail(`${label}: ${JSON.stringify(await workerStats(page))}`);
  }
  return workerStats(page);
}

/** @param {Page} page @param {number} ms */
function setSpin(page, ms) {
  return page.evaluate((ms) => {
    /** @type {any} */ (window).__e2eWorker.spinMs = ms;
  }, ms);
}

const browser = await chromium.launch();

await scenario("initial-solve-in-worker", async () => {
  const ctx = await open(browser);
  const card = await waitForResult(ctx.page);
  assertMatches(card, expected({}));
  assert.equal(card.mode, "proj");
  await ctx.page.waitForFunction(
    () => /** @type {HTMLElement | null} */ (document.querySelector('[data-testid="backtest"]'))?.dataset.current === "true",
    null,
    { timeout: TIMEOUT },
  );
  const backtest = await ctx.page.getByTestId("backtest").innerText();
  assert.match(backtest, /Exact DP\s+146\.0/);
  const stats = await workerStats(ctx.page);
  assert.deepEqual(stats.posted.map((/** @type {any} */ m) => m.kind).sort(), ["compare", "lineup"]);
  assert.ok(stats.received.every((/** @type {any} */ m) => m.type === "result"));
  assert.ok(ctx.workerAssets.length > 0 && ctx.workerAssets.every((a) => a.status === 200), JSON.stringify(ctx.workerAssets));
  assert.match(ctx.workerAssets[0]?.type ?? "", /javascript/);
  assert.deepEqual(ctx.errors, []);
  console.log(`     worker asset ${ctx.workerAssets[0]?.url} ${ctx.workerAssets[0]?.status}`);
  await ctx.context.close();
});

await scenario("constraints-mode-and-restore", async () => {
  const ctx = await open(browser);
  const { page } = ctx;
  const first = await waitForResult(page);

  // Case 1: lock a QB, bench a WR, require a stack, run.
  await lockBtn(page, qb.id).click();
  await benchBtn(page, topWr.id).click();
  await stackBox(page).click();
  assert.match(await counts(page), /^1 locked · 1 excluded/);
  assert.equal((await readCard(page)).current, "false", "an edited setup marks the old lineup outdated");
  await page.getByText("Setup changed since this lineup was built.").waitFor();
  await page.getByRole("button", { name: "Build lineup" }).click();
  const built = await waitForResult(page, Number(first.requestId));
  const want = expected({ locked: [qb.id], excluded: [topWr.id], requireStack: true });
  assertMatches(built, want);
  assert.equal(validateRoster(want.lineup.slots, { cap: slate.cap, locked: [qb.id], excluded: [topWr.id], requireStack: true }), null);

  // Case 4: change a lock and restore it; lock the benched WR and bench him again.
  await lockBtn(page, unscoredTe.id).click();
  assert.equal((await readCard(page)).current, "false");
  await lockBtn(page, unscoredTe.id).click();
  assert.equal((await readCard(page)).current, "true", "restoring the setup makes the same result current");
  await lockBtn(page, topWr.id).click();
  assert.match(await counts(page), /^2 locked · 0 excluded/);
  assert.equal(await lockBtn(page, topWr.id).getAttribute("aria-pressed"), "true");
  assert.equal(await benchBtn(page, topWr.id).getAttribute("aria-pressed"), "false");
  await benchBtn(page, topWr.id).click();
  assert.match(await counts(page), /^1 locked · 1 excluded/);
  assert.equal((await readCard(page)).requestId, built.requestId);
  assert.equal((await readCard(page)).current, "true");

  // Case 2: hindsight recomputes with the same constraints.
  await actualsBox(page).click();
  const hind = await waitForResult(page, Number(built.requestId));
  assert.equal(hind.mode, "actual");
  assertMatches(hind, expected({ mode: "actual", locked: [qb.id], excluded: [topWr.id], requireStack: true }));
  assert.match(hind.text, /upper bound/);
  assert.match(hind.text, /not a forecast/);
  assert.match(await counts(page), /^1 locked · 1 excluded/);
  assert.equal(await stackBox(page).getAttribute("aria-checked"), "true");

  // An unscored lock stays selected and is explained by name.
  await lockBtn(page, unscoredTe.id).click();
  const issue = page.locator('[data-issue="lock-unscored"]');
  await issue.waitFor();
  assert.ok((await issue.innerText()).includes(unscoredTe.name));
  assert.equal(await page.getByRole("button", { name: "Hindsight lineup" }).isDisabled(), true);
  assert.equal(await lockBtn(page, unscoredTe.id).getAttribute("aria-pressed"), "true");
  assert.equal((await readCard(page)).current, "false");

  // Back to projections: recomputes with both locks.
  await actualsBox(page).click();
  const back = await waitForResult(page, Number(hind.requestId));
  assert.equal(back.mode, "proj");
  assertMatches(back, expected({ locked: [qb.id, unscoredTe.id].sort(), excluded: [topWr.id], requireStack: true }));

  // Case 7 (in-memory): leave and re-enter the route, including browser back/forward.
  for (let i = 0; i < 3; i++) {
    await page.getByRole("link", { name: "Study", exact: true }).first().click();
    await page.waitForURL("**/study", { timeout: TIMEOUT });
    await waitNoLiveWorkers(page, `a worker survived leaving the route (cycle ${i})`);
    await page.goBack();
    await page.waitForURL(OPTIMIZER_URL, { timeout: TIMEOUT });
    const again = await waitForResult(page);
    assert.match(await counts(page), /^2 locked · 1 excluded/);
    assert.deepEqual(again.ids.slice().sort(), back.ids.slice().sort());
    await page.goForward();
    await page.waitForURL("**/study", { timeout: TIMEOUT });
    await page.goBack();
    await page.waitForURL(OPTIMIZER_URL, { timeout: TIMEOUT });
    await waitForResult(page);
  }
  const stats = await workerStats(page);
  assert.ok(stats.live <= 2, `live workers ${stats.live}`);

  // Case 6: reset clears the controls and recomputes the default lineup.
  const before = await readCard(page);
  await page.getByRole("button", { name: "Reset" }).click();
  const reset = await waitForResult(page, Number(before.requestId));
  assert.match(await counts(page), /^0 locked · 0 excluded/);
  assert.equal(await stackBox(page).getAttribute("aria-checked"), "false");
  assertMatches(reset, expected({}));
  assert.deepEqual(ctx.errors, []);
  await ctx.context.close();
});

await scenario("conflicting-import", async () => {
  const ctx = await open(browser, {
    memory: { version: 1, slate: SLATE, mode: "proj", locked: [qb.id, topWr.id], excluded: [qb.id], stack: true },
  });
  const { page } = ctx;
  await page.getByText("That lineup setup was not applied.").waitFor({ timeout: TIMEOUT });
  const status = await page.getByTestId("solve-status").innerText();
  assert.match(status, /1 player is both locked and benched/);
  assert.ok(status.includes(qb.name));
  assert.match(await counts(page), /^0 locked · 0 excluded/);
  const card = await waitForResult(page);
  assertMatches(card, expected({}));
  await page.getByRole("button", { name: "Dismiss" }).click();
  assert.equal(await page.getByText("That lineup setup was not applied.").count(), 0);
  assert.deepEqual(ctx.errors, []);
  await ctx.context.close();
});

await scenario("cancel", async () => {
  const ctx = await open(browser, { withWeek: false, spinMs: 4000 });
  const { page } = ctx;
  await page.getByRole("button", { name: "Cancel" }).waitFor({ timeout: TIMEOUT });
  await page.waitForFunction(() => /** @type {any} */ (window).__workerStats.posted.length > 0, null, { timeout: TIMEOUT });
  const beforeCancel = await workerStats(page);
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByText("Cancelled. Nothing was solved for this setup.").waitFor();
  const cancelled = await workerStats(page);
  assert.equal(cancelled.terminated, beforeCancel.terminated + 1, "cancel terminates the busy worker");
  assert.equal(cancelled.live, 0);
  await page.waitForTimeout(4500);
  const later = await workerStats(page);
  assert.equal(later.received.length, 0, "the cancelled solve never replies");
  assert.equal(await page.getByTestId("lineup-result").count(), 0);
  await setSpin(page, 0);
  await page.getByRole("button", { name: "Build lineup" }).click();
  assertMatches(await waitForResult(page), expected({}));
  assert.equal((await workerStats(page)).constructed, later.constructed + 1, "a new worker replaces the terminated one");
  assert.deepEqual(ctx.errors, []);
  await ctx.context.close();
});

await scenario("rapid-runs-no-leak", async () => {
  const ctx = await open(browser, { spinMs: 300 });
  const { page } = ctx;
  const first = await waitForResult(page);
  await lockBtn(page, qb.id).click();
  for (let i = 0; i < 7; i++) await actualsBox(page).click({ delay: 0 });
  const mid = await workerStats(page);
  assert.ok(mid.live <= 2, `live workers during rapid runs: ${mid.live}`);
  const final = await waitForResult(page, Number(first.requestId));
  assert.equal(final.mode, "actual");
  const stats = await workerStats(page);
  /** @type {number[]} */
  const lineupPosts = stats.posted.filter((/** @type {any} */ m) => m.kind === "lineup").map((/** @type {any} */ m) => m.requestId);
  assert.equal(Number(final.requestId), Math.max(...lineupPosts), "the newest request's result is the one shown");
  const replied = new Set(stats.received.map((/** @type {any} */ m) => m.requestId));
  const superseded = lineupPosts.filter((id) => id !== Number(final.requestId) && id !== Number(first.requestId));
  assert.ok(superseded.length >= 3, `superseded runs: ${superseded.length}`);
  assert.ok(superseded.every((id) => !replied.has(id)), "superseded solves were terminated before replying");
  assert.ok(stats.live <= 2);
  assertMatches(final, expected({ mode: "actual", locked: [qb.id] }));
  await page.getByRole("link", { name: "Study", exact: true }).first().click();
  await page.waitForURL("**/study", { timeout: TIMEOUT });
  const away = await waitNoLiveWorkers(page, "leaving the route left a worker running");
  console.log(`     constructed ${away.constructed}, terminated ${away.terminated}, superseded ${superseded.length}`);
  assert.deepEqual(ctx.errors, []);
  await ctx.context.close();
});

await scenario("navigate-away-mid-solve", async () => {
  const ctx = await open(browser, { spinMs: 2500 });
  const { page } = ctx;
  await page.getByRole("button", { name: "Cancel" }).waitFor({ timeout: TIMEOUT });
  await page.getByRole("link", { name: "Study", exact: true }).first().click();
  await page.waitForURL("**/study", { timeout: TIMEOUT });
  await waitNoLiveWorkers(page, "leaving mid-solve left a worker running");
  await page.waitForTimeout(3000);
  assert.equal((await workerStats(page)).received.length, 0, "no reply lands after the route unmounted");
  await setSpin(page, 0);
  await page.goBack();
  await page.waitForURL("**/optimizer", { timeout: TIMEOUT });
  assertMatches(await waitForResult(page), expected({}));
  assert.deepEqual(ctx.errors, []);
  await ctx.context.close();
});

await scenario("worker-construction-failure", async () => {
  const ctx = await open(browser, { withWeek: false, failConstruct: true });
  const { page } = ctx;
  const failure = page.locator('[data-failure="worker-unavailable"]');
  await failure.waitFor({ timeout: TIMEOUT });
  assert.match(await failure.innerText(), /could not start/);
  assert.equal(await page.getByTestId("lineup-result").count(), 0, "no lineup is solved on the main thread instead");
  await page.evaluate(() => {
    /** @type {any} */ (window).__e2eWorker.failConstruct = false;
  });
  await failure.getByRole("button", { name: "Retry" }).click();
  assertMatches(await waitForResult(page), expected({}));
  assert.deepEqual(ctx.errors, []);
  await ctx.context.close();
});

await scenario("worker-script-error", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await isolateNetwork(context, base, {});
  await context.addInitScript(instrumentWorkers);
  /** @param {import("playwright").Route} route */
  const block = (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "missing" });
  await context.route("**/*optimizer.worker*", block);
  const page = await context.newPage();
  /** @type {string[]} */
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/optimizer`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const failure = page.locator('[data-failure="worker-crashed"]');
  await failure.waitFor({ timeout: TIMEOUT });
  assert.equal((await workerStats(page)).live, 0, "a crashed worker is terminated");
  await context.unroute("**/*optimizer.worker*", block);
  await failure.getByRole("button", { name: "Retry" }).click();
  assertMatches(await waitForResult(page), expected({}));
  assert.deepEqual(errors, []);
  await context.close();
});

const chromiumVersion = browser.version();
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ base, chromium: chromiumVersion, passed: results.length - failed.length, failed: failed.length }, null, 2));
process.exit(failed.length ? 1 : 0);
