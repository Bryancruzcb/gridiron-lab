// Preloaded into the preview server by tests/e2e/run.mjs (NODE_OPTIONS --import). Every TCP
// connection or fetch to a host other than loopback fails and prints a marker line, so the browser
// checks prove the fixture switch kept the server off ESPN and nflverse instead of assuming it.
import net from "node:net";

export const OFFLINE_MARKER = "[e2e-offline]";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** @param {unknown} host */
function allowed(host) {
  return host == null || host === "" || (typeof host === "string" && LOOPBACK.has(host.toLowerCase()));
}

/** @param {string} what */
function report(what) {
  process.stderr.write(`${OFFLINE_MARKER} blocked ${what} (pid ${process.pid})\n`);
}

const realFetch = globalThis.fetch;
if (typeof realFetch === "function") {
  /** @type {typeof fetch} */
  const guarded = async (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    if (!allowed(url.hostname)) {
      report(`fetch ${url.origin}${url.pathname}`);
      throw new TypeError(`offline guard: ${url.origin} is not reachable in browser checks`);
    }
    return realFetch(input, init);
  };
  globalThis.fetch = guarded;
}

const realConnect = net.Socket.prototype.connect;
/** @this {net.Socket} @param {...any} args */
function guardedConnect(...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const ipc = typeof first === "object" && first !== null ? first.path != null : typeof first === "string" && Number.isNaN(Number(first));
  const host = typeof first === "object" && first !== null ? first.host : typeof args[1] === "string" ? args[1] : undefined;
  if (!ipc && !allowed(host)) {
    report(`socket ${host}`);
    process.nextTick(() => this.destroy(new Error(`offline guard: ${host} is not reachable in browser checks`)));
    return this;
  }
  return realConnect.apply(this, /** @type {any} */ (args));
}
net.Socket.prototype.connect = /** @type {any} */ (guardedConnect);

if (process.env.GRIDIRON_E2E_GUARD_VERBOSE) process.stderr.write(`${OFFLINE_MARKER} guard loaded (pid ${process.pid})\n`);
