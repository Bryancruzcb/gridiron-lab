import type { FantasyPlayer } from "@/data/types";
import type { optimizeLineup, SolveResult, solveLineup } from "../optimizer.ts";
import type { LineupMode } from "./selection.ts";

// Messages between the lineup page and the optimizer worker. Everything is plain structured-clone
// data; both directions are validated on arrival because a worker boundary is untyped at runtime.

export const PROTOCOL_VERSION = 1;

export type LineupJob = {
  kind: "lineup";
  mode: LineupMode;
  /** The pool actually solved: projections, or actual points in hindsight mode. */
  players: FantasyPlayer[];
  cap: number;
  locked: string[];
  excluded: string[];
  requireStack: boolean;
};

/** Whole-slate method comparison: three methods on projections plus hindsight on actual points. */
export type CompareJob = { kind: "compare"; players: FantasyPlayer[]; scored: FantasyPlayer[]; cap: number };

export type SolveJob = LineupJob | CompareJob;

export type WorkerRequest = { type: "solve"; protocol: 1; requestId: number; fingerprint: string; job: SolveJob };

export type LineupOutcome = { kind: "lineup"; mode: LineupMode; best: SolveResult; alternate: SolveResult };

export type CompareOutcome = {
  kind: "compare";
  exact: SolveResult;
  hillClimb: SolveResult;
  greedyValue: SolveResult;
  hindsight: SolveResult;
};

export type SolveOutcome = LineupOutcome | CompareOutcome;

export type WorkerErrorCode = "malformed-request" | "solver-threw";

export type WorkerResponse =
  | { type: "result"; protocol: 1; requestId: number; fingerprint: string; elapsedMs: number; outcome: SolveOutcome }
  | { type: "error"; protocol: 1; requestId: number | null; fingerprint: string | null; code: WorkerErrorCode; message: string };

export type Solvers = { optimizeLineup: typeof optimizeLineup; solveLineup: typeof solveLineup };

const POSITIONS = new Set(["QB", "RB", "WR", "TE", "DST"]);
const METHODS = new Set(["exact-dp", "hill-climb", "greedy-proj", "greedy-value"]);
const FAILURE_STATUSES = new Set(["invalid-input", "infeasible", "error"]);
const SLOTS = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST"];
const MAX_POOL = 5000;
const MAX_IDS = 1000;

type Rec = Record<string, unknown>;

function isRecord(x: unknown): x is Rec {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isRequestId(x: unknown): x is number {
  return Number.isSafeInteger(x) && (x as number) > 0;
}

function isFingerprint(x: unknown): x is string {
  return typeof x === "string" && x.length > 0 && x.length <= 200;
}

/** Structure only: value rules (finite projections, salary grid, ...) belong to the solver's validator. */
function isPlayer(x: unknown): x is FantasyPlayer {
  return (
    isRecord(x) &&
    typeof x.id === "string" &&
    typeof x.name === "string" &&
    typeof x.pos === "string" &&
    POSITIONS.has(x.pos) &&
    typeof x.team === "string" &&
    typeof x.salary === "number" &&
    typeof x.proj === "number"
  );
}

function isPool(x: unknown): x is FantasyPlayer[] {
  return Array.isArray(x) && x.length <= MAX_POOL && x.every(isPlayer);
}

function isIdList(x: unknown): x is string[] {
  return Array.isArray(x) && x.length <= MAX_IDS && x.every((id) => typeof id === "string");
}

function jobProblem(job: unknown): string | null {
  if (!isRecord(job)) return "job is missing";
  if (typeof job.cap !== "number") return "job.cap must be a number";
  if (!isPool(job.players)) return "job.players must be a list of players";
  if (job.kind === "lineup") {
    if (job.mode !== "proj" && job.mode !== "actual") return "job.mode must be proj or actual";
    if (!isIdList(job.locked) || !isIdList(job.excluded)) return "job.locked and job.excluded must be id lists";
    if (typeof job.requireStack !== "boolean") return "job.requireStack must be a boolean";
    return null;
  }
  if (job.kind === "compare") return isPool(job.scored) ? null : "job.scored must be a list of players";
  return "job.kind must be lineup or compare";
}

export type RequestParse =
  | { ok: true; request: WorkerRequest }
  | { ok: false; requestId: number | null; fingerprint: string | null; message: string };

export function parseWorkerRequest(data: unknown): RequestParse {
  const requestId = isRecord(data) && isRequestId(data.requestId) ? data.requestId : null;
  const fingerprint = isRecord(data) && isFingerprint(data.fingerprint) ? data.fingerprint : null;
  const bad = (message: string): RequestParse => ({ ok: false, requestId, fingerprint, message });
  if (!isRecord(data)) return bad("request is not an object");
  if (data.type !== "solve") return bad("request.type must be solve");
  if (data.protocol !== PROTOCOL_VERSION) return bad(`request.protocol must be ${PROTOCOL_VERSION}`);
  if (requestId === null) return bad("request.requestId must be a positive integer");
  if (fingerprint === null) return bad("request.fingerprint must be a non-empty string");
  const problem = jobProblem(data.job);
  if (problem) return bad(problem);
  return { ok: true, request: data as WorkerRequest };
}

function runJob(job: SolveJob, solvers: Solvers): SolveOutcome {
  if (job.kind === "lineup") {
    const rules = { players: job.players, cap: job.cap, locked: job.locked, excluded: job.excluded, requireStack: job.requireStack };
    return {
      kind: "lineup",
      mode: job.mode,
      best: solvers.optimizeLineup(rules),
      alternate: solvers.solveLineup({ ...rules, method: "greedy-value" }),
    };
  }
  const base = { players: job.players, cap: job.cap };
  return {
    kind: "compare",
    exact: solvers.solveLineup({ ...base, method: "exact-dp" }),
    hillClimb: solvers.solveLineup({ ...base, method: "hill-climb" }),
    greedyValue: solvers.solveLineup({ ...base, method: "greedy-value" }),
    hindsight: solvers.optimizeLineup({ players: job.scored, cap: job.cap }),
  };
}

/**
 * The worker's whole job, kept pure so Node tests run the same path. Solver failures stay
 * SolveResults; only a malformed request or a thrown exception becomes a protocol error.
 */
export function handleWorkerRequest(data: unknown, solvers: Solvers, clock: () => number = () => performance.now()): WorkerResponse {
  const parsed = parseWorkerRequest(data);
  if (!parsed.ok)
    return {
      type: "error",
      protocol: PROTOCOL_VERSION,
      requestId: parsed.requestId,
      fingerprint: parsed.fingerprint,
      code: "malformed-request",
      message: parsed.message,
    };
  const { requestId, fingerprint, job } = parsed.request;
  const started = clock();
  try {
    const outcome = runJob(job, solvers);
    return { type: "result", protocol: PROTOCOL_VERSION, requestId, fingerprint, elapsedMs: Math.max(0, clock() - started), outcome };
  } catch (err) {
    return {
      type: "error",
      protocol: PROTOCOL_VERSION,
      requestId,
      fingerprint,
      code: "solver-threw",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function isSolveResult(x: unknown): x is SolveResult {
  if (!isRecord(x)) return false;
  if (x.status === "ok") {
    const lineup = x.lineup;
    return (
      typeof x.method === "string" &&
      METHODS.has(x.method) &&
      (x.optimality === "proven" || x.optimality === "heuristic") &&
      (x.fallbackReason === undefined || typeof x.fallbackReason === "string") &&
      isRecord(lineup) &&
      Array.isArray(lineup.slots) &&
      lineup.slots.length === SLOTS.length &&
      lineup.slots.every((s, i) => isRecord(s) && s.slot === SLOTS[i] && isPlayer(s.player)) &&
      Array.isArray(lineup.players) &&
      lineup.players.length === SLOTS.length &&
      lineup.players.every(isPlayer) &&
      typeof lineup.salary === "number" &&
      typeof lineup.proj === "number" &&
      typeof lineup.remaining === "number"
    );
  }
  return typeof x.status === "string" && FAILURE_STATUSES.has(x.status) && typeof x.code === "string" && typeof x.message === "string";
}

function outcomeProblem(x: unknown): string | null {
  if (!isRecord(x)) return "outcome is missing";
  if (x.kind === "lineup") {
    if (x.mode !== "proj" && x.mode !== "actual") return "outcome.mode is invalid";
    return isSolveResult(x.best) && isSolveResult(x.alternate) ? null : "lineup outcome has an invalid solve result";
  }
  if (x.kind === "compare")
    return [x.exact, x.hillClimb, x.greedyValue, x.hindsight].every(isSolveResult) ? null : "compare outcome has an invalid solve result";
  return "outcome.kind is invalid";
}

export type ResponseParse = { ok: true; response: WorkerResponse } | { ok: false; message: string };

export function parseWorkerResponse(data: unknown): ResponseParse {
  if (!isRecord(data)) return { ok: false, message: "reply is not an object" };
  if (data.protocol !== PROTOCOL_VERSION) return { ok: false, message: `reply.protocol must be ${PROTOCOL_VERSION}` };
  if (data.type === "result") {
    if (!isRequestId(data.requestId) || !isFingerprint(data.fingerprint)) return { ok: false, message: "reply is missing its request id or fingerprint" };
    if (typeof data.elapsedMs !== "number" || !Number.isFinite(data.elapsedMs)) return { ok: false, message: "reply.elapsedMs must be a number" };
    const problem = outcomeProblem(data.outcome);
    return problem ? { ok: false, message: problem } : { ok: true, response: data as WorkerResponse };
  }
  if (data.type === "error") {
    const idOk = data.requestId === null || isRequestId(data.requestId);
    const fpOk = data.fingerprint === null || isFingerprint(data.fingerprint);
    const codeOk = data.code === "malformed-request" || data.code === "solver-threw";
    if (!idOk || !fpOk || !codeOk || typeof data.message !== "string") return { ok: false, message: "error reply is malformed" };
    return { ok: true, response: data as WorkerResponse };
  }
  return { ok: false, message: "reply.type must be result or error" };
}
