#!/usr/bin/env node
// Browser checks for shared and saved analyses against a production build:
//
//   npm run build
//   node tests/e2e/analysis.mjs [--only qb-link-history-and-slider,exports]
//
// Starts `npm run preview -- --port 8094` with GRIDIRON_LIVE_FIXTURE=cookie, so nothing here depends
// on ESPN or nflverse; each browser context picks its scenario through the gl_live_fixture cookie.
// Set GRIDIRON_E2E_URL to reuse a preview that already runs with the fixture switch, or
// GRIDIRON_E2E_PORT to use another port. Lineup checks that need hindsight mode answer getWeekPpr
// with a full-slate week instead (the fixture week has too few scored players to solve on).

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { lineupTotals, parseCsv, parseLineupExport } from "../../src/lib/analysis/export.ts";
import { validateRoster } from "../../src/lib/football/lineup-validation.ts";
import { actualsVersion, slateId } from "../../src/lib/lineup/selection.ts";
import { optimizeLineup } from "../../src/lib/optimizer.ts";
import { parseArgs, readSlate, weekFixture } from "./optimizer-support.mjs";

/** @typedef {import("playwright").Browser} Browser */
/** @typedef {import("playwright").BrowserContext} BrowserContext */
/** @typedef {import("playwright").Locator} Locator */
/** @typedef {import("playwright").Page} Page */
/** @typedef {{ child: import("node:child_process").ChildProcess; log: () => string }} Preview */
/** @typedef {{ spec?: string; fullWeek?: boolean; holdLabs?: boolean; clipboard?: boolean; noClipboard?: boolean; denyStorage?: boolean }} SessionOptions */
/** @typedef {{ context: BrowserContext; page: Page; errors: string[]; releaseLabs: () => void }} Session */
/** @typedef {{ id: string; name: string; season: number; splits: Record<string, { plays: number } | undefined> }} QbRow */

const args = parseArgs(process.argv.slice(2));
const only = args.only ? new Set(args.only.split(",")) : null;
const PORT = Number(process.env.GRIDIRON_E2E_PORT ?? 8094);
const OWN_SERVER = !process.env.GRIDIRON_E2E_URL;
const BASE = process.env.GRIDIRON_E2E_URL ?? `http://127.0.0.1:${PORT}`;
const WAIT = 30_000;
const STORE_KEY = "gridiron-lab:saved-analyses";

// ---- Data the checks pick from ----------------------------------------------------------

/** @type {QbRow[]} */
const qbRows = JSON.parse(readFileSync(new URL("../../src/data/qbs.json", import.meta.url), "utf8")).qbs;
const live2026 = new Set(
  [
    ...JSON.parse(readFileSync(new URL("../../src/data/season2026.json", import.meta.url), "utf8")).qbs,
    ...JSON.parse(readFileSync(new URL("../../tests/fixtures/football/live-labs.json", import.meta.url), "utf8")).qbs,
  ].map((/** @type {{ id: string }} */ q) => q.id),
);
const thirdDown = qbRows
  .filter((q) => q.season === 2025 && (q.splits.down3?.plays ?? 0) >= 100)
  .sort((a, b) => (b.splits.down3?.plays ?? 0) - (a.splits.down3?.plays ?? 0));
const qbA = thirdDown[0];
const qbB = thirdDown[1];
const notIn2026 = /** @type {QbRow} */ (qbRows.find((q) => q.season === 2025 && !live2026.has(q.id)));
assert.ok(qbA && qbB && notIn2026, "fixture quarterbacks");

const slate = readSlate();
const pool = slate.players;
const SLATE = slateId(slate.season, pool, slate.cap);
const lineupQb = pool
  .filter((p) => p.pos === "QB")
  .sort((a, b) => a.salary - b.salary)
  .find((q) => pool.some((p) => p.team === q.team && (p.pos === "WR" || p.pos === "TE")));
const topWr = pool.filter((p) => p.pos === "WR" && p.team !== lineupQb.team).sort((a, b) => b.proj - a.proj)[0];
const unscoredTe = pool.filter((p) => p.pos === "TE" && p.team !== lineupQb.team).sort((a, b) => b.proj - a.proj)[0];
const partialRbs = pool.filter((p) => p.pos === "RB").sort((a, b) => b.proj - a.proj).slice(0, 2).map((p) => p.id);
const week = weekFixture(pool, { missing: [unscoredTe.id], partial: partialRbs });
/** @type {Map<string, number>} */
const fixtureActuals = new Map(week.players.map((/** @type {{ espnId: string; ppr: number }} */ r) => [r.espnId.slice("e2e-".length), r.ppr]));
const FIXTURE_ACTUALS_VERSION = /** @type {string} */ (actualsVersion(fixtureActuals));

/** @param {{ mode?: string; locked?: string[]; excluded?: string[]; requireStack?: boolean }} opts */
function expectedIds({ mode = "proj", locked = [], excluded = [], requireStack = false }) {
  const players = mode === "actual" ? pool.filter((p) => fixtureActuals.has(p.id)).map((p) => ({ ...p, proj: fixtureActuals.get(p.id) })) : pool;
  const inPool = new Set(players.map((p) => p.id));
  const r = optimizeLineup({ players, cap: slate.cap, locked, excluded: excluded.filter((id) => inPool.has(id)), requireStack });
  if (r.status !== "ok") throw new Error(`Node solve failed: ${r.message}`);
  return r.lineup.players.map((p) => p.id).sort();
}

/** @param {string} name */
const serverFnId = (name) => createHash("sha256").update(`src/lib/live/functions.ts--${name}_createServerFn_handler`).digest("hex");
const WEEK_FN = serverFnId("getWeekPpr");
const LABS_FN = serverFnId("getSeasonLabs");

// ---- Preview server ---------------------------------------------------------------------

/** @returns {Preview} */
function startPreview() {
  const win = process.platform === "win32";
  /** @type {import("node:child_process").SpawnOptions} */
  const options = { env: { ...process.env, GRIDIRON_LIVE_FIXTURE: "cookie" }, stdio: ["ignore", "pipe", "pipe"] };
  const child = win
    ? spawn(`npm run preview -- --port ${PORT}`, { ...options, shell: true })
    : spawn("npm", ["run", "preview", "--", "--port", String(PORT)], { ...options, detached: true });
  let log = "";
  child.stdout?.on("data", (d) => (log += d));
  child.stderr?.on("data", (d) => (log += d));
  return { child, log: () => log };
}

/** @param {Preview | null} p */
function stopPreview(p) {
  const child = p?.child;
  if (!child || child.exitCode != null || child.pid == null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

/** @param {string} url @param {number} ms */
async function waitForServer(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`preview server did not answer at ${url} within ${ms} ms`);
}

// ---- Browser helpers --------------------------------------------------------------------

/** @param {BrowserContext} ctx @param {string} spec */
async function setSpec(ctx, spec) {
  const { hostname } = new URL(BASE);
  await ctx.addCookies([{ name: "gl_live_fixture", value: encodeURIComponent(spec), domain: hostname, path: "/" }]);
}

/** @param {Browser} browser @param {SessionOptions} [opts] @returns {Promise<Session>} */
async function session(browser, opts = {}) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    permissions: opts.clipboard ? ["clipboard-read", "clipboard-write"] : [],
  });
  await setSpec(context, opts.spec ?? "fresh");
  const origin = new URL(BASE).origin;
  await context.route(
    (url) => url.origin !== origin,
    (route) => route.abort(),
  );
  /** @type {() => void} */
  let release = () => {};
  const held = opts.holdLabs ? new Promise((resolve) => (release = () => resolve(undefined))) : null;
  if (opts.fullWeek || held) {
    await context.route("**/_serverFn/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (opts.fullWeek && path.endsWith(WEEK_FN)) {
        const feed = { data: week, source: "live", fetchedAt: week.fetchedAt, respondedAt: week.fetchedAt, error: null, partial: [] };
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ result: feed, context: {} }) });
        return;
      }
      if (held && path.endsWith(LABS_FN)) await held;
      await route.continue();
    });
  }
  if (opts.noClipboard)
    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "clipboard", { configurable: true, get: () => undefined });
    });
  if (opts.denyStorage)
    await context.addInitScript(() => {
      const deny = {
        configurable: true,
        get() {
          throw new DOMException("Storage is disabled for this browser check", "SecurityError");
        },
      };
      try {
        Object.defineProperty(window, "localStorage", deny);
      } catch {
        Object.defineProperty(Window.prototype, "localStorage", deny);
      }
    });
  const page = await context.newPage();
  /** @type {string[]} */
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return { context, page, errors, releaseLabs: () => release() };
}

/** Saved views read storage in an effect, so a ready panel means the page has hydrated. @param {Page} page */
async function hydrated(page) {
  await page.locator('[data-testid="saved-analyses"][data-ready="true"]').waitFor({ timeout: WAIT });
}

/** @param {Page} page @param {string} key @param {string | null} value */
async function waitForParam(page, key, value) {
  await page.waitForFunction(([k, v]) => new URL(location.href).searchParams.get(/** @type {string} */ (k)) === v, [key, value], { timeout: WAIT });
}

/** @param {Page} page @param {string} key */
const param = (page, key) => new URL(page.url()).searchParams.get(key);

/**
 * The address bar changes before React renders the new route state, so checks that follow a
 * navigation retry until they pass or the wait runs out.
 * @param {() => Promise<void>} check
 */
async function eventually(check) {
  const end = Date.now() + WAIT;
  for (;;) {
    try {
      await check();
      return;
    } catch (err) {
      if (Date.now() > end) throw err;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

/** @param {Locator} locator */
const isActive = async (locator) => ((await locator.getAttribute("class")) ?? "").includes("bg-accent");

/** @param {Page} page @returns {Promise<string[]>} */
const pinIds = (page) =>
  page.locator('[data-testid="pinned-list"] li[data-pin-id]').evaluateAll((els) => els.map((el) => el.getAttribute("data-pin-id") ?? ""));

/** @param {Page} page */
async function minPlays(page) {
  const text = await page.getByTestId("min-plays").innerText();
  return Number(/(\d+)\s*$/.exec(text)?.[1]);
}

/** @param {Page} page @param {string} label */
const sortButton = (page, label) => page.locator("h2", { hasText: "Board" }).locator("xpath=..").getByRole("button", { name: label, exact: true });

/** @param {Page} page @param {{ season: string; down: string; sort: string; min: number; pins: string[] }} want */
async function expectQbView(page, want) {
  assert.equal(await isActive(page.getByRole("button", { name: want.season, exact: true })), true, `season ${want.season} active`);
  assert.equal(await isActive(page.getByRole("button", { name: want.down, exact: true })), true, `down ${want.down} active`);
  assert.equal(await isActive(sortButton(page, want.sort)), true, `sort ${want.sort} active`);
  assert.equal(await minPlays(page), want.min);
  assert.deepEqual(await pinIds(page), want.pins);
}

/** @param {Page} page @param {string} label */
async function copyLink(page, label) {
  const box = page.getByTestId("copy-link").filter({ has: page.getByRole("button", { name: label, exact: true }) });
  await box.getByRole("button", { name: label, exact: true }).click();
  await box.getByRole("status").filter({ hasText: "Link copied." }).waitFor({ timeout: WAIT });
  const url = await box.getAttribute("data-url");
  assert.ok(url);
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), url, "the clipboard holds the link");
  return url;
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

/** A current result newer than `after`, with nothing solving. @param {Page} page @param {number} [after] */
async function waitForResult(page, after = 0) {
  await page.waitForFunction(
    (after) => {
      const el = /** @type {HTMLElement | null} */ (document.querySelector('[data-testid="lineup-result"]'));
      const busy = [...document.querySelectorAll("button")].some((b) => (b.textContent ?? "").includes("Solving"));
      return el !== null && el.dataset.current === "true" && Number(el.dataset.requestId) > after && !busy;
    },
    after,
    { timeout: WAIT },
  );
  return readCard(page);
}

/**
 * The player table shows one page at a time: go to page 1, then page forward until this player's row is on screen.
 * @param {Page} page @param {string} id
 */
async function rowOnPage(page, id) {
  const row = page.locator(`tr[data-player-id="${id}"]`);
  if (await row.count()) return row;
  const pager = page.getByTestId("pager-top");
  const current = pager.locator('[aria-current="page"]');
  await pager.getByRole("button", { name: "Page 1", exact: true }).click();
  await current.filter({ hasText: /^1$/ }).waitFor({ timeout: WAIT });
  for (let n = 1; !(await row.count()); n++) {
    const next = pager.getByRole("button", { name: "Next page" });
    assert.equal(await next.isDisabled(), false, `player ${id} is on no page of the table`);
    await next.click();
    await current.filter({ hasText: new RegExp(`^${n + 1}$`) }).waitFor({ timeout: WAIT });
  }
  return row;
}
/** @param {Page} page @param {string} id @param {number} n */
const rowButton = (page, id, n) => ({
  click: async () => (await rowOnPage(page, id)).locator("button").nth(n).click(),
  /** @param {string} name */
  getAttribute: async (name) => (await rowOnPage(page, id)).locator("button").nth(n).getAttribute(name),
});
/** @param {Page} page @param {string} id */
const lockBtn = (page, id) => rowButton(page, id, 0);
/** @param {Page} page @param {string} id */
const benchBtn = (page, id) => rowButton(page, id, 1);
/** @param {Page} page */
const stackBox = (page) => page.getByRole("checkbox").nth(0);
/** @param {Page} page */
const actualsBox = (page) => page.getByRole("checkbox").nth(1);
/** @param {Page} page */
const counts = (page) => page.getByTestId("selection-counts").innerText();

/** @param {import("playwright").Download} download */
async function downloaded(download) {
  const path = await download.path();
  assert.ok(path, "download saved");
  return readFileSync(path, "utf8");
}

// ---- Scenarios --------------------------------------------------------------------------

/** @type {{ name: string; ok: boolean; ms: number; error?: string }[]} */
const results = [];

/** @param {string} name @param {() => Promise<void>} fn */
async function scenario(name, fn) {
  if (only && !only.has(name)) return;
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - started, error: String(/** @type {any} */ (err)?.stack ?? err) });
  }
}

/** @param {Browser} browser */
async function run(browser) {
  await scenario("qb-link-history-and-slider", async () => {
    const s = await session(browser, { clipboard: true });
    const { page } = s;
    await page.goto(`${BASE}/qb?season=2025&down=3&sort=cpoe&pins=`);
    await hydrated(page);
    assert.deepEqual(await pinIds(page), [], "an explicit empty pin list is not replaced by defaults");
    await page.locator(`tr[data-qb-id="${qbA.id}"]`).click();
    await waitForParam(page, "pins", qbA.id);
    await page.locator(`tr[data-qb-id="${qbB.id}"]`).click();
    await waitForParam(page, "pins", `${qbA.id}.${qbB.id}`);
    assert.deepEqual(await pinIds(page), [qbA.id, qbB.id]);
    assert.equal(param(page, "min"), null);

    // Slider ticks replace the current entry: keyboard steps and a pointer drag add no history.
    const entries = await page.evaluate(() => history.length);
    const thumb = page.getByRole("slider");
    await thumb.focus();
    for (let i = 0; i < 3; i++) await thumb.press("ArrowRight");
    await waitForParam(page, "min", "55");
    assert.equal(await page.evaluate(() => history.length), entries, "keyboard ticks added history entries");
    const box = await thumb.boundingBox();
    assert.ok(box);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + box.width / 2 + i * 4, box.y + box.height / 2);
    await page.mouse.up();
    await page.waitForFunction(() => Number(new URL(location.href).searchParams.get("min")) > 55, null, { timeout: WAIT });
    assert.equal(await page.evaluate(() => history.length), entries, "a drag added history entries");
    const min = Number(param(page, "min"));
    assert.equal(await minPlays(page), min);

    const url = await copyLink(page, "Copy link");
    const shared = new URL(url);
    assert.deepEqual(
      Object.fromEntries(shared.searchParams),
      { season: "2025", down: "3", min: String(min), sort: "cpoe", pins: `${qbA.id}.${qbB.id}` },
    );

    // Back returns to the entry before the second pin (the slider replaced the later one); forward restores it.
    const view = { season: "2025", down: "3rd", sort: "CPOE", min, pins: [qbA.id, qbB.id] };
    await page.goBack();
    await waitForParam(page, "pins", qbA.id);
    await eventually(async () => assert.deepEqual(await pinIds(page), [qbA.id]));
    assert.equal(param(page, "min"), null);
    await page.goForward();
    await waitForParam(page, "pins", `${qbA.id}.${qbB.id}`);
    await eventually(() => expectQbView(page, view));

    const fresh = await session(browser);
    await fresh.page.goto(url);
    await hydrated(fresh.page);
    await expectQbView(fresh.page, view);
    await fresh.page.reload();
    await hydrated(fresh.page);
    await expectQbView(fresh.page, view);
    assert.deepEqual([...s.errors, ...fresh.errors], []);
    await fresh.context.close();
    await s.context.close();
  });

  await scenario("qb-copy-link-fallback", async () => {
    const s = await session(browser, { noClipboard: true });
    const { page } = s;
    await page.goto(`${BASE}/qb?season=2024&sort=press`);
    await hydrated(page);
    await page.getByRole("button", { name: "Copy link", exact: true }).click();
    const field = page.getByTestId("copy-link-fallback");
    await field.waitFor({ timeout: WAIT });
    const value = await field.inputValue();
    assert.equal(new URL(value).searchParams.get("season"), "2024");
    assert.equal(new URL(value).searchParams.get("sort"), "press");
    assert.match(await page.getByTestId("copy-link").getByRole("status").innerText(), /copy it by hand/);
    const selected = await field.evaluate((el) => {
      const input = /** @type {HTMLInputElement} */ (el);
      return document.activeElement === input && input.selectionStart === 0 && input.selectionEnd === input.value.length;
    });
    assert.equal(selected, true, "the fallback link is focused and selected");
    assert.deepEqual(s.errors, []);
    await s.context.close();
  });

  await scenario("qb-unresolved-pins", async () => {
    const s = await session(browser, { holdLabs: true });
    const { page } = s;
    await page.goto(`${BASE}/qb?season=2026&pins=00-0039851.99-0000001`);
    await hydrated(page);
    const unknown = page.locator('li[data-pin-id="99-0000001"]');
    await page.locator('li[data-pin-id="99-0000001"][data-unresolved="pending"]').waitFor({ timeout: WAIT });
    assert.match(await unknown.innerText(), /Waiting for the live 2026 file/);
    assert.equal(await page.locator('li[data-pin-id="00-0039851"] p.font-medium').innerText(), "Drake Maye");
    s.releaseLabs();
    await page.locator('li[data-pin-id="99-0000001"][data-unresolved="explained"]').waitFor({ timeout: WAIT });
    assert.match(await unknown.innerText(), /No quarterback with id 99-0000001 in this data/);
    assert.deepEqual(await pinIds(page), ["00-0039851", "99-0000001"], "the unknown pin stays listed");

    await page.goto(`${BASE}/qb?season=2026&pins=${notIn2026.id}`);
    await hydrated(page);
    const other = page.locator(`li[data-pin-id="${notIn2026.id}"][data-unresolved="explained"]`);
    await other.waitFor({ timeout: WAIT });
    assert.match(await other.innerText(), new RegExp(`No 2026 rows. This quarterback has data for .*2025`));
    await page.getByRole("button", { name: `Unpin ${notIn2026.name}` }).click();
    await waitForParam(page, "pins", "");
    await eventually(async () => assert.deepEqual(await pinIds(page), []));
    assert.deepEqual(s.errors, []);
    await s.context.close();
  });

  await scenario("qb-malformed-link", async () => {
    const s = await session(browser);
    const { page } = s;
    const many = Array.from({ length: 100 }, (_, i) => `00-${String(i).padStart(7, "0")}`).join(".");
    await page.goto(`${BASE}/qb?season=abc&down=9&sort=zzz&min=99999&pins=${many}`);
    await hydrated(page);
    const issues = page.getByTestId("link-issues");
    await issues.waitFor({ timeout: WAIT });
    const text = await issues.innerText();
    for (const pattern of [/Season "abc" is not a season; showing 2026/, /Down "9" is not an option/, /Sort "zzz" is not an option/, /outside this slice's 5–80 range; using 80/, /pins 100 ids; showing the default pins/])
      assert.match(text, pattern);
    assert.equal(await page.locator("h1", { hasText: "QB" }).isVisible(), true);
    assert.equal(await isActive(page.getByRole("button", { name: "2026", exact: true })), true);
    assert.equal(await minPlays(page), 80);
    assert.equal((await pinIds(page)).length, 3, "default pins");
    await issues.getByRole("button", { name: "Dismiss" }).click();
    await waitForParam(page, "down", null);
    assert.equal(await page.getByTestId("link-issues").count(), 0);
    assert.deepEqual(Object.fromEntries(new URL(page.url()).searchParams), { season: "2026", min: "80" });

    await page.goto(`${BASE}/qb?season=2025&down=3&sit=redzone`);
    await hydrated(page);
    await page.getByTestId("link-issues").filter({ hasText: "A situation filter replaces down and distance" }).waitFor({ timeout: WAIT });
    assert.equal(await isActive(page.getByRole("button", { name: "Red zone", exact: true })), true);
    assert.equal(await isActive(page.getByRole("button", { name: "3rd", exact: true })), false);
    assert.deepEqual(s.errors, []);
    await s.context.close();
  });

  await scenario("optimizer-link-roundtrip", async () => {
    const s = await session(browser, { fullWeek: true, clipboard: true });
    const { page } = s;
    await page.goto(`${BASE}/optimizer`);
    await hydrated(page);
    const first = await waitForResult(page);
    await lockBtn(page, lineupQb.id).click();
    await benchBtn(page, topWr.id).click();
    await stackBox(page).click();
    await page.getByRole("button", { name: "Build lineup" }).click();
    const built = await waitForResult(page, Number(first.requestId));
    await actualsBox(page).click();
    const hind = await waitForResult(page, Number(built.requestId));
    const setup = { locked: [lineupQb.id], excluded: [topWr.id], requireStack: true };
    assert.equal(hind.mode, "actual");
    assert.deepEqual(hind.ids.slice().sort(), expectedIds({ ...setup, mode: "actual" }));
    assert.equal(hind.slate, SLATE);
    assert.equal(hind.actualsVersion, FIXTURE_ACTUALS_VERSION);
    const version = await page.getByTestId("input-version").innerText();
    assert.ok(version.includes(SLATE) && version.includes(FIXTURE_ACTUALS_VERSION), version);

    const url = await copyLink(page, "Copy link to this setup");
    assert.equal(url, `${BASE}/optimizer?slate=${SLATE}&mode=actual&lock=${lineupQb.id}&bench=${topWr.id}&stack=true`);
    assert.equal(page.url(), url, "the address bar carries the same setup");

    // Back is the entry before hindsight mode; the setup is restored and recomputed.
    await page.goBack();
    await waitForParam(page, "mode", null);
    const back = await waitForResult(page, Number(hind.requestId));
    assert.equal(back.mode, "proj");
    assert.deepEqual(back.ids.slice().sort(), expectedIds(setup));
    assert.match(await counts(page), /^1 locked · 1 excluded/);
    assert.equal(await stackBox(page).getAttribute("aria-checked"), "true");
    assert.equal(await actualsBox(page).getAttribute("aria-checked"), "false");
    await page.goForward();
    await waitForParam(page, "mode", "actual");
    const forward = await waitForResult(page, Number(back.requestId));
    assert.equal(forward.mode, "actual");

    const fresh = await session(browser, { fullWeek: true });
    await fresh.page.goto(url);
    await hydrated(fresh.page);
    for (let pass = 0; pass < 2; pass++) {
      const card = await waitForResult(fresh.page);
      assert.equal(card.mode, "actual");
      assert.deepEqual(card.ids.slice().sort(), hind.ids.slice().sort());
      assert.equal(card.slate, SLATE);
      assert.equal(card.actualsVersion, FIXTURE_ACTUALS_VERSION);
      assert.match(await counts(fresh.page), /^1 locked · 1 excluded/);
      assert.equal(await stackBox(fresh.page).getAttribute("aria-checked"), "true");
      assert.equal(await actualsBox(fresh.page).getAttribute("aria-checked"), "true");
      assert.equal(await lockBtn(fresh.page, lineupQb.id).getAttribute("aria-pressed"), "true");
      assert.equal(await benchBtn(fresh.page, topWr.id).getAttribute("aria-pressed"), "true");
      if (pass === 0) {
        await fresh.page.reload();
        await hydrated(fresh.page);
      }
    }
    assert.deepEqual([...s.errors, ...fresh.errors], []);
    await fresh.context.close();
    await s.context.close();
  });

  await scenario("optimizer-malformed-links", async () => {
    const s = await session(browser);
    const defaultIds = expectedIds({});
    const fake = Array.from({ length: 300 }, (_, i) => `00-${String(9000000 + i)}`).join(".");
    const cases = [
      { query: `lock=${lineupQb.id}.${topWr.id}&bench=${topWr.id}`, patterns: [/1 player is both locked and benched/, new RegExp(topWr.name)] },
      { query: `lock=${fake}`, patterns: [/Locked lists 300 ids; the limit is 250/] },
      { query: "mode=dream&stack=maybe", patterns: [/Mode must be "proj" or "actual"/, /Stack must be true or false/] },
    ];
    for (const c of cases) {
      const page = await s.context.newPage();
      page.on("pageerror", (e) => s.errors.push(String(e)));
      await page.goto(`${BASE}/optimizer?${c.query}`);
      await hydrated(page);
      await page.getByText("That lineup setup was not applied.").waitFor({ timeout: WAIT });
      const status = await page.getByTestId("solve-status").innerText();
      for (const pattern of c.patterns) assert.match(status, pattern, c.query.slice(0, 60));
      assert.match(await counts(page), /^0 locked · 0 excluded/);
      const card = await waitForResult(page);
      assert.deepEqual(card.ids.slice().sort(), defaultIds, "only the legal unconstrained lineup renders");
      await page.close();
    }

    const page = await s.context.newPage();
    page.on("pageerror", (e) => s.errors.push(String(e)));
    await page.goto(`${BASE}/optimizer?lock=NOT-ON-SLATE`);
    await hydrated(page);
    const issue = page.locator('[data-issue="lock-not-on-slate"]');
    await issue.waitFor({ timeout: WAIT });
    assert.match(await issue.innerText(), /NOT-ON-SLATE/);
    assert.match(await counts(page), /^1 locked · 0 excluded/);
    assert.equal(await page.getByRole("button", { name: "Build lineup" }).isDisabled(), true);
    await page.waitForTimeout(1500);
    assert.equal(await page.getByTestId("lineup-result").count(), 0, "no lineup for an unknown lock");
    assert.equal(await page.locator("h1", { hasText: "Lineup" }).isVisible(), true);
    assert.deepEqual(s.errors, []);
    await s.context.close();
  });

  await scenario("saved-views-lifecycle", async () => {
    const s = await session(browser);
    const { page } = s;
    const view = { season: "2025", down: "3rd", sort: "CPOE", min: 60, pins: [qbA.id, qbB.id] };
    await page.goto(`${BASE}/qb?season=2025&down=3&sort=cpoe&min=60&pins=${qbA.id}.${qbB.id}`);
    await hydrated(page);
    const panel = page.getByTestId("saved-analyses");
    await panel.getByLabel("Name for this view").fill("Third down, 2025");
    await panel.getByRole("button", { name: "Save view" }).click();
    await panel.locator("li[data-saved-id]", { hasText: "Third down, 2025" }).waitFor({ timeout: WAIT });

    await page.goto(`${BASE}/qb`);
    await hydrated(page);
    await page.reload();
    await hydrated(page);
    await panel.getByRole("button", { name: "Open Third down, 2025", exact: true }).click();
    await waitForParam(page, "down", "3");
    await eventually(() => expectQbView(page, view));

    await panel.getByRole("button", { name: "Rename Third down, 2025", exact: true }).click();
    await panel.getByLabel("New name for Third down, 2025").fill("3rd and long look");
    await panel.getByRole("button", { name: "Save name" }).click();
    await panel.locator("[data-saved-name]", { hasText: "3rd and long look" }).waitFor({ timeout: WAIT });
    await page.reload();
    await hydrated(page);
    assert.deepEqual(await panel.locator("[data-saved-name]").allInnerTexts(), ["3rd and long look"]);

    await panel.getByRole("button", { name: "Delete 3rd and long look", exact: true }).click();
    await panel.getByText("No saved views yet.").waitFor({ timeout: WAIT });
    await page.reload();
    await hydrated(page);
    assert.equal(await panel.locator("li[data-saved-id]").count(), 0);

    // Lineup views are kept apart from QB views and reopen their constraints.
    await page.goto(`${BASE}/optimizer`);
    await hydrated(page);
    await waitForResult(page);
    await lockBtn(page, lineupQb.id).click();
    await stackBox(page).click();
    await panel.getByLabel("Name for this view").fill("Cheap QB stack");
    await panel.getByRole("button", { name: "Save view" }).click();
    await panel.locator("[data-saved-name]", { hasText: "Cheap QB stack" }).waitFor({ timeout: WAIT });
    await page.getByRole("button", { name: "Reset" }).click();
    await waitForParam(page, "lock", null);
    await page.reload();
    await hydrated(page);
    const beforeOpen = await waitForResult(page);
    assert.match(await counts(page), /^0 locked · 0 excluded/);
    await panel.getByRole("button", { name: "Open Cheap QB stack", exact: true }).click();
    await waitForParam(page, "lock", lineupQb.id);
    await waitForResult(page, Number(beforeOpen.requestId));
    assert.match(await counts(page), /^1 locked · 0 excluded/);
    assert.equal(await stackBox(page).getAttribute("aria-checked"), "true");
    await page.goto(`${BASE}/qb`);
    await hydrated(page);
    assert.equal(await panel.locator("li[data-saved-id]").count(), 0, "the lineup view is not listed on the QB page");
    assert.deepEqual(s.errors, []);
    await s.context.close();
  });

  await scenario("storage-failures", async () => {
    const s = await session(browser);
    const { page } = s;
    await page.goto(`${BASE}/guide`);
    await page.evaluate((key) => localStorage.setItem(key, "{not json"), STORE_KEY);
    await page.goto(`${BASE}/qb`);
    await page.locator('[data-testid="saved-analyses"][data-error="corrupt"]').waitFor({ timeout: WAIT });
    assert.match(await page.getByTestId("saved-error").innerText(), /damaged/);
    assert.equal(await page.locator("h1", { hasText: "QB" }).isVisible(), true);
    assert.ok((await page.locator("tr[data-qb-id]").count()) > 0, "the board still renders");
    assert.equal(await page.getByRole("button", { name: "Save view" }).isDisabled(), true);
    await page.getByRole("button", { name: "Start over" }).click();
    await page.getByRole("button", { name: "Delete all" }).click();
    await page.getByText("No saved views yet.").waitFor({ timeout: WAIT });
    await page.getByRole("button", { name: "Save view" }).click();
    await page.locator("li[data-saved-id]").first().waitFor({ timeout: WAIT });
    await page.reload();
    await hydrated(page);
    assert.equal(await page.locator("li[data-saved-id]").count(), 1, "saving works again after starting over");

    const future = JSON.stringify({ schemaVersion: 99, analyses: [{ kept: true }] });
    await page.evaluate(([key, value]) => localStorage.setItem(/** @type {string} */ (key), /** @type {string} */ (value)), [STORE_KEY, future]);
    await page.goto(`${BASE}/optimizer`);
    await page.locator('[data-testid="saved-analyses"][data-error="unsupported-version"]').waitFor({ timeout: WAIT });
    assert.match(await page.getByTestId("saved-error").innerText(), /format version 99/);
    await waitForResult(page);
    await page.reload();
    await hydrated(page);
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), STORE_KEY), future, "a newer format is left untouched");

    const denied = await session(browser, { denyStorage: true });
    for (const path of ["/qb", "/optimizer", "/"]) {
      await denied.page.goto(`${BASE}${path}`);
      await denied.page.waitForLoadState("load");
      if (path === "/") continue;
      await denied.page.locator('[data-testid="saved-analyses"][data-error="unavailable"]').waitFor({ timeout: WAIT });
      assert.match(await denied.page.getByTestId("saved-error").innerText(), /not letting the page use local storage/);
    }
    await denied.page.goto(`${BASE}/optimizer`);
    await hydrated(denied.page);
    await waitForResult(denied.page);
    assert.deepEqual([...s.errors, ...denied.errors], []);
    await denied.context.close();
    await s.context.close();
  });

  await scenario("refresh-keeps-pins-and-constraints", async () => {
    const s = await session(browser, { spec: "labs:stale|weekPpr:stale" });
    const { page } = s;
    await page.goto(`${BASE}/qb?season=2026&pins=00-0037834`);
    await hydrated(page);
    const labsStale = '[data-feed-status="labs-qbs"][data-freshness="stale"]';
    await page.waitForSelector(labsStale, { timeout: WAIT });
    await page.locator('tr[data-qb-id="00-0026498"]').click();
    await waitForParam(page, "pins", "00-0037834.00-0026498");
    const qbUrl = page.url();
    await setSpec(s.context, "labs:fresh|weekPpr:stale");
    await page.locator(`${labsStale} button`, { hasText: "Retry" }).click();
    await page.waitForSelector('[data-feed-status="labs-qbs"][data-source="live"][data-freshness="fresh"]', { timeout: WAIT });
    assert.deepEqual(await pinIds(page), ["00-0037834", "00-0026498"]);
    assert.equal(page.url(), qbUrl);

    await setSpec(s.context, "labs:fresh|weekPpr:stale");
    await page.goto(`${BASE}/optimizer`);
    await hydrated(page);
    const weekStale = '[data-feed-status="weekPpr"][data-freshness="stale"]';
    await page.waitForSelector(weekStale, { timeout: WAIT });
    await waitForResult(page);
    await lockBtn(page, lineupQb.id).click();
    await benchBtn(page, topWr.id).click();
    await stackBox(page).click();
    await waitForParam(page, "stack", "true");
    const lineupUrl = page.url();
    await setSpec(s.context, "labs:fresh|weekPpr:fresh");
    await page.locator(`${weekStale} button`, { hasText: "Retry" }).click();
    await page.waitForSelector('[data-feed-status="weekPpr"][data-source="live"][data-freshness="fresh"]', { timeout: WAIT });
    assert.match(await counts(page), /^1 locked · 1 excluded/);
    assert.equal(await lockBtn(page, lineupQb.id).getAttribute("aria-pressed"), "true");
    assert.equal(await benchBtn(page, topWr.id).getAttribute("aria-pressed"), "true");
    assert.equal(await stackBox(page).getAttribute("aria-checked"), "true");
    assert.equal(page.url(), lineupUrl);
    assert.deepEqual(s.errors, []);
    await s.context.close();
  });

  await scenario("exports", async () => {
    const s = await session(browser, { fullWeek: true });
    const { page } = s;
    await page.goto(`${BASE}/optimizer`);
    await hydrated(page);
    // Week scores load a moment after the page; the export should carry them.
    await page.waitForSelector('[data-feed-status="weekPpr"][data-source="live"]', { timeout: WAIT });
    const first = await waitForResult(page);
    await lockBtn(page, lineupQb.id).click();
    await benchBtn(page, topWr.id).click();
    await page.getByRole("button", { name: "Build lineup" }).click();
    const card = await waitForResult(page, Number(first.requestId));
    const hostile = '=HYPERLINK("https://evil.example","open"),"quoted"';
    const panel = page.getByTestId("saved-analyses");
    await panel.getByLabel("Name for this view").fill(hostile);
    await panel.getByRole("button", { name: "Save view" }).click();
    await panel.locator("[data-saved-name]", { hasText: "evil.example" }).waitFor({ timeout: WAIT });

    const [jsonDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export JSON", exact: true }).click()]);
    assert.match(jsonDownload.suggestedFilename(), /^gridiron-lineup-proj-\d{4}-\d{2}-\d{2}T\d{6}Z\.json$/);
    const json = JSON.parse(await downloaded(jsonDownload));
    const parsed = parseLineupExport(json);
    assert.ok(parsed.ok, parsed.ok ? "" : parsed.message);
    const exp = parsed.value;
    assert.equal(exp.configuration.savedName, hostile);
    assert.equal(exp.dataVersion.slate, SLATE);
    assert.equal(exp.dataVersion.actualsVersion, FIXTURE_ACTUALS_VERSION);
    assert.equal(exp.dataVersion.actualsVersion, card.actualsVersion);
    assert.equal(exp.solver.method, card.method);
    assert.equal(exp.solver.optimality, card.optimality);
    assert.equal(exp.solver.requestFingerprint, card.fingerprint);
    assert.deepEqual(exp.configuration.selection.locked, [lineupQb.id]);
    assert.deepEqual(exp.configuration.selection.excluded, [topWr.id]);
    assert.deepEqual(exp.slots.map((r) => r.id).sort(), card.ids.slice().sort());
    const byId = new Map(pool.map((p) => [p.id, p]));
    const entries = exp.slots.map((r) => ({ slot: /** @type {any} */ (r.slot), player: /** @type {any} */ (byId.get(r.id)) }));
    assert.equal(validateRoster(entries, { cap: slate.cap, locked: [lineupQb.id], excluded: [topWr.id], requireStack: false }), null);
    assert.deepEqual(lineupTotals(exp.slots), exp.totals);
    assert.equal(exp.totals.salary, exp.slots.reduce((sum, r) => sum + r.salary, 0));
    for (const row of exp.slots) {
      assert.equal(row.projection, byId.get(row.id)?.proj);
      // The fixture's partial RBs play in live games (status "in"), so a still-running game wins: not-final.
      const want = !fixtureActuals.has(row.id) ? "missing" : partialRbs.includes(row.id) ? "not-final" : "complete";
      assert.equal(row.actualStatus, want, row.id);
    }

    const [csvDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV", exact: true }).click()]);
    assert.match(csvDownload.suggestedFilename(), /\.csv$/);
    const csv = await downloaded(csvDownload);
    assert.ok(csv.includes(`"'=HYPERLINK(""https://evil.example"",""open""),""quoted"""`), "the hostile name is quoted and guarded");
    const records = parseCsv(csv);
    const gap = records.findIndex((r) => r.length === 1 && r[0] === "");
    const meta = new Map(records.slice(1, gap).map((r) => [r[0], r[1] ?? ""]));
    assert.equal(meta.get("saved_view_name"), `'${hostile}`);
    assert.equal(meta.get("slate"), SLATE);
    assert.equal(meta.get("actuals_version"), FIXTURE_ACTUALS_VERSION);
    const header = records[gap + 1] ?? [];
    const rows = records.slice(gap + 2);
    assert.equal(rows.length, 9);
    /** @param {string} name */
    const sum = (name) => rows.reduce((total, r) => total + (r[header.indexOf(name)] ? Number(r[header.indexOf(name)]) : 0), 0);
    assert.equal(Number(meta.get("total_salary")), sum("salary"));
    assert.equal(Number(meta.get("total_projection")), Math.round(sum("projection") * 100) / 100);
    assert.equal(Number(meta.get("total_actual")), Math.round(sum("actual") * 100) / 100);

    // The reopen path recomputes the same setup in a fresh browser; the export stays the snapshot.
    const fresh = await session(browser, { fullWeek: true });
    await fresh.page.goto(`${BASE}${exp.reopen.path}`);
    await hydrated(fresh.page);
    const reopened = await waitForResult(fresh.page);
    assert.match(await counts(fresh.page), /^1 locked · 1 excluded/);
    assert.deepEqual(reopened.ids.slice().sort(), card.ids.slice().sort());
    assert.deepEqual([...s.errors, ...fresh.errors], []);
    await fresh.context.close();
    await s.context.close();
  });

  await scenario("pages-load", async () => {
    const s = await session(browser);
    for (const path of ["/", "/qb", "/optimizer"]) {
      await s.page.goto(`${BASE}${path}`);
      await s.page.waitForLoadState("load");
      if (path !== "/") await hydrated(s.page);
      const body = await s.page.locator("body").innerText();
      assert.ok(body.length > 200 && !body.includes("Something went wrong"), `${path} rendered`);
    }
    assert.deepEqual(s.errors, []);
    await s.context.close();
  });
}

/** @type {Preview | null} */
let preview = null;
/** @type {Browser | null} */
let browser = null;
try {
  if (OWN_SERVER) {
    preview = startPreview();
    await waitForServer(BASE, 90_000);
  }
  browser = await chromium.launch({ headless: true });
  await run(browser);
} catch (err) {
  results.push({ name: "setup", ok: false, ms: 0, error: `${String(err)}\n${preview?.log().slice(-2_000) ?? ""}` });
} finally {
  await browser?.close();
  stopPreview(preview);
}

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name} (${r.ms} ms)${r.ok ? "" : `\n     ${r.error}`}`);
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} analysis browser checks passed`);
process.exit(failed.length || results.length === 0 ? 1 : 0);
