// Shareable analysis state for the QB and lineup pages: URL search shapes, Zod schemas, and pure
// encode/decode. Decoding never throws. Invalid values fall back to bounded defaults and come back
// as issues the page can show.

import { z } from "zod";
import {
  hashString,
  parseSelection,
  SELECTION_VERSION,
  stableStringify,
  type LineupMode,
  type LineupSelection,
  type SelectionParse,
} from "../lineup/selection.ts";
import { playFloor, type DistFilter, type DownFilter, type SitFilter } from "../splits.ts";

export type StateIssueCode = "invalid" | "out-of-range" | "unavailable" | "conflict" | "too-many";

export type StateIssue = { field: string; code: StateIssueCode; message: string };

type Rec = Record<string, unknown>;

function isRecord(x: unknown): x is Rec {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Ids in a link are joined with ".": URLSearchParams leaves it unescaped and no player id uses it. */
export const ID_SEPARATOR = ".";
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function shown(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

/**
 * The router's search parser turns "a.b" into a string, a repeated key into an array and "123" into
 * a number. All of them become one flat list of raw items.
 */
function linkItems(raw: unknown): unknown[] | unknown {
  if (raw === undefined || raw === "") return [];
  if (typeof raw === "string") return raw.split(ID_SEPARATOR);
  if (typeof raw === "number") return String(raw).split(ID_SEPARATOR);
  if (Array.isArray(raw))
    return raw.flatMap((item) =>
      typeof item === "string" || typeof item === "number" ? String(item).split(ID_SEPARATOR) : [item],
    );
  return raw;
}

// ---- QB ------------------------------------------------------------------------

export const DOWN_FILTERS = ["all", "1", "2", "3", "4"] as const;
export const DIST_FILTERS = ["all", "short", "medium", "long"] as const;
export const SIT_FILTERS = ["all", "redzone", "twominute", "trailing", "leading", "neutral", "pressured", "clean"] as const;
export const QB_SORTS = ["epa", "cpoe", "comp", "press"] as const;
export type QbSort = (typeof QB_SORTS)[number];

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
// Fails to compile if splits.ts gains or loses a filter value.
const _filtersMatchSplits: [
  Same<(typeof DOWN_FILTERS)[number], DownFilter>,
  Same<(typeof DIST_FILTERS)[number], DistFilter>,
  Same<(typeof SIT_FILTERS)[number], SitFilter>,
] = [true, true, true];

export const QB_DEFAULT_SEASON = 2026;
export const QB_SEASON_RANGE = { min: 1999, max: 2100 } as const;
export const MAX_PINS = 4;
/** A pinned list longer than this is not read at all. */
const MAX_PIN_ITEMS = 64;
const MAX_MIN_PLAYS = 10_000;

export type QbAnalysisState = {
  season: number;
  down: DownFilter;
  distance: DistFilter;
  situation: SitFilter;
  /** Null means the slice's default floor from playFloor. */
  minPlays: number | null;
  sort: QbSort;
  /** Ordered and unique. Null means the default pins, which follow the season's data. */
  pins: string[] | null;
};

export const playerIdSchema = z.string().regex(ID_PATTERN);

export const qbAnalysisStateSchema = z.object({
  season: z.number().int().min(QB_SEASON_RANGE.min).max(QB_SEASON_RANGE.max),
  down: z.enum(DOWN_FILTERS),
  distance: z.enum(DIST_FILTERS),
  situation: z.enum(SIT_FILTERS),
  minPlays: z.number().int().min(0).max(MAX_MIN_PLAYS).nullable(),
  sort: z.enum(QB_SORTS),
  pins: z
    .array(playerIdSchema)
    .max(MAX_PINS)
    .refine((ids) => new Set(ids).size === ids.length, "Pinned ids repeat.")
    .nullable(),
}) satisfies z.ZodType<QbAnalysisState>;

/** The QB page's URL. Defaults are left out, except the season. */
export type QbSearch = {
  season?: number;
  down?: 1 | 2 | 3 | 4;
  dist?: Exclude<DistFilter, "all">;
  sit?: Exclude<SitFilter, "all">;
  min?: number;
  sort?: QbSort;
  /** Pinned ids joined with "."; an empty string pins nobody. */
  pins?: string;
};

export type QbDecodeOptions = {
  /** Seasons the page has data for. Without it, any season in range is accepted. */
  seasons?: readonly number[];
};

export type QbDecoded = { state: QbAnalysisState; issues: StateIssue[] };

export function defaultQbSeason(seasons?: readonly number[]): number {
  return seasons && seasons.length > 0 && !seasons.includes(QB_DEFAULT_SEASON) ? Math.max(...seasons) : QB_DEFAULT_SEASON;
}

function integerOf(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN;
  return Number.isInteger(n) ? n : null;
}

function decodeSeason(raw: unknown, seasons: readonly number[] | undefined, issues: StateIssue[]): number {
  const fallback = defaultQbSeason(seasons);
  if (raw === undefined || raw === "") return fallback;
  const n = integerOf(raw);
  if (n === null || n < QB_SEASON_RANGE.min || n > QB_SEASON_RANGE.max) {
    issues.push({ field: "season", code: "invalid", message: `Season "${shown(raw)}" is not a season; showing ${fallback}.` });
    return fallback;
  }
  if (seasons && !seasons.includes(n)) {
    issues.push({ field: "season", code: "unavailable", message: `There is no quarterback data for ${n} here; showing ${fallback}.` });
    return fallback;
  }
  return n;
}

function decodeChoice<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  fallback: T,
  field: string,
  label: string,
  issues: StateIssue[],
): T {
  if (raw === undefined || raw === "") return fallback;
  const text = typeof raw === "string" || typeof raw === "number" ? String(raw) : null;
  const hit = allowed.find((v) => v === text);
  if (hit !== undefined) return hit;
  issues.push({ field, code: "invalid", message: `${label} "${shown(raw)}" is not an option; using ${fallback}.` });
  return fallback;
}

function decodeMinPlays(raw: unknown, floor: { min: number; max: number }, issues: StateIssue[]): number | null {
  if (raw === undefined || raw === "") return null;
  const n = integerOf(raw);
  if (n === null) {
    issues.push({ field: "min", code: "invalid", message: `Min dropbacks "${shown(raw)}" is not a whole number; using this slice's default.` });
    return null;
  }
  if (n < floor.min || n > floor.max) {
    const bounded = Math.min(floor.max, Math.max(floor.min, n));
    issues.push({
      field: "min",
      code: "out-of-range",
      message: `Min dropbacks ${shown(n)} is outside this slice's ${floor.min}–${floor.max} range; using ${bounded}.`,
    });
    return bounded;
  }
  return n;
}

function decodePins(raw: unknown, issues: StateIssue[]): string[] | null {
  if (raw === undefined) return null;
  const items = linkItems(raw);
  if (!Array.isArray(items)) {
    issues.push({ field: "pins", code: "invalid", message: "Pinned players must be a list of ids; showing the default pins." });
    return null;
  }
  if (items.length > MAX_PIN_ITEMS) {
    issues.push({ field: "pins", code: "too-many", message: `The link pins ${items.length} ids; showing the default pins instead.` });
    return null;
  }
  const ids: string[] = [];
  let invalid = 0;
  for (const item of items) {
    if (typeof item !== "string" || !ID_PATTERN.test(item)) invalid++;
    else if (!ids.includes(item)) ids.push(item);
  }
  if (invalid)
    issues.push({ field: "pins", code: "invalid", message: `${invalid === 1 ? "1 pinned value is" : `${invalid} pinned values are`} not a player id and ${invalid === 1 ? "was" : "were"} dropped.` });
  if (ids.length > MAX_PINS)
    issues.push({ field: "pins", code: "too-many", message: `Only ${MAX_PINS} quarterbacks can be pinned; kept the first ${MAX_PINS}.` });
  return ids.slice(0, MAX_PINS);
}

/** Reads the QB page's search params (raw or already validated) into a complete state. */
export function decodeQbSearch(raw: unknown, opts: QbDecodeOptions = {}): QbDecoded {
  const search = isRecord(raw) ? raw : {};
  const issues: StateIssue[] = [];
  const season = decodeSeason(search.season, opts.seasons, issues);
  let down = decodeChoice(search.down, DOWN_FILTERS, "all", "down", "Down", issues);
  let distance = decodeChoice(search.dist, DIST_FILTERS, "all", "dist", "Distance", issues);
  const situation = decodeChoice(search.sit, SIT_FILTERS, "all", "sit", "Situation", issues);
  if (situation !== "all" && (down !== "all" || distance !== "all")) {
    issues.push({ field: "sit", code: "conflict", message: "A situation filter replaces down and distance, so those were set back to all." });
    down = "all";
    distance = "all";
  }
  const sort = decodeChoice(search.sort, QB_SORTS, "epa", "sort", "Sort", issues);
  const minPlays = decodeMinPlays(search.min, playFloor(season, down, distance, situation), issues);
  const pins = decodePins(search.pins, issues);
  return { state: { season, down, distance, situation, minPlays, sort, pins }, issues };
}

export function encodeQbSearch(state: QbAnalysisState): QbSearch {
  const out: QbSearch = { season: state.season };
  if (state.down !== "all") out.down = Number(state.down) as 1 | 2 | 3 | 4;
  if (state.distance !== "all") out.dist = state.distance;
  if (state.situation !== "all") out.sit = state.situation;
  if (state.minPlays !== null) out.min = state.minPlays;
  if (state.sort !== "epa") out.sort = state.sort;
  if (state.pins !== null) out.pins = state.pins.join(ID_SEPARATOR);
  return out;
}

/**
 * Router validateSearch for /qb: canonical values for everything that decodes cleanly. A value with
 * an issue is left out, because the router writes validated values over the URL on load; leaving it
 * keeps the raw value there, so the page can say it was not used.
 */
export function validateQbSearch(raw: Record<string, unknown>): QbSearch {
  const { state, issues } = decodeQbSearch(raw);
  const search = encodeQbSearch(state);
  for (const issue of issues) delete search[issue.field as keyof QbSearch];
  return search;
}

export type QbEdit =
  | { type: "season"; season: number }
  | { type: "down"; down: DownFilter }
  | { type: "distance"; distance: DistFilter }
  | { type: "situation"; situation: SitFilter }
  | { type: "sort"; sort: QbSort }
  | { type: "min"; minPlays: number }
  | { type: "reset-min" }
  /** `defaults` are the season's default pins, the starting list while no pin is explicit. */
  | { type: "toggle-pin"; id: string; defaults: readonly string[] }
  | { type: "set-pins"; pins: string[] };

/**
 * One user edit. A new season or slice resets min dropbacks to that slice's default, and a new
 * season lets the default pins follow it; nothing else ever replaces an explicit value.
 */
export function editQb(state: QbAnalysisState, edit: QbEdit): QbAnalysisState {
  const slice = (next: Pick<QbAnalysisState, "down" | "distance" | "situation">): QbAnalysisState =>
    next.down === state.down && next.distance === state.distance && next.situation === state.situation
      ? state
      : { ...state, ...next, minPlays: null };
  switch (edit.type) {
    case "season":
      return edit.season === state.season ? state : { ...state, season: edit.season, minPlays: null, pins: null };
    case "down":
      return slice({ down: edit.down, distance: state.distance, situation: "all" });
    case "distance":
      return slice({ down: state.down, distance: edit.distance, situation: "all" });
    case "situation":
      return edit.situation === "all"
        ? slice({ down: state.down, distance: state.distance, situation: "all" })
        : slice({ down: "all", distance: "all", situation: edit.situation });
    case "sort":
      return edit.sort === state.sort ? state : { ...state, sort: edit.sort };
    case "min":
      return edit.minPlays === state.minPlays ? state : { ...state, minPlays: edit.minPlays };
    case "reset-min":
      return state.minPlays === null ? state : { ...state, minPlays: null };
    case "toggle-pin": {
      const { id } = edit;
      const current = state.pins ?? edit.defaults;
      if (current.includes(id)) return { ...state, pins: current.filter((x) => x !== id) };
      return { ...state, pins: current.length >= MAX_PINS ? [...current.slice(1), id] : [...current, id] };
    }
    case "set-pins":
      return { ...state, pins: edit.pins };
  }
}

// ---- Lineup ----------------------------------------------------------------------

/** A lineup page analysis is its selection; parseSelection stays the one selection schema. */
export type OptimizerAnalysisState = LineupSelection;

export const optimizerAnalysisStateSchema = z.unknown().transform((raw, ctx): LineupSelection => {
  const slate = isRecord(raw) && typeof raw.slate === "string" ? raw.slate : "";
  const parsed = parseSelection(raw, slate);
  if (!parsed.ok) {
    for (const issue of parsed.issues) ctx.addIssue({ code: "custom", message: issue.message });
    return z.NEVER;
  }
  return parsed.selection;
});

/** The lineup page's URL. An empty selection has no params at all. */
export type OptimizerSearch = {
  slate?: string;
  mode?: LineupMode;
  /** Locked ids joined with "." */
  lock?: string;
  /** Benched ids joined with "." */
  bench?: string;
  stack?: boolean;
};

const OPTIMIZER_KEYS = ["slate", "mode", "lock", "bench", "stack"] as const;

export type SelectionLink = {
  /** Equal for equal selections, so the page can tell a new link from its own write. */
  key: string;
  /** What parseSelection was given. */
  raw: unknown;
  parse: SelectionParse;
};

export function selectionKey(s: LineupSelection): string {
  return stableStringify({ slate: s.slate, mode: s.mode, locked: s.locked, excluded: s.excluded, stack: s.stack });
}

function linkFlag(raw: unknown): unknown {
  if (raw === undefined || raw === "" || raw === false || raw === 0 || raw === "false" || raw === "0") return false;
  if (raw === true || raw === 1 || raw === "true" || raw === "1") return true;
  return raw;
}

/**
 * Null when the URL carries no selection. Otherwise the link as a raw selection plus its
 * parseSelection verdict: conflicts and oversized lists are reported there, never resolved here.
 */
export function decodeOptimizerSearch(raw: unknown, slate: string): SelectionLink | null {
  const search = isRecord(raw) ? raw : {};
  if (!OPTIMIZER_KEYS.some((k) => search[k] !== undefined)) return null;
  const candidate = {
    version: SELECTION_VERSION,
    slate: search.slate === undefined ? slate : typeof search.slate === "number" ? String(search.slate) : search.slate,
    mode: search.mode === undefined || search.mode === "" ? "proj" : search.mode,
    locked: linkItems(search.lock),
    excluded: linkItems(search.bench),
    stack: linkFlag(search.stack),
  };
  const parse = parseSelection(candidate, slate);
  const key = parse.ok ? selectionKey(parse.selection) : `invalid:${hashString(stableStringify(candidate))}`;
  return { key, raw: candidate, parse };
}

export function encodeOptimizerSearch(selection: LineupSelection): OptimizerSearch {
  const out: OptimizerSearch = { slate: selection.slate };
  if (selection.mode !== "proj") out.mode = selection.mode;
  if (selection.locked.length) out.lock = selection.locked.join(ID_SEPARATOR);
  if (selection.excluded.length) out.bench = selection.excluded.join(ID_SEPARATOR);
  if (selection.stack) out.stack = true;
  return out;
}

export function isEmptySelection(s: LineupSelection): boolean {
  return s.mode === "proj" && !s.stack && s.locked.length === 0 && s.excluded.length === 0;
}

/** Router validateSearch for /optimizer: the canonical search of a valid link, else nothing. */
export function validateOptimizerSearch(raw: Record<string, unknown>, slate: string): OptimizerSearch {
  const link = decodeOptimizerSearch(raw, slate);
  return link?.parse.ok ? encodeOptimizerSearch(link.parse.selection) : {};
}
