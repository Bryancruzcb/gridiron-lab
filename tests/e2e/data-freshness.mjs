#!/usr/bin/env node
// Browser checks for live-data provenance against a production build, driven by the server-side
// fixture switch (src/lib/live/fixtures.server.ts), so nothing here depends on ESPN or nflverse.
//
//   npm run build
//   node tests/e2e/data-freshness.mjs
//
// Starts `npm run preview` with GRIDIRON_LIVE_FIXTURE=cookie (127.0.0.1:8081) and switches scenarios
// per browser context through the gl_live_fixture cookie. Set GRIDIRON_E2E_URL to reuse a preview
// server that already runs with GRIDIRON_LIVE_FIXTURE=cookie. Set GRIDIRON_E2E_SKIP_POLL=1 to skip
// the ~35 s polling check.

import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

/** @typedef {import("playwright").Browser} Browser */
/** @typedef {import("playwright").BrowserContext} BrowserContext */
/** @typedef {import("playwright").Locator} Locator */
/** @typedef {import("playwright").Page} Page */
/** @typedef {{ child: import("node:child_process").ChildProcess; log: () => string }} Preview */

const OWN_SERVER = !process.env.GRIDIRON_E2E_URL;
const BASE = process.env.GRIDIRON_E2E_URL ?? "http://127.0.0.1:8081";
const SNAPSHOT_AT = JSON.parse(readFileSync("src/data/season2026.json", "utf8")).fetchedAt;
const WAIT = 15_000;

/** @type {{ name: string; ok: boolean; ms?: number; error?: string; serverLog?: string }[]} */
const results = [];
/** @type {Preview | null} */
let preview = null;

/** @param {unknown} err */
function errText(err) {
  return err instanceof Error ? err.message : String(err);
}

/** @returns {Preview} */
function startPreview() {
  const win = process.platform === "win32";
  /** @type {import("node:child_process").SpawnOptions} */
  const options = { env: { ...process.env, GRIDIRON_LIVE_FIXTURE: "cookie" }, stdio: ["ignore", "pipe", "pipe"] };
  // npm is a .cmd shim on Windows, which only a shell can start; elsewhere a process group lets stop kill vite too.
  const child = win
    ? spawn("npm run preview", { ...options, shell: true })
    : spawn("npm", ["run", "preview"], { ...options, detached: true });
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

/**
 * @param {string} url
 * @param {number} ms
 */
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

/** @param {string} name */
const status = (name) => `[data-feed-status="${name}"]`;

/**
 * @param {BrowserContext} ctx
 * @param {string} spec
 */
async function setSpec(ctx, spec) {
  const { hostname } = new URL(BASE);
  await ctx.addCookies([{ name: "gl_live_fixture", value: encodeURIComponent(spec), domain: hostname, path: "/" }]);
}

/**
 * @param {Page} page
 * @param {string} selector
 */
async function textOf(page, selector) {
  return (await page.locator(selector).first().innerText()).replace(/\s+/g, " ").trim();
}

/**
 * @param {unknown} cond
 * @param {string} message
 */
function expect(cond, message) {
  if (!cond) throw new Error(message);
}

/**
 * @param {string} name
 * @param {Browser} browser
 * @param {string} spec
 * @param {(page: Page, ctx: BrowserContext) => Promise<void>} fn
 */
async function check(name, browser, spec, fn) {
  const started = Date.now();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await setSpec(ctx, spec);
  const page = await ctx.newPage();
  /** @type {string[]} */
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await fn(page, ctx);
    expect(errors.length === 0, `page errors: ${errors.join(" | ")}`);
    results.push({ name, ok: true, ms: Date.now() - started });
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - started, error: errText(err) });
  } finally {
    await ctx.close();
  }
}

/** @param {Browser} browser */
async function run(browser) {
  await check("fresh: every feed live with source and coverage", browser, "fresh", async (page) => {
    await page.goto(`${BASE}/qb`);
    await page.waitForSelector(`${status("labs-qbs")}[data-source="live"][data-freshness="fresh"]`, { timeout: WAIT });
    const qb = await textOf(page, status("labs-qbs"));
    expect(/Live/i.test(qb) && /through week 2/i.test(qb) && /as of/i.test(qb), `labs status text: ${qb}`);
    expect((await page.locator("h2", { hasText: "By week" }).count()) === 1, "observed weekly rows render");

    await page.goto(`${BASE}/`);
    await page.waitForSelector(`${status("scoreboard")}[data-source="live"]`, { timeout: WAIT });
    expect((await page.getByText("Lions").count()) > 0, "scoreboard games render");
    await page.waitForSelector(`${status("labs-qbs")}[data-source="live"]`, { timeout: WAIT });

    await page.goto(`${BASE}/players`);
    await page.waitForSelector(`${status("weekPpr")}[data-source="live"]`, { timeout: WAIT });
    const mix = await textOf(page, '[data-testid="week-source-mix"]');
    expect(/5 provisional ESPN lines · 1 published by nflverse · 1 partly scored/.test(mix), `source mix: ${mix}`);

    await page.goto(`${BASE}/play-calling`);
    await page.waitForSelector(`${status("labs-teams")}[data-source="live"]`, { timeout: WAIT });
  });

  await check("cached: fresh cache is labelled cached, not stale", browser, "cached", async (page) => {
    await page.goto(`${BASE}/`);
    await page.waitForSelector(`${status("scoreboard")}[data-source="cache"][data-freshness="fresh"]`, { timeout: WAIT });
    const t = await textOf(page, status("scoreboard"));
    expect(/Cached/i.test(t) && !/Stale/i.test(t), `scoreboard status: ${t}`);
  });

  await check("stale: rows stay, marked stale, with retry", browser, "stale", async (page) => {
    await page.goto(`${BASE}/qb`);
    const sel = `${status("labs-qbs")}[data-source="cache"][data-freshness="stale"]`;
    await page.waitForSelector(sel, { timeout: WAIT });
    const t = await textOf(page, sel);
    expect(/Stale/i.test(t) && /Refresh failed/i.test(t), `status: ${t}`);
    expect((await page.locator(`${sel} button`, { hasText: "Retry" }).count()) === 1, "retry offered");
    expect((await page.getByText("Drake Maye").count()) > 0, "previous rows still visible");
  });

  await check("snapshot: old snapshot keeps its own timestamp after failures", browser, "labs:snapshot-only", async (page) => {
    await page.goto(`${BASE}/qb`);
    const sel = `${status("labs-qbs")}[data-source="snapshot"]`;
    await page.waitForSelector(`${sel} >> text=/Live refresh failed/i`, { timeout: WAIT });
    const asOf = await page.locator(`${sel} [title]`).first().getAttribute("title");
    expect(asOf === SNAPSHOT_AT, `snapshot as-of ${asOf} should stay ${SNAPSHOT_AT}`);
    expect((await page.locator('[data-testid="week-strip-note"]').count()) === 1, "no synthesized week strip");
    expect((await page.locator("h2", { hasText: "By week" }).count()) === 0, "season totals are not shown as a week");
    await page.locator(`${sel} button`, { hasText: "Retry" }).click();
    await page.waitForSelector(`${sel} button:has-text("Retry"):not([disabled])`, { timeout: WAIT });
    const after = await page.locator(`${sel} [title]`).first().getAttribute("title");
    expect(after === SNAPSHOT_AT, `after a failed retry the snapshot time is still ${SNAPSHOT_AT}, got ${after}`);
  });

  await check("unavailable: clear state, retry recovers the feed", browser, "scoreboard:unavailable", async (page, ctx) => {
    await page.goto(`${BASE}/`);
    const down = `${status("scoreboard")}[data-state="unavailable"]`;
    await page.waitForSelector(down, { timeout: WAIT });
    expect(/Live scores unavailable/.test(await textOf(page, down)), "unavailable copy");
    await setSpec(ctx, "scoreboard:fresh");
    await page.locator(`${down} button`, { hasText: "Retry" }).click();
    await page.waitForSelector(`${status("scoreboard")}[data-source="live"]`, { timeout: WAIT });
    expect((await page.getByText("Lions").count()) > 0, "games appear after retry");
  });

  await check("retry keeps pins, filters and sort", browser, "labs:stale", async (page, ctx) => {
    await page.goto(`${BASE}/qb`);
    const sel = `${status("labs-qbs")}[data-freshness="stale"]`;
    await page.waitForSelector(sel, { timeout: WAIT });
    const pinned = () => page.locator('[data-testid="pinned-list"] p.font-medium').allInnerTexts();
    await page.locator("tr", { hasText: "Matthew Stafford" }).click();
    const before = await pinned();
    expect(before.length === 2 && !before.includes("Matthew Stafford"), `pins after unpinning: ${before}`);
    // The Board header's sort buttons; column headers have a CPOE tooltip button too.
    const sortCpoe = page
      .locator("h2", { hasText: "Board" })
      .locator("xpath=..")
      .getByRole("button", { name: "CPOE", exact: true });
    const down1st = page.getByRole("button", { name: "1st", exact: true });
    await sortCpoe.click();
    await down1st.click();
    await setSpec(ctx, "labs:fresh");
    await page.locator(`${sel} button`, { hasText: "Retry" }).click();
    await page.waitForSelector(`${status("labs-qbs")}[data-source="live"][data-freshness="fresh"]`, { timeout: WAIT });
    /** @param {Locator} locator */
    const active = async (locator) => ((await locator.getAttribute("class")) ?? "").includes("bg-accent");
    expect(await active(down1st), "down filter survived the refresh");
    expect(await active(sortCpoe), "sort survived the refresh");
    await page.getByRole("button", { name: "All", exact: true }).first().click();
    const after = await pinned();
    expect(JSON.stringify(after) === JSON.stringify(before), `pins changed after refresh: ${before} -> ${after}`);
  });

  await check(
    "one feed failing while the others work",
    browser,
    "scoreboard:fresh|labs:unavailable|weekPpr:fresh",
    async (page) => {
      await page.goto(`${BASE}/`);
      await page.waitForSelector(`${status("scoreboard")}[data-source="live"]`, { timeout: WAIT });
      const labs = `${status("labs-qbs")}[data-source="snapshot"]`;
      await page.waitForSelector(`${labs} >> text=/Live refresh failed/i`, { timeout: WAIT });
      expect((await page.getByText("Drake Maye").count()) > 0, "snapshot leaders still render");
      await page.goto(`${BASE}/players`);
      await page.waitForSelector(`${status("weekPpr")}[data-source="live"]`, { timeout: WAIT });
    },
  );

  await check(
    "partial: mixed provenance per section and incomplete parts named",
    browser,
    "labs:partial|weekPpr:partial",
    async (page) => {
      await page.goto(`${BASE}/`);
      await page.waitForSelector(`${status("labs-qbs")}[data-source="live"]`, { timeout: WAIT });
      await page.waitForSelector(`${status("labs-teams")}[data-source="snapshot"]`, { timeout: WAIT });
      const qbs = await textOf(page, status("labs-qbs"));
      expect(/Incomplete: team play-calling rows/.test(qbs), `partial note on the live section: ${qbs}`);
      await page.goto(`${BASE}/players`);
      await page.waitForSelector(`${status("weekPpr")}[data-source="live"]`, { timeout: WAIT });
      const week = await textOf(page, status("weekPpr"));
      expect(/Incomplete: box score for BUF@MIA/.test(week), `weekly partial note: ${week}`);
    },
  );

  await check(
    "empty and malformed are told apart from each other",
    browser,
    "scoreboard:empty|weekPpr:malformed",
    async (page) => {
      await page.goto(`${BASE}/`);
      const empty = `${status("scoreboard")}[data-state="empty"]`;
      await page.waitForSelector(empty, { timeout: WAIT });
      expect(/No games on this week's board yet/.test(await textOf(page, empty)), "empty copy");
      await page.goto(`${BASE}/players`);
      const bad = `${status("weekPpr")}[data-state="unavailable"]`;
      await page.waitForSelector(bad, { timeout: WAIT });
      expect(/shape the parser does not accept/.test(await textOf(page, bad)), "malformed copy");
    },
  );

  await check(
    "recovered: first request fails, retry succeeds",
    browser,
    `scoreboard:recovered|nonce:${Date.now()}`,
    async (page) => {
      await page.goto(`${BASE}/`);
      const down = `${status("scoreboard")}[data-state="unavailable"]`;
      await page.waitForSelector(down, { timeout: WAIT });
      await page.locator(`${down} button`, { hasText: "Retry" }).click();
      await page.waitForSelector(`${status("scoreboard")}[data-source="live"]`, { timeout: WAIT });
    },
  );

  if (process.env.GRIDIRON_E2E_SKIP_POLL) return;
  await check(
    "polling: live route and provider share one loop and stop on leave",
    browser,
    `fresh|nonce:${Date.now()}`,
    async (page) => {
      /** @type {{ feed: "scoreboard" | "detail"; at: number }[]} */
      const hits = [];
      page.on("response", async (res) => {
        const type = res.request().resourceType();
        if (type !== "fetch" && type !== "xhr") return;
        const body = await res.text().catch(() => "");
        if (body.includes("anyLive")) hits.push({ feed: "scoreboard", at: Date.now() });
        else if (body.includes("teamBox")) hits.push({ feed: "detail", at: Date.now() });
      });
      await page.goto(`${BASE}/live`);
      await page.waitForSelector(`${status("scoreboard")}[data-source="live"]`, { timeout: WAIT });
      await page.waitForSelector(`${status("detail")}[data-state="ready"]`, { timeout: WAIT });
      const start = Date.now();
      await page.waitForTimeout(17_000);
      /**
       * @param {"scoreboard" | "detail"} feed
       * @param {number} from
       */
      const count = (feed, from) => hits.filter((h) => h.feed === feed && h.at >= from).length;
      const boardOnLive = count("scoreboard", 0);
      expect(boardOnLive === 2, `scoreboard requests on /live over ~17 s: ${boardOnLive} (expected initial + one 15 s poll)`);
      expect(count("detail", start) === 1, `detail polls in 17 s: ${count("detail", start)}`);
      await page.locator('a[href="/"]').first().click();
      await page.waitForURL(`${BASE}/`);
      const left = Date.now();
      await page.waitForTimeout(17_000);
      expect(count("scoreboard", left) === 0, `scoreboard polled after leaving /live: ${count("scoreboard", left)}`);
      expect(count("detail", left) === 0, `detail polled after leaving /live: ${count("detail", left)}`);
    },
  );
}

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
  results.push({ name: "setup", ok: false, error: errText(err), serverLog: preview?.log().slice(-2_000) });
} finally {
  await browser?.close();
  stopPreview(preview);
}

for (const r of results) {
  const ms = r.ms != null ? ` (${r.ms} ms)` : "";
  console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${ms}${r.ok ? "" : `\n     ${r.error}`}`);
}
const failed = results.filter((r) => !r.ok);
const withLog = failed.find((r) => r.serverLog);
if (withLog) console.log(withLog.serverLog);
console.log(`${results.length - failed.length}/${results.length} browser checks passed`);
process.exit(failed.length || results.length === 0 ? 1 : 0);
