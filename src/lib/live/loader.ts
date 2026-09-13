// Cached, deduplicated upstream loading. The loader owns cancellation: each run has its own
// AbortController, per-attempt timeout and overall deadline, so a caller that stops waiting never
// aborts work another caller needs, and a hung upstream always ends within `deadlineMs`.
// Pure apart from the injected load function, clock and timers; tests need no network.

import type { FeedError, FeedErrorCode, FeedResponse } from "./types.ts";

export class UpstreamError extends Error {
  readonly code: FeedErrorCode;
  readonly retryable: boolean;
  readonly status: number | null;
  readonly retryAfterMs: number | null;
  constructor(
    code: FeedErrorCode,
    message: string,
    opts: { retryable?: boolean; status?: number | null; retryAfterMs?: number | null } = {},
  ) {
    super(message);
    this.name = "UpstreamError";
    this.code = code;
    this.retryable = opts.retryable ?? RETRYABLE[code];
    this.status = opts.status ?? null;
    this.retryAfterMs = opts.retryAfterMs ?? null;
  }
}

const RETRYABLE: Record<FeedErrorCode, boolean> = {
  network: true,
  timeout: true,
  pending: true,
  "rate-limited": true,
  http: false,
  schema: false,
  "not-found": false,
  aborted: false,
  unknown: false,
};

/** Retry-After as delta-seconds or an HTTP date. */
export function parseRetryAfter(header: string | null | undefined, nowMs: number): number | null {
  if (header == null) return null;
  const v = header.trim();
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : Math.max(0, at - nowMs);
}

export function httpError(source: string, status: number, retryAfter: string | null, nowMs: number): UpstreamError {
  if (status === 429) {
    return new UpstreamError("rate-limited", `${source} is rate limiting requests (429)`, {
      status,
      retryAfterMs: parseRetryAfter(retryAfter, nowMs),
    });
  }
  const retryable = status === 408 || status >= 500;
  return new UpstreamError("http", `${source} answered ${status}`, {
    status,
    retryable,
    retryAfterMs: retryable ? parseRetryAfter(retryAfter, nowMs) : null,
  });
}

export function schemaError(message: string): UpstreamError {
  return new UpstreamError("schema", message);
}

/** A JSON object body, or a schema error. Network failures while reading stay network failures. */
export function parseJsonObject(text: string, source: string): Record<string, unknown> {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw schemaError(`${source} returned something that is not JSON`);
  }
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    throw schemaError(`${source} returned JSON that is not an object`);
  }
  return body as Record<string, unknown>;
}

const SCHEMA_ERRORS = new Set(["SyntaxError", "CsvColumnError", "CsvFormatError", "CsvValueError", "ZodError"]);
const NETWORK_CODES = /^(ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|UND_ERR|Z_)|^ERR_STREAM_PREMATURE_CLOSE$/;

export function toFeedError(err: unknown): FeedError {
  if (err instanceof UpstreamError) {
    return { code: err.code, message: err.message, retryable: err.retryable, retryAfterMs: err.retryAfterMs };
  }
  const e = (err ?? {}) as { name?: unknown; message?: unknown; code?: unknown; cause?: unknown };
  if (e.cause instanceof UpstreamError) return toFeedError(e.cause);
  const name = typeof e.name === "string" ? e.name : "";
  const message = typeof e.message === "string" && e.message ? e.message : String(err);
  const make = (code: FeedErrorCode): FeedError => ({ code, message, retryable: RETRYABLE[code], retryAfterMs: null });
  if (name === "TimeoutError") return make("timeout");
  if (name === "AbortError") return make("aborted");
  if (SCHEMA_ERRORS.has(name)) return make("schema");
  if (typeof e.code === "string" && NETWORK_CODES.test(e.code)) return make("network");
  if (name === "TypeError" && /fetch failed|terminated|network/i.test(message)) return make("network");
  return make("unknown");
}

export type Timers = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
};

export const realTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
};

export type Retrieval<T> = { data: T; fetchedAt: number };

export type LoadResult<T> =
  | { ok: true; data: T; source: "live" | "cache"; fetchedAt: number }
  | { ok: false; error: FeedError; stale: Retrieval<T> | null };

export type LoaderOptions<T> = {
  name: string;
  ttlMs: number;
  load: (signal: AbortSignal) => Promise<T>;
  attemptTimeoutMs: number;
  /** Hard bound for a run: every attempt, backoff and Retry-After wait included. */
  deadlineMs: number;
  maxAttempts?: number;
  /** First backoff; doubles per retry. */
  backoffMs?: number;
  /** Longest backoff or Retry-After honored inside a run; longer waits end the run. */
  maxRetryWaitMs?: number;
  /** After a failed run, answer from the failure for this long instead of hitting upstream again. */
  failureCooldownMs?: number;
  /** A forced refresh re-downloads only data older than this. */
  minForceAgeMs?: number;
  /** Retry hint sent with a "pending" answer. */
  pendingRetryMs?: number;
  now?: () => number;
  timers?: Timers;
};

export type Loader<T> = {
  /** Never rejects. `waitMs` bounds how long this caller waits; the run itself keeps going. */
  get(opts?: { force?: boolean; waitMs?: number }): Promise<LoadResult<T>>;
  peek(): Retrieval<T> | null;
  readonly stats: { runs: number; attempts: number };
};

export function createLoader<T>(opts: LoaderOptions<T>): Loader<T> {
  const now = opts.now ?? Date.now;
  const timers = opts.timers ?? realTimers;
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  const backoffMs = opts.backoffMs ?? 500;
  const maxRetryWaitMs = opts.maxRetryWaitMs ?? 5_000;
  const failureCooldownMs = opts.failureCooldownMs ?? 0;
  const minForceAgeMs = opts.minForceAgeMs ?? 0;
  const pendingRetryMs = opts.pendingRetryMs ?? 4_000;

  let cache: Retrieval<T> | null = null;
  let inflight: Promise<LoadResult<T>> | null = null;
  let cooldown: { until: number; error: FeedError } | null = null;
  const stats = { runs: 0, attempts: 0 };

  const sleep = (ms: number, signal: AbortSignal) =>
    new Promise<boolean>((resolve) => {
      if (signal.aborted) return resolve(false);
      const onAbort = () => {
        timers.clearTimeout(id);
        resolve(false);
      };
      const id = timers.setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve(true);
      }, ms);
      signal.addEventListener("abort", onAbort, { once: true });
    });

  // Settles when the work does or the signal aborts, whichever is first, so a load that ignores
  // its signal still cannot hold the run past its bound.
  const settleOrAbort = (signal: AbortSignal) =>
    new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      Promise.resolve()
        .then(() => opts.load(signal))
        .then(
          (v) => {
            signal.removeEventListener("abort", onAbort);
            resolve(v);
          },
          (e) => {
            signal.removeEventListener("abort", onAbort);
            reject(e);
          },
        );
    });

  async function run(): Promise<LoadResult<T>> {
    stats.runs += 1;
    const started = now();
    const controller = new AbortController();
    const deadline = timers.setTimeout(
      () => controller.abort(new UpstreamError("timeout", `${opts.name} did not finish within ${opts.deadlineMs} ms`)),
      opts.deadlineMs,
    );
    let error: FeedError = { code: "unknown", message: `${opts.name} failed`, retryable: false, retryAfterMs: null };
    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        stats.attempts += 1;
        const attemptController = new AbortController();
        const forward = () => attemptController.abort(controller.signal.reason);
        controller.signal.addEventListener("abort", forward, { once: true });
        if (controller.signal.aborted) forward();
        const timer = timers.setTimeout(
          () =>
            attemptController.abort(
              new UpstreamError("timeout", `${opts.name} did not answer within ${opts.attemptTimeoutMs} ms`),
            ),
          opts.attemptTimeoutMs,
        );
        try {
          const data = await settleOrAbort(attemptController.signal);
          cache = { data, fetchedAt: now() };
          cooldown = null;
          return { ok: true, data, source: "live", fetchedAt: cache.fetchedAt };
        } catch (err) {
          const signal = attemptController.signal;
          error = toFeedError(signal.aborted && signal.reason instanceof UpstreamError ? signal.reason : err);
        } finally {
          timers.clearTimeout(timer);
          controller.signal.removeEventListener("abort", forward);
        }
        if (!error.retryable || attempt === maxAttempts || controller.signal.aborted) break;
        const wait = error.retryAfterMs ?? backoffMs * 2 ** (attempt - 1);
        if (wait > maxRetryWaitMs || now() - started + wait >= opts.deadlineMs) break;
        if (!(await sleep(wait, controller.signal))) break;
      }
    } finally {
      timers.clearTimeout(deadline);
    }
    const hold = Math.max(error.retryAfterMs ?? 0, failureCooldownMs);
    cooldown = hold > 0 ? { until: now() + hold, error } : null;
    return { ok: false, error, stale: cache };
  }

  function waitFor(p: Promise<LoadResult<T>>, waitMs: number): Promise<LoadResult<T>> {
    return new Promise((resolve) => {
      const id = timers.setTimeout(
        () =>
          resolve({
            ok: false,
            error: {
              code: "pending",
              message: `${opts.name} is still loading`,
              retryable: true,
              retryAfterMs: pendingRetryMs,
            },
            stale: cache,
          }),
        waitMs,
      );
      void p.then((r) => {
        timers.clearTimeout(id);
        resolve(r);
      });
    });
  }

  return {
    stats,
    peek: () => cache,
    get({ force = false, waitMs } = {}) {
      const t = now();
      const age = cache ? t - cache.fetchedAt : Number.POSITIVE_INFINITY;
      const wantFresh = force ? age >= minForceAgeMs : age >= opts.ttlMs;
      if (!wantFresh && cache) {
        return Promise.resolve({ ok: true, data: cache.data, source: "cache", fetchedAt: cache.fetchedAt });
      }
      if (!inflight && cooldown && t < cooldown.until) {
        const limited = cooldown.error.code === "rate-limited";
        if (!force || limited) {
          return Promise.resolve({
            ok: false,
            error: { ...cooldown.error, retryAfterMs: cooldown.until - t },
            stale: cache,
          });
        }
      }
      if (!inflight) {
        inflight = run().finally(() => {
          inflight = null;
        });
      }
      return waitMs == null ? inflight : waitFor(inflight, waitMs);
    },
  };
}

/** Wire shape for a load result. `partial` derives incomplete-part notes from the data served. */
export function toFeedResponse<T, R>(
  result: LoadResult<T>,
  map: (data: T) => R,
  nowMs: number,
  partial: (data: T) => string[] = () => [],
): FeedResponse<R> {
  const respondedAt = new Date(nowMs).toISOString();
  if (result.ok) {
    return {
      data: map(result.data),
      source: result.source,
      fetchedAt: new Date(result.fetchedAt).toISOString(),
      respondedAt,
      error: null,
      partial: partial(result.data),
    };
  }
  const stale = result.stale;
  return {
    data: stale ? map(stale.data) : null,
    source: stale ? "cache" : "none",
    fetchedAt: stale ? new Date(stale.fetchedAt).toISOString() : null,
    respondedAt,
    error: result.error,
    partial: stale ? partial(stale.data) : [],
  };
}
