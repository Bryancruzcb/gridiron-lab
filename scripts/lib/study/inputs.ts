// Input acquisition: fetch source bytes into a content-addressed cache, verify SHA-256 on every
// read, and describe each file with a manifest entry. Offline mode reads only the cache.
//
// Cache layout (paths relative to the cache directory):
//   snapshots/<sha256>/<fileName>   the bytes, never overwritten
//   entries/<id>/<sha256>.json      manifest entry for that snapshot (first retrieval kept)
//   current/<id>.json               the entry an unpinned run uses

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { StudyInputIdentity, StudyInputManifestEntry } from "../../../src/data/types.ts";
import { CsvColumnError, normalizeHeader, parseCsvLine } from "../../../src/lib/football/csv.ts";
import { UA } from "../../../src/lib/live/csv.ts";
import { StudyInputError } from "./errors.ts";
import { sha256Hex } from "./hash.ts";
import type { InputSpec } from "./sources.ts";

export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; redirect: "follow"; signal: AbortSignal },
) => Promise<Response>;

export type AcquireOptions = {
  cacheDir: string;
  offline: boolean;
  /** Fetch again even when the cache already has the input. */
  refresh?: boolean;
  /** Input id to expected sha256. A pinned input must match exactly, from the cache or the network. */
  pins?: ReadonlyMap<string, string>;
  fetchImpl?: FetchLike;
  now?: () => Date;
  timeoutMs?: number;
  log?: (message: string) => void;
};

export type AcquiredInput = {
  spec: InputSpec;
  text: string;
  identity: StudyInputIdentity;
  entry: StudyInputManifestEntry;
};

const utf8 = new TextDecoder("utf-8", { fatal: true });

function firstLine(text: string): string {
  const end = text.search(/\r?\n/);
  return end === -1 ? text : text.slice(0, end);
}

/** Decodes and describes source bytes. A CSV must carry every required column. */
export function describeInput(spec: InputSpec, bytes: Uint8Array): { text: string; identity: StudyInputIdentity } {
  const source = `${spec.id} (${spec.url})`;
  let text: string;
  try {
    text = utf8.decode(bytes);
  } catch {
    throw new StudyInputError(`${source}: bytes are not valid UTF-8`);
  }
  let headerSha256: string | null = null;
  let columns: number | null = null;
  if (spec.fileName.endsWith(".csv")) {
    const names = parseCsvLine(firstLine(text)).map(normalizeHeader);
    const missing = spec.requiredColumns.filter((c) => !names.includes(normalizeHeader(c)));
    if (missing.length) throw new CsvColumnError(source, missing);
    headerSha256 = sha256Hex(names.join(","));
    columns = names.length;
  }
  return {
    text,
    identity: {
      id: spec.id,
      role: spec.role,
      season: spec.season,
      url: spec.url,
      sha256: sha256Hex(bytes),
      bytes: bytes.byteLength,
      schema: { id: spec.schemaId, headerSha256, columns, requiredColumns: [...spec.requiredColumns] },
    },
  };
}

function writeAtomic(path: string, data: string | Uint8Array) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

function readEntry(path: string): StudyInputManifestEntry | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as StudyInputManifestEntry;
  } catch (e) {
    throw new StudyInputError(`${path}: unreadable cache manifest entry (${(e as Error).message})`);
  }
}

const entryPath = (cacheDir: string, id: string, sha256: string) => join(cacheDir, "entries", id, `${sha256}.json`);
const currentPath = (cacheDir: string, id: string) => join(cacheDir, "current", `${id}.json`);

/** Stores bytes as a snapshot and points the input's current entry at it. */
export function storeSnapshot(
  cacheDir: string,
  spec: InputSpec,
  bytes: Uint8Array,
  retrievedAt: string,
  http: StudyInputManifestEntry["http"],
): AcquiredInput {
  const { text, identity } = describeInput(spec, bytes);
  const localPath = `snapshots/${identity.sha256}/${spec.fileName}`;
  const abs = join(cacheDir, localPath);
  if (!existsSync(abs)) writeAtomic(abs, bytes);
  const known = readEntry(entryPath(cacheDir, spec.id, identity.sha256));
  const entry: StudyInputManifestEntry = known ?? { ...identity, localPath, retrievedAt, http };
  const json = `${JSON.stringify(entry, null, 2)}\n`;
  if (!known) writeAtomic(entryPath(cacheDir, spec.id, identity.sha256), json);
  writeAtomic(currentPath(cacheDir, spec.id), json);
  return { spec, text, identity, entry: { ...identity, localPath: entry.localPath, retrievedAt: entry.retrievedAt, http: entry.http } };
}

function loadEntry(cacheDir: string, spec: InputSpec, entry: StudyInputManifestEntry): AcquiredInput {
  if (entry.id !== spec.id || entry.url !== spec.url) {
    throw new StudyInputError(`${spec.id}: cache entry describes ${entry.id} from ${entry.url}, expected ${spec.url}`);
  }
  const abs = join(cacheDir, entry.localPath);
  if (!existsSync(abs)) throw new StudyInputError(`${spec.id}: cached snapshot ${abs} is missing`);
  const bytes = readFileSync(abs);
  const sha = sha256Hex(bytes);
  if (sha !== entry.sha256) {
    throw new StudyInputError(`${spec.id}: ${abs} hashes to ${sha} but its manifest entry says ${entry.sha256}; the cache was modified`);
  }
  const { text, identity } = describeInput(spec, bytes);
  return {
    spec,
    text,
    identity,
    entry: { ...identity, localPath: entry.localPath, retrievedAt: entry.retrievedAt, http: entry.http ?? null },
  };
}

async function fetchBytes(spec: InputSpec, opts: AcquireOptions) {
  const fetchImpl: FetchLike = opts.fetchImpl ?? fetch;
  opts.log?.(`fetch ${spec.url}`);
  let res: Response;
  let bytes: Uint8Array;
  try {
    res = await fetchImpl(spec.url, {
      headers: { ...UA },
      redirect: "follow",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
    });
    if (!res.ok) throw new StudyInputError(`${spec.id}: GET ${spec.url} returned HTTP ${res.status}`);
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    if (e instanceof StudyInputError) throw e;
    throw new StudyInputError(`${spec.id}: GET ${spec.url} failed: ${(e as Error).message}`);
  }
  return { bytes, http: { etag: res.headers.get("etag"), lastModified: res.headers.get("last-modified") } };
}

/**
 * Returns the input's verified bytes. Unpinned: the current cache entry, else a fetch (unless
 * offline). Pinned: exactly the pinned snapshot, else a fetch whose hash must equal the pin.
 */
export async function acquireInput(spec: InputSpec, opts: AcquireOptions): Promise<AcquiredInput> {
  const pin = opts.pins?.get(spec.id) ?? null;
  const cached = pin
    ? readEntry(entryPath(opts.cacheDir, spec.id, pin))
    : opts.refresh
      ? null
      : readEntry(currentPath(opts.cacheDir, spec.id));
  if (cached) return loadEntry(opts.cacheDir, spec, cached);
  if (opts.offline) {
    if (pin) throw new StudyInputError(`offline: ${spec.id} pinned to sha256 ${pin} is not in the cache at ${opts.cacheDir}`);
    if (opts.refresh) throw new StudyInputError("offline: --refresh needs the network");
    throw new StudyInputError(
      `offline: ${spec.id} is not cached in ${opts.cacheDir}; run once without --offline to fetch ${spec.url}`,
    );
  }
  const fetched = await fetchBytes(spec, opts);
  const sha = sha256Hex(fetched.bytes);
  if (pin && sha !== pin) {
    throw new StudyInputError(`${spec.id}: ${spec.url} now hashes to ${sha}, not the pinned ${pin}; the upstream file changed`);
  }
  const now = opts.now ?? (() => new Date());
  return storeSnapshot(opts.cacheDir, spec, fetched.bytes, now().toISOString(), fetched.http);
}

/** Acquires inputs one at a time, once per id. */
export async function acquireInputs(specs: readonly InputSpec[], opts: AcquireOptions): Promise<Map<string, AcquiredInput>> {
  const out = new Map<string, AcquiredInput>();
  for (const spec of specs) {
    if (!out.has(spec.id)) out.set(spec.id, await acquireInput(spec, opts));
  }
  return out;
}
