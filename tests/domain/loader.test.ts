import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parsePlayerWeeks } from "../../src/lib/football/nflverse.ts";
import {
  createLoader,
  httpError,
  parseJsonObject,
  parseRetryAfter,
  realTimers,
  schemaError,
  toFeedError,
  toFeedResponse,
  UpstreamError,
  type LoaderOptions,
  type Timers,
} from "../../src/lib/live/loader.ts";

const FIX = "tests/fixtures/football";

/** Real timers that record every delay and how many are still pending. */
function trackedTimers() {
  const live = new Set<unknown>();
  const delays: number[] = [];
  const timers: Timers = {
    setTimeout(fn, ms) {
      delays.push(ms);
      const id = realTimers.setTimeout(() => {
        live.delete(id);
        fn();
      }, ms);
      live.add(id);
      return id;
    },
    clearTimeout(id) {
      live.delete(id);
      realTimers.clearTimeout(id);
    },
  };
  return { timers, delays, pending: () => live.size };
}

function clock(start = 0) {
  let t = start;
  return { now: () => t, set: (v: number) => (t = v) };
}

function loaderWith<T>(overrides: Partial<LoaderOptions<T>> & Pick<LoaderOptions<T>, "load">) {
  return createLoader<T>({
    name: "fixture upstream",
    ttlMs: 1_000,
    attemptTimeoutMs: 200,
    deadlineMs: 1_000,
    maxAttempts: 1,
    backoffMs: 5,
    ...overrides,
  });
}

const networkError = () => Object.assign(new TypeError("fetch failed"), {});
const never = <T>() => new Promise<T>(() => {});

describe("loader: cache and dedup", () => {
  it("shares one upstream call between concurrent callers and gives them the same success", async () => {
    let calls = 0;
    const c = clock(100);
    const loader = loaderWith({
      now: c.now,
      load: async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 10));
        return { rows: 3 };
      },
    });
    const results = await Promise.all([loader.get(), loader.get(), loader.get({ waitMs: 500 }), loader.get()]);
    assert.equal(calls, 1);
    for (const r of results) assert.deepEqual(r, { ok: true, data: { rows: 3 }, source: "live", fetchedAt: 100 });
  });

  it("gives every concurrent caller the same fallback when the refresh fails", async () => {
    const c = clock(0);
    let fail = false;
    let calls = 0;
    const loader = loaderWith({
      now: c.now,
      maxAttempts: 2,
      load: async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 5));
        if (fail) throw networkError();
        return "good";
      },
    });
    await loader.get();
    c.set(5_000);
    fail = true;
    calls = 0;
    const results = await Promise.all([loader.get(), loader.get(), loader.get()]);
    assert.equal(calls, 2, "one run, two attempts, shared");
    for (const r of results) {
      assert.equal(r.ok, false);
      assert.deepEqual(r, results[0]);
      if (!r.ok) {
        assert.equal(r.error.code, "network");
        assert.deepEqual(r.stale, { data: "good", fetchedAt: 0 }, "last good data keeps its original age");
      }
    }
    const wire = toFeedResponse(results[0]!, (d) => d, 5_000);
    assert.equal(wire.source, "cache");
    assert.equal(wire.fetchedAt, new Date(0).toISOString());
    assert.equal(wire.respondedAt, new Date(5_000).toISOString());
    assert.equal(wire.error?.code, "network");
  });

  it("answers from cache within TTL with the cache's retrieval time", async () => {
    const c = clock(1_000);
    let calls = 0;
    const loader = loaderWith({ now: c.now, load: async () => ++calls });
    await loader.get();
    c.set(1_900);
    const hit = await loader.get();
    assert.deepEqual(hit, { ok: true, data: 1, source: "cache", fetchedAt: 1_000 });
    const wire = toFeedResponse(hit, (d) => d, 1_900);
    assert.equal(wire.fetchedAt, new Date(1_000).toISOString());
    c.set(2_000);
    const refreshed = await loader.get();
    assert.equal(refreshed.ok && refreshed.source, "live");
    assert.equal(calls, 2);
  });

  it("forces a refresh only for data older than minForceAgeMs", async () => {
    const c = clock(0);
    let calls = 0;
    const loader = loaderWith({ now: c.now, ttlMs: 60_000, minForceAgeMs: 10_000, load: async () => ++calls });
    await loader.get();
    c.set(5_000);
    assert.equal((await loader.get({ force: true })).ok && calls, 1);
    c.set(11_000);
    await loader.get({ force: true });
    assert.equal(calls, 2);
  });
});

describe("loader: bounded lifetime", () => {
  it("ends a hung upstream at the attempt timeout and aborts its signal", async () => {
    let seen: AbortSignal | null = null;
    const tracked = trackedTimers();
    const loader = loaderWith({
      attemptTimeoutMs: 30,
      deadlineMs: 2_000,
      timers: tracked.timers,
      load: (signal) => {
        seen = signal;
        return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
      },
    });
    const started = performance.now();
    const r = await loader.get();
    const elapsed = performance.now() - started;
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.error.code, "timeout");
    assert.equal(!r.ok && r.error.retryable, true);
    assert.ok(elapsed < 500, `terminated in ${elapsed.toFixed(0)} ms`);
    assert.equal((seen as AbortSignal | null)?.aborted, true, "the upstream request was actually cancelled");
    assert.equal(tracked.pending(), 0, "no timer outlives the run");
  });

  it("ends at the run deadline even when the load ignores its signal", async () => {
    const tracked = trackedTimers();
    const loader = loaderWith({
      attemptTimeoutMs: 5_000,
      deadlineMs: 40,
      maxAttempts: 3,
      timers: tracked.timers,
      load: () => never(),
    });
    const started = performance.now();
    const r = await loader.get();
    const elapsed = performance.now() - started;
    assert.equal(!r.ok && r.error.code, "timeout");
    assert.match(!r.ok ? r.error.message : "", /40 ms/);
    assert.ok(elapsed < 500, `terminated in ${elapsed.toFixed(0)} ms`);
    assert.equal(loader.stats.attempts, 1, "no retry after the deadline");
    assert.equal(tracked.pending(), 0);
  });

  it("stops waiting for a slow load without cancelling it for other callers", async () => {
    let seen: AbortSignal | null = null;
    const tracked = trackedTimers();
    const loader = loaderWith({
      attemptTimeoutMs: 1_000,
      deadlineMs: 2_000,
      pendingRetryMs: 3_000,
      timers: tracked.timers,
      load: async (signal) => {
        seen = signal;
        await new Promise((r) => setTimeout(r, 60));
        return "done";
      },
    });
    const early = await loader.get({ waitMs: 10 });
    assert.equal(early.ok, false);
    assert.deepEqual(!early.ok && early.error, {
      code: "pending",
      message: "fixture upstream is still loading",
      retryable: true,
      retryAfterMs: 3_000,
    });
    const joined = await loader.get();
    assert.equal(joined.ok && joined.data, "done");
    assert.equal(loader.stats.runs, 1);
    assert.equal((seen as AbortSignal | null)?.aborted, false);
    assert.equal(tracked.pending(), 0);
  });

  it("clears every timer after success and after failure", async () => {
    const tracked = trackedTimers();
    const ok = loaderWith({ timers: tracked.timers, maxAttempts: 3, load: async () => 1 });
    await ok.get({ waitMs: 1_000 });
    assert.equal(tracked.pending(), 0);
    const bad = loaderWith({ timers: tracked.timers, maxAttempts: 3, load: async () => Promise.reject(networkError()) });
    await bad.get({ waitMs: 1_000 });
    assert.equal(tracked.pending(), 0);
  });
});

describe("loader: retries", () => {
  it("retries transient failures with doubling backoff and recovers", async () => {
    const tracked = trackedTimers();
    let calls = 0;
    const loader = loaderWith({
      maxAttempts: 3,
      backoffMs: 7,
      timers: tracked.timers,
      load: async () => {
        calls += 1;
        if (calls < 3) throw networkError();
        return "recovered";
      },
    });
    const r = await loader.get();
    assert.equal(r.ok && r.data, "recovered");
    assert.equal(calls, 3);
    const sleeps = tracked.delays.filter((d) => d === 7 || d === 14);
    assert.deepEqual(sleeps, [7, 14]);
  });

  it("does not retry schema errors", async () => {
    let calls = 0;
    const loader = loaderWith({
      maxAttempts: 3,
      load: async () => {
        calls += 1;
        parsePlayerWeeks(readFileSync(`${FIX}/live-malformed-player-week.csv`, "utf8"), "fixture player week");
        return "unreachable";
      },
    });
    const r = await loader.get();
    assert.equal(calls, 1);
    assert.equal(!r.ok && r.error.code, "schema");
    assert.equal(!r.ok && r.error.retryable, false);
    assert.match(!r.ok ? r.error.message : "", /missing required column/);
  });

  it("classifies a truncated ESPN body as malformed", () => {
    assert.throws(
      () => parseJsonObject(readFileSync(`${FIX}/live-malformed-espn.txt`, "utf8"), "ESPN"),
      (err: unknown) => err instanceof UpstreamError && err.code === "schema" && !err.retryable,
    );
    assert.throws(() => parseJsonObject("[1,2]", "ESPN"), /not an object/);
    assert.deepEqual(parseJsonObject('{"events":[]}', "ESPN"), { events: [] });
  });

  it("does not retry an upstream that aborted on its own", async () => {
    let calls = 0;
    const loader = loaderWith({
      maxAttempts: 3,
      load: async () => {
        calls += 1;
        throw new DOMException("The operation was aborted", "AbortError");
      },
    });
    const r = await loader.get();
    assert.equal(calls, 1);
    assert.equal(!r.ok && r.error.code, "aborted");
  });

  it("waits a short Retry-After inside the run", async () => {
    const tracked = trackedTimers();
    let calls = 0;
    const loader = loaderWith({
      maxAttempts: 2,
      maxRetryWaitMs: 100,
      timers: tracked.timers,
      load: async () => {
        calls += 1;
        if (calls === 1) throw new UpstreamError("rate-limited", "429", { retryAfterMs: 25 });
        return "ok";
      },
    });
    const r = await loader.get();
    assert.equal(r.ok && r.data, "ok");
    assert.ok(tracked.delays.includes(25), "slept for the Retry-After value, not the backoff");
  });

  it("honors a long Retry-After by holding further calls until it passes", async () => {
    const c = clock(0);
    let calls = 0;
    const loader = loaderWith({
      now: c.now,
      maxAttempts: 3,
      maxRetryWaitMs: 100,
      load: async () => {
        calls += 1;
        if (calls === 1) throw httpError("GitHub", 429, "30", c.now());
        return "ok";
      },
    });
    const first = await loader.get();
    assert.equal(calls, 1, "a 30 s Retry-After is not slept inside the request");
    assert.equal(!first.ok && first.error.code, "rate-limited");
    assert.equal(!first.ok && first.error.retryAfterMs, 30_000);
    c.set(10_000);
    const held = await loader.get({ force: true });
    assert.equal(calls, 1, "even a forced retry respects the rate limit");
    assert.equal(!held.ok && held.error.retryAfterMs, 20_000);
    c.set(30_001);
    const after = await loader.get();
    assert.equal(after.ok && after.data, "ok");
    assert.equal(calls, 2);
  });

  it("holds a generic failure for the cooldown, but a forced retry goes through", async () => {
    const c = clock(0);
    let calls = 0;
    const loader = loaderWith({
      now: c.now,
      failureCooldownMs: 5_000,
      load: async () => {
        calls += 1;
        throw networkError();
      },
    });
    await loader.get();
    c.set(1_000);
    await loader.get();
    assert.equal(calls, 1);
    await loader.get({ force: true });
    assert.equal(calls, 2);
  });
});

describe("error classification", () => {
  it("parses Retry-After seconds and dates", () => {
    const now = Date.parse("2026-09-19T12:00:00Z");
    assert.equal(parseRetryAfter("120", now), 120_000);
    assert.equal(parseRetryAfter("Sat, 19 Sep 2026 12:00:30 GMT", now), 30_000);
    assert.equal(parseRetryAfter("soon", now), null);
    assert.equal(parseRetryAfter(null, now), null);
  });

  it("retries 5xx and 408 but not other 4xx", () => {
    assert.equal(httpError("ESPN", 503, "2", 0).retryable, true);
    assert.equal(httpError("ESPN", 503, "2", 0).retryAfterMs, 2_000);
    assert.equal(httpError("ESPN", 408, null, 0).retryable, true);
    assert.equal(httpError("nflverse", 404, null, 0).retryable, false);
    assert.equal(httpError("nflverse", 404, null, 0).code, "http");
  });

  it("maps thrown values to feed errors", () => {
    assert.equal(toFeedError(new TypeError("fetch failed")).code, "network");
    assert.equal(toFeedError(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })).code, "network");
    assert.equal(toFeedError(new DOMException("timed out", "TimeoutError")).code, "timeout");
    assert.equal(toFeedError(new SyntaxError("Unexpected end of JSON input")).code, "schema");
    assert.equal(toFeedError(schemaError("bad")).retryable, false);
    assert.equal(toFeedError(new TypeError("x is not a function")).code, "unknown");
    assert.equal(toFeedError(new TypeError("x is not a function")).retryable, false);
    const wrapped = new DOMException("aborted", "AbortError");
    Object.defineProperty(wrapped, "cause", { value: new UpstreamError("timeout", "too slow") });
    assert.equal(toFeedError(wrapped).code, "timeout");
  });
});
