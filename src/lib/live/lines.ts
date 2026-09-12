// Line streaming for nflverse gzip releases. One pipeline owns every stage, so aborting the signal
// destroys the download, the gunzip and the parser together and the promise always settles.

import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { createGunzip } from "node:zlib";

export async function forEachGzipLine(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onLine: (line: string) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let rest = "";
  const emit = (line: string) => onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
  await pipeline(
    Readable.fromWeb(body as WebReadableStream<Uint8Array>),
    createGunzip(),
    async function (source: AsyncIterable<Buffer>) {
      for await (const chunk of source) {
        const text = rest + decoder.decode(chunk, { stream: true });
        let start = 0;
        for (let nl = text.indexOf("\n"); nl >= 0; nl = text.indexOf("\n", start)) {
          emit(text.slice(start, nl));
          start = nl + 1;
        }
        rest = text.slice(start);
      }
      rest += decoder.decode();
      if (rest) emit(rest);
    },
    { signal },
  );
}
