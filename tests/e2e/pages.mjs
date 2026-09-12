#!/usr/bin/env node
// Page smoke over every lab route at desktop and phone width, against a preview that runs with
// GRIDIRON_LIVE_FIXTURE=cookie (tests/e2e/run.mjs starts one):
//
//   node tests/e2e/pages.mjs --base http://127.0.0.1:8081
//
// Each page must answer 200, render without page errors or console errors, settle every data
// status (none left loading or unavailable on the "fresh" fixture) and not scroll sideways at
// 390 px. Requests to any other host are aborted and listed: fonts and team logos degrade, and
// the page must still pass without them.

import { chromium } from "playwright";
import { parseArgs } from "./optimizer-support.mjs";

/** @typedef {import("playwright").Browser} Browser */
/** @typedef {import("playwright").Page} Page */
/** @typedef {{ name: string; width: number; height: number; mobile: boolean }} Viewport */

const args = parseArgs(process.argv.slice(2));
const BASE = args.base ?? process.env.GRIDIRON_E2E_URL;
if (!BASE) {
  console.error("pages.mjs needs --base <url> or GRIDIRON_E2E_URL (tests/e2e/run.mjs passes one)");
  process.exit(1);
}
const ORIGIN = new URL(BASE).origin;
const WAIT = 30_000;
const PATHS = ["/", "/study", "/qb", "/optimizer", "/play-calling", "/live", "/players", "/guide"];
/** @type {Viewport[]} */
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900, mobile: false },
  { name: "mobile", width: 390, height: 844, mobile: true },
];

/** @type {{ name: string; ok: boolean; ms: number; error?: string }[]} */
const results = [];
/** @type {Set<string>} */
const externalHosts = new Set();

/**
 * @param {unknown} cond
 * @param {string} message
 */
function expect(cond, message) {
  if (!cond) throw new Error(message);
}

/**
 * Elements that stick out past the right edge, outside any horizontal scroll container.
 * @param {Page} page
 */
function overflowCulprits(page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    /** @param {Element} el */
    const clipped = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const x = getComputedStyle(p).overflowX;
        if (x === "auto" || x === "scroll" || x === "hidden" || x === "clip") return true;
      }
      return false;
    };
    return [...document.body.querySelectorAll("*")]
      .filter((el) => el.getBoundingClientRect().right > width + 1 && !clipped(el))
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}.${String(el.getAttribute("class") ?? "").split(/\s+/).slice(0, 4).join(".")} right=${Math.round(el.getBoundingClientRect().right)}`);
  });
}

/**
 * @param {Browser} browser
 * @param {Viewport} vp
 * @param {string} path
 */
async function checkPage(browser, vp, path) {
  const name = `${vp.name} ${path}`;
  const started = Date.now();
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
  });
  await context.addCookies([{ name: "gl_live_fixture", value: "fresh", domain: new URL(BASE).hostname, path: "/" }]);
  /** @type {Set<string>} */
  const aborted = new Set();
  await context.route(
    (url) => url.origin !== ORIGIN,
    (route) => {
      const url = route.request().url();
      aborted.add(url);
      externalHosts.add(new URL(url).host);
      return route.abort();
    },
  );
  const page = await context.newPage();
  /** @type {string[]} */
  const problems = [];
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    // The aborted font and logo requests log "Failed to load resource"; those are expected here.
    if (aborted.has(msg.location().url) && /Failed to load resource/.test(msg.text())) return;
    problems.push(`console error: ${msg.text()} (${msg.location().url || "no location"})`);
  });
  page.on("response", (res) => {
    if (new URL(res.url()).origin === ORIGIN && res.status() >= 400 && !res.url().includes("favicon")) {
      problems.push(`HTTP ${res.status()} ${new URL(res.url()).pathname}`);
    }
  });
  try {
    const res = await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: WAIT });
    expect(res?.status() === 200, `HTTP ${res?.status()} for ${path}`);
    await page.locator("h1").first().waitFor({ timeout: WAIT });
    await page.waitForFunction(() => !document.querySelector('[data-feed-status][data-state="loading"]'), null, { timeout: WAIT });
    // Let hydration and the first client fetches finish, so their errors land before the checks.
    await page.waitForLoadState("networkidle", { timeout: WAIT }).catch(() => {});
    await page.waitForTimeout(300);
    const body = await page.locator("body").innerText();
    expect(!body.includes("Something went wrong"), `${path} rendered the error screen`);
    const down = await page.locator('[data-feed-status][data-state="unavailable"]').evaluateAll((els) => els.map((el) => el.getAttribute("data-feed-status")));
    expect(down.length === 0, `data unavailable on the fresh fixture: ${down.join(", ")}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) problems.push(`horizontal overflow of ${overflow}px: ${(await overflowCulprits(page)).join(" | ")}`);
    expect(problems.length === 0, problems.join("\n     "));
    results.push({ name, ok: true, ms: Date.now() - started });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const extra = problems.length && !message.includes(problems[0] ?? "") ? `\n     ${problems.join("\n     ")}` : "";
    results.push({ name, ok: false, ms: Date.now() - started, error: `${message}${extra}` });
  } finally {
    await context.close();
  }
}

/** @type {Browser | null} */
let browser = null;
try {
  browser = await chromium.launch({ headless: true });
  for (const vp of VIEWPORTS) for (const path of PATHS) await checkPage(browser, vp, path);
} catch (err) {
  results.push({ name: "setup", ok: false, ms: 0, error: String(err) });
} finally {
  await browser?.close();
}

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name} (${r.ms} ms)${r.ok ? "" : `\n     ${r.error}`}`);
console.log(`aborted requests to other hosts: ${[...externalHosts].sort().join(", ") || "none"}`);
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} page checks passed`);
process.exit(failed.length || results.length === 0 ? 1 : 0);
