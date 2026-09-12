import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import { forEachGzipLine } from "../../src/lib/live/lines.ts";
import { createLoader, toFeedError } from "../../src/lib/live/loader.ts";

function chunked(bytes: Uint8Array, size: number): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
}

/** Sends the first part of a gzip body, then stalls forever. Records whether it was cancelled. */
function stalled(bytes: Uint8Array) {
  const state = { cancelled: false };
  let sent = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent) return new Promise<void>(() => {});
      sent = true;
      controller.enqueue(bytes.slice(0, Math.floor(bytes.length / 2)));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { body, state };
}

const CSV = "game_id,week,passer_player_name\r\n2026_02_DET_CIN,2,J.Goff\r\n2026_02_BUF_MIA,2,J.Allen\né,2,Müller";

describe("gzip line stream", () => {
  it("splits CRLF and LF lines across chunk and multi-byte boundaries", async () => {
    const lines: string[] = [];
    await forEachGzipLine(chunked(gzipSync(CSV), 3), new AbortController().signal, (l) => lines.push(l));
    assert.deepEqual(lines, CSV.split(/\r?\n/));
  });

  it("settles and cancels the download when a stalled body is aborted", async () => {
    const big = gzipSync(Array.from({ length: 5_000 }, (_, i) => `${i},2,passer${i}`).join("\n"));
    const { body, state } = stalled(big);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    const started = performance.now();
    await assert.rejects(forEachGzipLine(body, controller.signal, () => {}), (err: Error) => err.name === "AbortError");
    assert.ok(performance.now() - started < 1_000);
    assert.equal(state.cancelled, true, "the source stream was cancelled, not left hanging");
  });

  it("bounds a stalled play-by-play download through the loader", async () => {
    const big = gzipSync(Array.from({ length: 5_000 }, (_, i) => `${i},2,passer${i}`).join("\n"));
    const { body, state } = stalled(big);
    let lines = 0;
    const loader = createLoader({
      name: "nflverse play-by-play",
      ttlMs: 1_000,
      attemptTimeoutMs: 40,
      deadlineMs: 1_000,
      maxAttempts: 1,
      load: async (signal) => {
        await forEachGzipLine(body, signal, () => (lines += 1));
        return lines;
      },
    });
    const started = performance.now();
    const r = await loader.get();
    assert.equal(!r.ok && r.error.code, "timeout");
    assert.ok(performance.now() - started < 1_000);
    assert.equal(state.cancelled, true);
  });

  it("rejects a corrupt gzip body as a retryable transfer failure", async () => {
    const bytes = gzipSync(CSV);
    bytes[20] = bytes[20]! ^ 0xff;
    bytes[21] = bytes[21]! ^ 0xff;
    const err = await forEachGzipLine(chunked(bytes, 64), new AbortController().signal, () => {}).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(err, "corrupt input must not resolve");
    assert.equal(toFeedError(err).retryable, true);
  });
});
