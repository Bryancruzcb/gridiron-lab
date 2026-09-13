import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateRoster } from "../../src/lib/football/lineup-validation.ts";
import { optimizeLineup, solveLineup } from "../../src/lib/optimizer.ts";
import { handleWorkerRequest, parseWorkerRequest, parseWorkerResponse, PROTOCOL_VERSION } from "../../src/lib/lineup/worker-protocol.ts";
import type { LineupJob, SolveJob, WorkerResponse } from "../../src/lib/lineup/worker-protocol.ts";
import { realSlate } from "../domain/support/players.ts";
import { seeded } from "../domain/support/prng.ts";
import { randomPool } from "../domain/support/slates.ts";

const solvers = { optimizeLineup, solveLineup };
const slate = realSlate();
const pool = slate.players;

function request(job: SolveJob, requestId = 1, fingerprint = "fp-1") {
  return { type: "solve", protocol: PROTOCOL_VERSION, requestId, fingerprint, job };
}

function lineupJob(patch: Partial<LineupJob> = {}): LineupJob {
  return { kind: "lineup", mode: "proj", players: pool, cap: slate.cap, locked: [], excluded: [], requireStack: false, ...patch };
}

function result(res: WorkerResponse) {
  if (res.type !== "result") assert.fail(`expected result, got ${res.code}: ${res.message}`);
  return res;
}

describe("handleWorkerRequest", () => {
  it("returns exactly what the solver returns in Node for the real slate", () => {
    const res = result(handleWorkerRequest(request(lineupJob()), solvers));
    assert.equal(res.requestId, 1);
    assert.equal(res.fingerprint, "fp-1");
    if (res.outcome.kind !== "lineup") assert.fail("expected a lineup outcome");
    assert.deepEqual(res.outcome.best, optimizeLineup({ players: pool, cap: slate.cap, locked: [], excluded: [], requireStack: false }));
    assert.deepEqual(res.outcome.alternate, solveLineup({ players: pool, cap: slate.cap, locked: [], excluded: [], method: "greedy-value" }));
    const best = res.outcome.best;
    if (best.status !== "ok") assert.fail(best.message);
    assert.deepEqual([best.method, best.optimality, best.lineup.proj.toFixed(2), best.lineup.salary], ["exact-dp", "proven", "146.02", 50000]);
    assert.equal(res.outcome.alternate.status === "ok" && res.outcome.alternate.method, "greedy-value");
  });

  it("keeps the heuristic label and fallback reason for a stacked lineup", () => {
    const res = result(handleWorkerRequest(request(lineupJob({ requireStack: true })), solvers));
    const best = res.outcome.kind === "lineup" ? res.outcome.best : null;
    if (best?.status !== "ok") assert.fail("expected a lineup");
    assert.deepEqual([best.method, best.optimality, best.lineup.proj.toFixed(2)], ["hill-climb", "heuristic", "144.49"]);
    assert.match(best.fallbackReason ?? "", /does not model the QB stack/);
    assert.equal(validateRoster(best.lineup.slots, { cap: slate.cap, requireStack: true }), null);
  });

  it("honours locks and exclusions on the deterministic 300-player fixture like a direct call", () => {
    const players = randomPool(seeded(300), 300, { unit: 100, teams: 12 });
    const locked = [players.find((p) => p.pos === "TE")!.id];
    const excluded = players.filter((p) => p.proj > 25 && !locked.includes(p.id)).map((p) => p.id);
    const res = result(handleWorkerRequest(request(lineupJob({ players, locked, excluded, requireStack: true })), solvers));
    if (res.outcome.kind !== "lineup") assert.fail("expected a lineup outcome");
    assert.deepEqual(res.outcome.best, optimizeLineup({ players, cap: slate.cap, locked, excluded, requireStack: true }));
    const best = res.outcome.best;
    if (best.status !== "ok") assert.fail(best.message);
    assert.equal(validateRoster(best.lineup.slots, { cap: slate.cap, locked, excluded, requireStack: true }), null);
  });

  it("runs the comparison methods and hindsight like direct calls", () => {
    const scored = pool.filter((_, i) => i % 5 !== 0).map((p, i) => ({ ...p, proj: (i % 11) * 2.5 }));
    const res = result(handleWorkerRequest(request({ kind: "compare", players: pool, scored, cap: slate.cap }), solvers));
    if (res.outcome.kind !== "compare") assert.fail("expected a compare outcome");
    assert.deepEqual(res.outcome.exact, solveLineup({ players: pool, cap: slate.cap, method: "exact-dp" }));
    assert.deepEqual(res.outcome.hillClimb, solveLineup({ players: pool, cap: slate.cap, method: "hill-climb" }));
    assert.deepEqual(res.outcome.greedyValue, solveLineup({ players: pool, cap: slate.cap, method: "greedy-value" }));
    assert.deepEqual(res.outcome.hindsight, optimizeLineup({ players: scored, cap: slate.cap }));
  });

  it("returns solver failures as solve results, not protocol errors", () => {
    const qbs = pool.filter((p) => p.pos === "QB").slice(0, 2).map((p) => p.id);
    const res = result(handleWorkerRequest(request(lineupJob({ locked: qbs })), solvers));
    const best = res.outcome.kind === "lineup" ? res.outcome.best : null;
    assert.deepEqual(best && best.status !== "ok" ? [best.status, best.code] : null, ["invalid-input", "incompatible-locks"]);
    const overlap = result(handleWorkerRequest(request(lineupJob({ locked: [qbs[0]!], excluded: [qbs[0]!] })), solvers));
    const o = overlap.outcome.kind === "lineup" ? overlap.outcome.best : null;
    assert.deepEqual(o && o.status !== "ok" ? o.code : null, "lock-exclude-overlap");
    const tiny = result(handleWorkerRequest(request(lineupJob({ cap: 12000 })), solvers));
    const t = tiny.outcome.kind === "lineup" ? tiny.outcome.best : null;
    assert.equal(t?.status, "infeasible");
  });

  it("answers malformed requests with the request id when one is readable", () => {
    const cases: [unknown, number | null, RegExp][] = [
      [null, null, /not an object/],
      [{ ...request(lineupJob()), type: "run" }, 1, /type/],
      [{ ...request(lineupJob()), protocol: 2 }, 1, /protocol/],
      [{ ...request(lineupJob()), requestId: 0 }, null, /requestId/],
      [{ ...request(lineupJob()), fingerprint: "" }, 1, /fingerprint/],
      [request({ ...lineupJob(), players: [{ id: "x" }] } as unknown as SolveJob), 1, /players/],
      [request({ ...lineupJob(), requireStack: "yes" } as unknown as SolveJob), 1, /requireStack/],
      [request({ ...lineupJob(), kind: "stack" } as unknown as SolveJob), 1, /kind/],
      [request({ kind: "compare", players: pool, cap: 50000 } as unknown as SolveJob), 1, /scored/],
    ];
    for (const [raw, id, pattern] of cases) {
      const res = handleWorkerRequest(raw, solvers);
      assert.equal(res.type, "error");
      if (res.type !== "error") continue;
      assert.equal(res.code, "malformed-request");
      assert.equal(res.requestId, id);
      assert.match(res.message, pattern);
    }
  });

  it("reports a thrown solver as solver-threw and measures elapsed time with the given clock", () => {
    const boom = {
      optimizeLineup: () => {
        throw new Error("boom");
      },
      solveLineup,
    };
    const res = handleWorkerRequest(request(lineupJob(), 7, "fp-7"), boom);
    assert.deepEqual(res, { type: "error", protocol: 1, requestId: 7, fingerprint: "fp-7", code: "solver-threw", message: "boom" });
    let t = 100;
    const timed = result(handleWorkerRequest(request(lineupJob()), solvers, () => (t += 12.5)));
    assert.equal(timed.elapsedMs, 12.5);
  });
});

describe("parseWorkerResponse", () => {
  it("accepts handler output after a structured clone, as it crosses the worker boundary", () => {
    const res = handleWorkerRequest(request(lineupJob({ requireStack: true })), solvers);
    const parsed = parseWorkerResponse(structuredClone(res));
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.response, res);
    assert.ok(parseWorkerResponse(handleWorkerRequest(null, solvers)).ok);
    assert.ok(parseWorkerRequest(structuredClone(request(lineupJob()))).ok);
  });

  it("rejects replies that would render something illegal or unlabelled", () => {
    const good = result(handleWorkerRequest(request(lineupJob()), solvers));
    const best = good.outcome.kind === "lineup" && good.outcome.best.status === "ok" ? good.outcome.best : null;
    assert.ok(best);
    const withBest = (patch: object) => ({ ...good, outcome: { ...good.outcome, best: { ...best, ...patch } } });
    const bad: [string, unknown][] = [
      ["no protocol", { ...good, protocol: undefined }],
      ["unknown type", { ...good, type: "done" }],
      ["no request id", { ...good, requestId: null }],
      ["NaN elapsed", { ...good, elapsedMs: Number.NaN }],
      ["unknown kind", { ...good, outcome: { ...good.outcome, kind: "other" } }],
      ["eight players", withBest({ lineup: { ...best.lineup, slots: best.lineup.slots.slice(1), players: best.lineup.players.slice(1) } })],
      ["slot order", withBest({ lineup: { ...best.lineup, slots: best.lineup.slots.slice().reverse() } })],
      ["no optimality", withBest({ optimality: undefined })],
      ["unknown method", withBest({ method: "magic" })],
      ["failure without code", withBest({ status: "infeasible", code: undefined, message: "x" })],
      ["error code", { type: "error", protocol: 1, requestId: 1, fingerprint: "f", code: "oops", message: "m" }],
    ];
    for (const [label, raw] of bad) assert.equal(parseWorkerResponse(raw).ok, false, label);
  });
});
