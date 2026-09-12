// Shared helpers for the optimizer browser scripts. Plain node + the installed playwright library.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** @param {string[]} argv */
export function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a || !a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = "true";
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

/** @returns {{ cap: number, season: number, players: any[] }} */
export function readSlate() {
  return JSON.parse(readFileSync(new URL("../../src/data/fantasy.json", import.meta.url), "utf8"));
}

/** @param {string} s */
function hashId(s) {
  let h = 7;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 100003;
  return h;
}

/**
 * Deterministic WeekPpr response built from the slate: every player not in `missing` gets a
 * made-up actual; ids in `partial` come from a live game with a partial score.
 * @param {any[]} players
 * @param {{ missing?: string[], partial?: string[] }} [opts]
 */
export function weekFixture(players, opts = {}) {
  const missing = new Set(opts.missing ?? []);
  const partial = new Set(opts.partial ?? []);
  const rows = players
    .filter((p) => !missing.has(p.id))
    .map((p) => {
      const live = partial.has(p.id);
      return {
        gsisId: p.pos === "DST" ? null : p.id,
        espnId: `e2e-${p.id}`,
        name: p.name,
        team: p.team,
        pos: p.pos,
        ppr: Math.round(p.proj * (0.4 + (hashId(p.id) % 120) / 100) * 10) / 10,
        headshot: null,
        status: live ? "in" : "post",
        source: "espn",
        score: live ? { status: "partial", unavailable: ["fumblesLost"] } : { status: "complete", unavailable: [] },
      };
    })
    .sort((a, b) => b.ppr - a.ppr);
  return {
    season: 2026,
    seasonType: "REG",
    week: 1,
    fetchedAt: "2026-09-11T12:00:00.000Z",
    gamesFinal: 14,
    gamesLive: 2,
    games: 16,
    players: rows,
  };
}

/** Production builds name server functions sha256("<file>--<export>_createServerFn_handler"). */
const WEEK_FN_BUILD_ID = createHash("sha256").update("src/lib/live/functions.ts--getWeekPpr_createServerFn_handler").digest("hex");

/**
 * Server function ids are base64url JSON in dev; returns the export name when it decodes.
 * @param {string} url
 */
function serverFnName(url) {
  const seg = new URL(url).pathname.split("/").pop() ?? "";
  try {
    const decoded = JSON.parse(Buffer.from(seg, "base64url").toString("utf8"));
    return typeof decoded?.export === "string" ? decoded.export : seg;
  } catch {
    return seg;
  }
}

/**
 * Keeps the page off ESPN/nflverse and third-party hosts. getWeekPpr gets `week` (optionally held
 * until release()), every other server function answers 503, which the season provider treats as
 * "no data".
 * @param {import("playwright").BrowserContext} context
 * @param {string} base
 * @param {{ week?: unknown, hold?: boolean }} [opts]
 */
export async function isolateNetwork(context, base, opts = {}) {
  const origin = new URL(base).origin;
  /** @type {(() => void) | null} */
  let release = null;
  const held = opts.hold ? new Promise((resolve) => (release = () => resolve(undefined))) : null;
  const calls = { week: 0, other: 0 };
  await context.route(
    (url) => url.origin !== origin,
    (route) => route.abort(),
  );
  await context.route("**/_serverFn/**", async (route) => {
    const name = serverFnName(route.request().url());
    if (opts.week && (name.includes("getWeekPpr") || name === WEEK_FN_BUILD_ID)) {
      calls.week++;
      if (held) await held;
      // Plain JSON (no x-tss-serialized header) is returned as-is and the client unwraps `.result`.
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ result: opts.week, context: {} }) });
      return;
    }
    calls.other++;
    await route.fulfill({ status: 503, contentType: "text/plain", body: "live feeds disabled for this browser check" });
  });
  return { release: () => release?.(), calls };
}

/**
 * Init script: wraps window.Worker to count constructions/terminations and record posted request
 * ids. `__e2eWorker.spinMs` makes each new worker busy-wait before it replies (a blob module that
 * imports the real worker entry and wraps its postMessage), standing in for a long solve.
 * `__e2eWorker.failConstruct` makes construction throw.
 */
export function instrumentWorkers() {
  const w = /** @type {any} */ (window);
  const Real = w.Worker;
  if (!Real || w.__workerStats) return;
  /** @type {{ constructed: number, terminated: number, failedConstruct: number, urls: string[], posted: any[], received: any[] }} */
  const stats = { constructed: 0, terminated: 0, failedConstruct: 0, urls: [], posted: [], received: [] };
  w.__workerStats = stats;
  w.__e2eWorker = { spinMs: 0, failConstruct: false };
  let seq = 0;
  class InstrumentedWorker extends Real {
    /** @param {string | URL} url @param {any} options */
    constructor(url, options) {
      if (w.__e2eWorker.failConstruct) {
        stats.failedConstruct++;
        throw new Error("Worker construction blocked by the browser check");
      }
      const href = new URL(String(url), location.href).href;
      const spin = Number(w.__e2eWorker.spinMs) || 0;
      let target = url;
      if (spin > 0) {
        const src =
          `import ${JSON.stringify(href)};\n` +
          "const reply = self.postMessage.bind(self);\n" +
          `self.postMessage = (m, t) => { const end = performance.now() + ${spin}; while (performance.now() < end) {} reply(m, t); };\n`;
        target = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      }
      super(target, options);
      const id = ++seq;
      this.__id = id;
      this.__terminated = false;
      stats.constructed++;
      stats.urls.push(href);
      this.addEventListener("message", (/** @type {MessageEvent} */ e) => {
        stats.received.push({ worker: id, type: e.data?.type, requestId: e.data?.requestId, at: performance.now() });
      });
    }
    /** @param {any} message @param {any} [transfer] */
    postMessage(message, transfer) {
      stats.posted.push({ worker: this.__id, requestId: message?.requestId, kind: message?.job?.kind, at: performance.now() });
      return transfer === undefined ? super.postMessage(message) : super.postMessage(message, transfer);
    }
    terminate() {
      if (!this.__terminated) {
        this.__terminated = true;
        stats.terminated++;
      }
      return super.terminate();
    }
  }
  w.Worker = InstrumentedWorker;
}

/**
 * @param {import("playwright").Page} page
 * @returns {Promise<any>}
 */
export async function workerStats(page) {
  return page.evaluate(() => {
    const s = /** @type {any} */ (window).__workerStats;
    return s ? { ...s, live: s.constructed - s.terminated } : null;
  });
}

/** @param {number} x */
export function round(x) {
  return Math.round(x * 10) / 10;
}

/** @param {number[]} xs */
export function summarize(xs) {
  if (!xs.length) return { n: 0, median: null, p95: null, max: null };
  const s = xs.slice().sort((a, b) => a - b);
  /** @param {number} q */
  const at = (q) => s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))] ?? 0;
  return { n: s.length, median: round(at(0.5)), p95: round(at(0.95)), max: round(s[s.length - 1] ?? 0) };
}
