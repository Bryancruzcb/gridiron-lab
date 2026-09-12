import type { FantasyPlayer } from "@/data/types";
import type { CompareJob, CompareOutcome, LineupJob, LineupOutcome, SolveOutcome } from "./worker-protocol.ts";

// ---- Selection -------------------------------------------------------------

export type LineupMode = "proj" | "actual";

/**
 * What the user chose on the lineup page. Plain JSON on purpose, so URL state and saved views
 * can mirror it with a schema and feed raw values back through parseSelection.
 */
export type LineupSelection = {
  version: 1;
  /** Slate the ids refer to (slateId). */
  slate: string;
  mode: LineupMode;
  /** Sorted, unique, and never overlapping `excluded`. */
  locked: string[];
  excluded: string[];
  stack: boolean;
};

export const SELECTION_VERSION = 1;
export const MAX_SELECTION_IDS = 250;
const MAX_ID_LENGTH = 64;
const MAX_SLATE_LENGTH = 120;

export function emptySelection(slate: string): LineupSelection {
  return { version: SELECTION_VERSION, slate, mode: "proj", locked: [], excluded: [], stack: false };
}

function sortedUnique(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort();
}

/** Locking a benched player un-benches him. */
export function toggleLock(selection: LineupSelection, id: string): LineupSelection {
  if (selection.locked.includes(id)) return { ...selection, locked: selection.locked.filter((x) => x !== id) };
  return { ...selection, locked: sortedUnique([...selection.locked, id]), excluded: selection.excluded.filter((x) => x !== id) };
}

/** Benching a locked player unlocks him. */
export function toggleExclude(selection: LineupSelection, id: string): LineupSelection {
  if (selection.excluded.includes(id)) return { ...selection, excluded: selection.excluded.filter((x) => x !== id) };
  return { ...selection, excluded: sortedUnique([...selection.excluded, id]), locked: selection.locked.filter((x) => x !== id) };
}

export type SelectionIssueCode = "malformed" | "unsupported-version" | "too-many-ids" | "lock-exclude-overlap" | "slate-mismatch";

export type SelectionIssue = { code: SelectionIssueCode; message: string; ids?: string[] };

export type SelectionParse =
  | { ok: true; selection: LineupSelection; warnings: SelectionIssue[] }
  | { ok: false; issues: SelectionIssue[] };

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function idList(raw: unknown, label: string, issues: SelectionIssue[]): string[] {
  if (!Array.isArray(raw)) {
    issues.push({ code: "malformed", message: `${label} must be a list of player ids.` });
    return [];
  }
  if (raw.length > MAX_SELECTION_IDS) {
    issues.push({ code: "too-many-ids", message: `${label} lists ${raw.length} ids; the limit is ${MAX_SELECTION_IDS}.` });
    return [];
  }
  const ids = raw.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= MAX_ID_LENGTH);
  if (ids.length !== raw.length) {
    issues.push({ code: "malformed", message: `${label} has ${raw.length - ids.length} value(s) that are not player ids.` });
    return [];
  }
  return sortedUnique(ids);
}

/**
 * Validates an imported selection (in-memory restore today, URL or saved view later). A conflict
 * is reported, never resolved by picking a winner, and nothing is applied.
 */
export function parseSelection(raw: unknown, slate: string): SelectionParse {
  if (!isRecord(raw)) return { ok: false, issues: [{ code: "malformed", message: "The lineup setup is not an object." }] };
  if (raw.version !== SELECTION_VERSION)
    return {
      ok: false,
      issues: [{ code: "unsupported-version", message: `Lineup setup version ${String(raw.version)} is not supported.` }],
    };
  const issues: SelectionIssue[] = [];
  const { mode, stack } = raw;
  if (mode !== "proj" && mode !== "actual") issues.push({ code: "malformed", message: 'Mode must be "proj" or "actual".' });
  if (typeof stack !== "boolean") issues.push({ code: "malformed", message: "Stack must be true or false." });
  const from = typeof raw.slate === "string" && raw.slate.length > 0 && raw.slate.length <= MAX_SLATE_LENGTH ? raw.slate : null;
  if (from === null) issues.push({ code: "malformed", message: "Slate must be a slate id." });
  const locked = idList(raw.locked, "Locked", issues);
  const excluded = idList(raw.excluded, "Benched", issues);
  const overlap = locked.filter((id) => excluded.includes(id));
  if (overlap.length)
    issues.push({
      code: "lock-exclude-overlap",
      ids: overlap,
      message: `${overlap.length === 1 ? "1 player is" : `${overlap.length} players are`} both locked and benched.`,
    });
  if (issues.length || from === null || (mode !== "proj" && mode !== "actual") || typeof stack !== "boolean")
    return { ok: false, issues };
  const warnings: SelectionIssue[] =
    from === slate
      ? []
      : [{ code: "slate-mismatch", message: `This setup was made for slate ${from}, not ${slate}. Players missing from this slate stay listed.` }];
  return { ok: true, selection: { version: SELECTION_VERSION, slate: from, mode, locked, excluded, stack }, warnings };
}

// ---- Fingerprints ------------------------------------------------------------

/** JSON with object keys sorted, so equal values always produce the same string. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const rec = value as Record<string, unknown>;
  const keys = Object.keys(rec)
    .filter((k) => rec[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(rec[k])}`).join(",")}}`;
}

/** cyrb53: 53-bit string hash, base 36. An identity for inputs, not a security boundary. */
export function hashString(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function fingerprintOf(value: unknown): string {
  return hashString(stableStringify(value));
}

function byId(a: FantasyPlayer, b: FantasyPlayer) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Only the fields a solve reads; names and headshots do not change a result. */
function solveShape(players: readonly FantasyPlayer[]) {
  return players.map((p) => [p.id, p.pos, p.team, p.salary, p.proj]);
}

export function slateId(season: number, players: readonly FantasyPlayer[], cap: number): string {
  return `fantasy-${season}-${fingerprintOf({ cap, players: solveShape(players.slice().sort(byId)) })}`;
}

export function actualsVersion(actuals: ReadonlyMap<string, number> | null): string | null {
  if (!actuals) return null;
  return fingerprintOf([...actuals].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
}

// ---- Request plans -----------------------------------------------------------

export type LineupData = {
  players: readonly FantasyPlayer[];
  cap: number;
  /** This week's actual points by player id; null until week scores load. */
  actuals: ReadonlyMap<string, number> | null;
};

export type PlanIssueCode = "lock-not-on-slate" | "lock-unscored" | "no-actuals";

export type PlanIssue = { code: PlanIssueCode; message: string; ids: string[] };

export type LineupPlan =
  | { ok: true; fingerprint: string; job: LineupJob }
  | { ok: false; fingerprint: string; issues: PlanIssue[] };

export type ComparePlan = { fingerprint: string; job: CompareJob };

function players(n: number) {
  return n === 1 ? "1 locked player" : `${n} locked players`;
}

/** Hindsight slate: players with an actual score, projected at that score. */
export function actualSlate(pool: readonly FantasyPlayer[], actuals: ReadonlyMap<string, number>): FantasyPlayer[] {
  const out: FantasyPlayer[] = [];
  for (const p of pool) {
    const pts = actuals.get(p.id);
    if (pts !== undefined) out.push({ ...p, proj: pts });
  }
  return out;
}

/**
 * The exact request a Run would send for this selection and data. The fingerprint covers every
 * solve input, so a result is current only while its fingerprint equals this one.
 */
export function planLineup(selection: LineupSelection, data: LineupData): LineupPlan {
  const known = new Set(data.players.map((p) => p.id));
  const issues: PlanIssue[] = [];
  const offSlate = selection.locked.filter((id) => !known.has(id));
  if (offSlate.length)
    issues.push({ code: "lock-not-on-slate", ids: offSlate, message: `${players(offSlate.length)} not on this slate.` });

  let pool: readonly FantasyPlayer[] = data.players;
  if (selection.mode === "actual") {
    const actuals = data.actuals;
    if (!actuals || actuals.size === 0) {
      issues.push({ code: "no-actuals", ids: [], message: "No actual scores are loaded, so there is nothing to solve in hindsight yet." });
    } else {
      const unscored = selection.locked.filter((id) => known.has(id) && !actuals.has(id));
      if (unscored.length)
        issues.push({
          code: "lock-unscored",
          ids: unscored,
          message: `Hindsight only uses players with an actual score, and ${players(unscored.length)} ${unscored.length === 1 ? "has" : "have"} none yet. Unlock or switch back to projections.`,
        });
      pool = actualSlate(data.players, actuals);
    }
  }

  const sorted = pool.slice().sort(byId);
  const inPool = new Set(sorted.map((p) => p.id));
  const job: LineupJob = {
    kind: "lineup",
    mode: selection.mode,
    players: sorted,
    cap: data.cap,
    locked: selection.locked,
    excluded: selection.excluded.filter((id) => inPool.has(id)),
    requireStack: selection.stack,
  };
  const fingerprint = fingerprintOf({
    v: 1,
    kind: job.kind,
    mode: job.mode,
    cap: job.cap,
    locked: job.locked,
    excluded: job.excluded,
    requireStack: job.requireStack,
    players: solveShape(sorted),
    blocked: issues.map((i) => i.code),
  });
  return issues.length ? { ok: false, fingerprint, issues } : { ok: true, fingerprint, job };
}

/** Whole-slate method comparison: needs week scores, ignores the user's constraints. */
export function planCompare(data: LineupData): ComparePlan | null {
  if (!data.actuals || data.actuals.size === 0) return null;
  const pool = data.players.slice().sort(byId);
  const scored = actualSlate(pool, data.actuals);
  const job: CompareJob = { kind: "compare", players: pool, scored, cap: data.cap };
  return {
    fingerprint: fingerprintOf({ v: 1, kind: job.kind, cap: job.cap, players: solveShape(pool), scored: solveShape(scored) }),
    job,
  };
}

// ---- Controller state ----------------------------------------------------------

export type Channel = "lineup" | "compare";

export type Pending = { requestId: number; fingerprint: string };

export type Settled<T> = Pending & { outcome: T; elapsedMs: number };

export type RequestFailure = Pending & { code: string; message: string };

export type ChannelState<T> = {
  pending: Pending | null;
  /** Last accepted result; current only while its fingerprint matches the active plan. */
  settled: Settled<T> | null;
  failure: RequestFailure | null;
  cancelled: Pending | null;
};

export type ImportReport = { source: string; applied: boolean; issues: SelectionIssue[] };

export type DataVersion = { slate: string; actuals: string | null };

export type LineupState = {
  selection: LineupSelection;
  data: DataVersion;
  /** Bumped by reset and an applied import, so both recompute the way a mode or data change does. */
  epoch: number;
  lastRequestId: number;
  lineup: ChannelState<LineupOutcome>;
  compare: ChannelState<CompareOutcome>;
  importReport: ImportReport | null;
};

export type LineupAction =
  | { type: "toggle-lock"; id: string }
  | { type: "toggle-exclude"; id: string }
  | { type: "set-stack"; stack: boolean }
  | { type: "set-mode"; mode: LineupMode }
  | { type: "data"; data: DataVersion }
  | { type: "request-start"; channel: Channel; requestId: number; fingerprint: string }
  | { type: "request-result"; requestId: number; fingerprint: string; outcome: SolveOutcome; elapsedMs: number }
  | { type: "request-failure"; channel: Channel; requestId: number; fingerprint: string; code: string; message: string }
  | { type: "cancel"; channel: Channel; requestId: number }
  | { type: "reset" }
  | { type: "import"; raw: unknown; source: string }
  | { type: "dismiss-import" };

function idleChannel<T>(): ChannelState<T> {
  return { pending: null, settled: null, failure: null, cancelled: null };
}

export function initialLineupState(data: DataVersion): LineupState {
  return {
    selection: emptySelection(data.slate),
    data,
    epoch: 0,
    lastRequestId: 0,
    lineup: idleChannel(),
    compare: idleChannel(),
    importReport: null,
  };
}

type ChannelStatus = Pick<ChannelState<unknown>, "pending" | "failure" | "cancelled">;

function patchChannel(state: LineupState, channel: Channel, patch: Partial<ChannelStatus>): LineupState {
  return channel === "lineup"
    ? { ...state, lineup: { ...state.lineup, ...patch } }
    : { ...state, compare: { ...state.compare, ...patch } };
}

function isPending(pending: Pending | null, requestId: number, fingerprint: string) {
  return pending !== null && pending.requestId === requestId && pending.fingerprint === fingerprint;
}

function withSelection(state: LineupState, selection: LineupSelection): LineupState {
  return selection === state.selection ? state : { ...state, selection };
}

/** Unchanged state is returned as the same object, so ignored messages cause no render. */
export function lineupReducer(state: LineupState, action: LineupAction): LineupState {
  switch (action.type) {
    case "toggle-lock":
      return withSelection(state, toggleLock(state.selection, action.id));
    case "toggle-exclude":
      return withSelection(state, toggleExclude(state.selection, action.id));
    case "set-stack":
      return state.selection.stack === action.stack ? state : withSelection(state, { ...state.selection, stack: action.stack });
    case "set-mode":
      return state.selection.mode === action.mode ? state : withSelection(state, { ...state.selection, mode: action.mode });
    case "data":
      return state.data.slate === action.data.slate && state.data.actuals === action.data.actuals ? state : { ...state, data: action.data };
    case "request-start":
      // Ids only move forward; the caller has already stopped whatever was pending.
      if (action.requestId <= state.lastRequestId) return state;
      return {
        ...patchChannel(state, action.channel, {
          pending: { requestId: action.requestId, fingerprint: action.fingerprint },
          failure: null,
          cancelled: null,
        }),
        lastRequestId: action.requestId,
      };
    case "request-result": {
      const { requestId, fingerprint, outcome, elapsedMs } = action;
      if (outcome.kind === "lineup") {
        if (!isPending(state.lineup.pending, requestId, fingerprint)) return state;
        return { ...state, lineup: { pending: null, settled: { requestId, fingerprint, outcome, elapsedMs }, failure: null, cancelled: null } };
      }
      if (!isPending(state.compare.pending, requestId, fingerprint)) return state;
      return { ...state, compare: { pending: null, settled: { requestId, fingerprint, outcome, elapsedMs }, failure: null, cancelled: null } };
    }
    case "request-failure": {
      const { channel, requestId, fingerprint, code, message } = action;
      if (!isPending(state[channel].pending, requestId, fingerprint)) return state;
      return patchChannel(state, channel, { pending: null, failure: { requestId, fingerprint, code, message } });
    }
    case "cancel": {
      const pending = state[action.channel].pending;
      if (!pending || pending.requestId !== action.requestId) return state;
      return patchChannel(state, action.channel, { pending: null, cancelled: pending });
    }
    case "reset":
      return {
        ...state,
        selection: emptySelection(state.data.slate),
        epoch: state.epoch + 1,
        lineup: { ...state.lineup, failure: null, cancelled: null },
        compare: { ...state.compare, failure: null, cancelled: null },
        importReport: null,
      };
    case "import": {
      const parsed = parseSelection(action.raw, state.data.slate);
      if (!parsed.ok) return { ...state, importReport: { source: action.source, applied: false, issues: parsed.issues } };
      return {
        ...state,
        selection: parsed.selection,
        epoch: state.epoch + 1,
        importReport: parsed.warnings.length ? { source: action.source, applied: true, issues: parsed.warnings } : null,
      };
    }
    case "dismiss-import":
      return state.importReport ? { ...state, importReport: null } : state;
  }
}

/** Mode, data or epoch changes recompute on their own; plain selection edits wait for Run. */
export function autoRunKey(state: LineupState): string {
  const { mode } = state.selection;
  return `${state.epoch}|${mode}|${mode === "actual" ? (state.data.actuals ?? "no-actuals") : state.data.slate}`;
}

export type ChannelView<T> = {
  running: boolean;
  current: Settled<T> | null;
  outdated: Settled<T> | null;
  failure: RequestFailure | null;
  cancelled: boolean;
};

export function viewChannel<T>(channel: ChannelState<T>, fingerprint: string | null): ChannelView<T> {
  const current = channel.settled !== null && channel.settled.fingerprint === fingerprint ? channel.settled : null;
  return {
    running: channel.pending !== null,
    current,
    outdated: current ? null : channel.settled,
    failure: channel.failure !== null && channel.failure.fingerprint === fingerprint ? channel.failure : null,
    cancelled: channel.cancelled !== null && channel.cancelled.fingerprint === fingerprint,
  };
}
