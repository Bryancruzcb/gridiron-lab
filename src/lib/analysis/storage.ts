// Named saved analyses in this browser's localStorage. Storage is injected so Node tests use a fake,
// and every failure comes back as a value: nothing here throws into render.
//
// One key holds { schemaVersion: 1, analyses: SavedAnalysis[] }. Records that fail validation are
// skipped on read but written back untouched, so a newer or damaged record is never silently lost.

import { z } from "zod";
import { optimizerAnalysisStateSchema, qbAnalysisStateSchema } from "./state.ts";

export const SAVED_ANALYSES_KEY = "gridiron-lab:saved-analyses";
export const SAVED_SCHEMA_VERSION = 1;
export const MAX_SAVED_ANALYSES = 50;
export const MAX_NAME_LENGTH = 80;
/** More entries than this are not read. */
const MAX_STORED_ENTRIES = 500;

export const LOCAL_ONLY_NOTE = "Saved in this browser on this device only. Nothing is uploaded or synced.";

export type AnalysisKind = "qb" | "optimizer";

const timestamp = z
  .string()
  .max(40)
  .refine((s) => !Number.isNaN(Date.parse(s)), "Not a timestamp.");

const recordBase = {
  schemaVersion: z.literal(SAVED_SCHEMA_VERSION),
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(MAX_NAME_LENGTH),
  createdAt: timestamp,
  updatedAt: timestamp,
  /** The data the analysis was made on: a season for QB views, a slate id for lineup views. */
  datasetRef: z.string().max(160).optional(),
};

export const savedAnalysisSchema = z.discriminatedUnion("kind", [
  z.object({ ...recordBase, kind: z.literal("qb"), state: qbAnalysisStateSchema }),
  z.object({ ...recordBase, kind: z.literal("optimizer"), state: optimizerAnalysisStateSchema }),
]);

export type SavedAnalysis = z.output<typeof savedAnalysisSchema>;
export type SavedOf<K extends AnalysisKind> = Extract<SavedAnalysis, { kind: K }>;

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type StoreErrorCode =
  | "unavailable"
  | "corrupt"
  | "unsupported-version"
  | "quota"
  | "write-failed"
  | "not-found"
  | "invalid-name"
  | "invalid-state"
  | "full";

export type StoreError = { code: StoreErrorCode; message: string };

export type StoreResult<T> = { ok: true; value: T } | { ok: false; error: StoreError };

export type SavedList<K extends AnalysisKind = AnalysisKind> = {
  analyses: SavedOf<K>[];
  /** Stored records that could not be read (kept in storage, not shown). */
  skipped: number;
};

export type SaveInput<K extends AnalysisKind> = {
  kind: K;
  name: string;
  state: unknown;
  datasetRef?: string;
};

export type AnalysisStore = {
  list<K extends AnalysisKind>(kind: K): StoreResult<SavedList<K>>;
  save<K extends AnalysisKind>(input: SaveInput<K>): StoreResult<SavedOf<K>>;
  open<K extends AnalysisKind>(kind: K, id: string): StoreResult<SavedOf<K>>;
  rename<K extends AnalysisKind>(kind: K, id: string, name: string): StoreResult<SavedOf<K>>;
  delete(id: string): StoreResult<null>;
  /** Removes every saved analysis, including unreadable ones. The recovery path for corrupt storage. */
  clear(): StoreResult<null>;
};

export type StoreOptions = {
  storage: StorageLike | null;
  now?: () => Date;
  newId?: () => string;
  key?: string;
};

const UNAVAILABLE = "This browser is not letting the page use local storage, so views can't be saved or opened here. Copy link still works.";

type Loaded = { analyses: SavedAnalysis[]; unreadable: unknown[] };

function fail<T>(code: StoreErrorCode, message: string): StoreResult<T> {
  return { ok: false, error: { code, message } };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function errorName(err: unknown): string {
  return isRecord(err) || err instanceof Error ? String((err as { name?: unknown }).name ?? "") : "";
}

function isQuotaError(err: unknown): boolean {
  const name = errorName(err);
  const code = isRecord(err) || err instanceof Error ? (err as { code?: unknown }).code : undefined;
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" || code === 22 || code === 1014;
}

/** Collapses whitespace and control characters; null when nothing printable is left or it is too long. */
export function normalizeName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const cleaned = [...name]
    .map((ch) => {
      const c = ch.charCodeAt(0);
      return c < 32 || c === 127 ? " " : ch;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 && cleaned.length <= MAX_NAME_LENGTH ? cleaned : null;
}

function defaultId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** localStorage, or null on the server or where the browser refuses access. */
export function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function createAnalysisStore({ storage, now = () => new Date(), newId = defaultId, key = SAVED_ANALYSES_KEY }: StoreOptions): AnalysisStore {
  function load(): StoreResult<Loaded> {
    if (!storage) return fail("unavailable", UNAVAILABLE);
    let text: string | null;
    try {
      text = storage.getItem(key);
    } catch {
      return fail("unavailable", UNAVAILABLE);
    }
    if (text === null) return { ok: true, value: { analyses: [], unreadable: [] } };
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      return fail("corrupt", "Saved views in this browser are damaged (not valid JSON), so they can't be read.");
    }
    if (!isRecord(doc) || doc.schemaVersion === undefined || !Array.isArray(doc.analyses)) {
      if (isRecord(doc) && doc.schemaVersion !== undefined && doc.schemaVersion !== SAVED_SCHEMA_VERSION)
        return unsupported(doc.schemaVersion);
      return fail("corrupt", "Saved views in this browser are not in a shape this page can read.");
    }
    if (doc.schemaVersion !== SAVED_SCHEMA_VERSION) return unsupported(doc.schemaVersion);
    const analyses: SavedAnalysis[] = [];
    const unreadable: unknown[] = [];
    const ids = new Set<string>();
    for (const [index, item] of doc.analyses.entries()) {
      // Records past the read cap are carried along unread, so the next write keeps them.
      if (index >= MAX_STORED_ENTRIES) {
        unreadable.push(item);
        continue;
      }
      const parsed = savedAnalysisSchema.safeParse(item);
      if (parsed.success && !ids.has(parsed.data.id)) {
        ids.add(parsed.data.id);
        analyses.push(parsed.data);
      } else unreadable.push(item);
    }
    return { ok: true, value: { analyses, unreadable } };
  }

  function unsupported(version: unknown): StoreResult<Loaded> {
    const v = String(JSON.stringify(version) ?? version).slice(0, 20);
    return fail("unsupported-version", `Saved views here use format version ${v}, which this page can't read. They were left as they are.`);
  }

  function write(loaded: Loaded): StoreResult<null> {
    if (!storage) return fail("unavailable", UNAVAILABLE);
    try {
      storage.setItem(key, JSON.stringify({ schemaVersion: SAVED_SCHEMA_VERSION, analyses: [...loaded.analyses, ...loaded.unreadable] }));
      return { ok: true, value: null };
    } catch (err) {
      if (isQuotaError(err)) return fail("quota", "This browser's storage for the site is full, so the change was not saved.");
      if (errorName(err) === "SecurityError") return fail("unavailable", UNAVAILABLE);
      return fail("write-failed", "The browser refused to save the change.");
    }
  }

  function find<K extends AnalysisKind>(loaded: Loaded, kind: K, id: string): SavedOf<K> | null {
    const hit = loaded.analyses.find((a) => a.id === id && a.kind === kind);
    return (hit as SavedOf<K> | undefined) ?? null;
  }

  const NOT_FOUND = "That saved view is gone. It may have been deleted in another tab.";

  return {
    list(kind) {
      const loaded = load();
      if (!loaded.ok) return loaded;
      const analyses = loaded.value.analyses
        .filter((a): a is SavedOf<typeof kind> => a.kind === kind)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
      return { ok: true, value: { analyses, skipped: loaded.value.unreadable.length } };
    },

    save({ kind, name, state, datasetRef }) {
      const clean = normalizeName(name);
      if (clean === null) return fail("invalid-name", `Give the view a name of 1 to ${MAX_NAME_LENGTH} characters.`);
      const at = now().toISOString();
      const parsed = savedAnalysisSchema.safeParse({
        schemaVersion: SAVED_SCHEMA_VERSION,
        id: newId(),
        name: clean,
        kind,
        createdAt: at,
        updatedAt: at,
        state,
        ...(datasetRef === undefined ? {} : { datasetRef: datasetRef.slice(0, 160) }),
      });
      if (!parsed.success) return fail("invalid-state", "This view has settings that can't be saved.");
      const loaded = load();
      if (!loaded.ok) return loaded;
      if (loaded.value.analyses.length >= MAX_SAVED_ANALYSES)
        return fail("full", `There are already ${MAX_SAVED_ANALYSES} saved views. Delete one first.`);
      const record = parsed.data as SavedOf<typeof kind>;
      const written = write({ ...loaded.value, analyses: [record, ...loaded.value.analyses] });
      return written.ok ? { ok: true, value: record } : written;
    },

    open(kind, id) {
      const loaded = load();
      if (!loaded.ok) return loaded;
      const hit = find(loaded.value, kind, id);
      return hit ? { ok: true, value: hit } : fail("not-found", NOT_FOUND);
    },

    rename(kind, id, name) {
      const clean = normalizeName(name);
      if (clean === null) return fail("invalid-name", `Give the view a name of 1 to ${MAX_NAME_LENGTH} characters.`);
      const loaded = load();
      if (!loaded.ok) return loaded;
      const hit = find(loaded.value, kind, id);
      if (!hit) return fail("not-found", NOT_FOUND);
      const renamed = { ...hit, name: clean, updatedAt: now().toISOString() };
      const written = write({ ...loaded.value, analyses: loaded.value.analyses.map((a) => (a.id === id ? renamed : a)) });
      return written.ok ? { ok: true, value: renamed } : written;
    },

    delete(id) {
      const loaded = load();
      if (!loaded.ok) return loaded;
      if (!loaded.value.analyses.some((a) => a.id === id)) return fail("not-found", NOT_FOUND);
      return write({ ...loaded.value, analyses: loaded.value.analyses.filter((a) => a.id !== id) });
    },

    clear() {
      if (!storage) return fail("unavailable", UNAVAILABLE);
      try {
        storage.removeItem(key);
        return { ok: true, value: null };
      } catch {
        return fail("unavailable", UNAVAILABLE);
      }
    },
  };
}
