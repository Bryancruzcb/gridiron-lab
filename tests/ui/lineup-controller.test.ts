import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateRoster } from "../../src/lib/football/lineup-validation.ts";
import { optimizeLineup, solveLineup } from "../../src/lib/optimizer.ts";
import {
  actualsVersion,
  autoRunKey,
  emptySelection,
  initialLineupState,
  lineupReducer,
  planLineup,
  slateId,
  viewChannel,
} from "../../src/lib/lineup/selection.ts";
import type { LineupAction, LineupData, LineupPlan, LineupState } from "../../src/lib/lineup/selection.ts";
import { handleWorkerRequest, PROTOCOL_VERSION } from "../../src/lib/lineup/worker-protocol.ts";
import type { SolveJob } from "../../src/lib/lineup/worker-protocol.ts";
import { realSlate } from "../domain/support/players.ts";

// Acceptance cases for constraint preservation, driven through the reducer, the request planner
// and the same handler the worker runs.

const solvers = { optimizeLineup, solveLineup };
const slate = realSlate();
const pool = slate.players;
const SLATE = slateId(slate.season, pool, slate.cap);

function actualsFor(offset: number, missing: string[] = []) {
  return new Map(pool.filter((p) => !missing.includes(p.id)).map((p, i) => [p.id, Math.round(p.proj * (0.4 + ((i + offset) % 9) / 6) * 10) / 10]));
}

function dataOf(actuals: Map<string, number> | null): LineupData {
  return { players: pool, cap: slate.cap, actuals };
}

function reduce(state: LineupState, ...actions: LineupAction[]) {
  return actions.reduce(lineupReducer, state);
}

function fresh(actuals: Map<string, number> | null = null) {
  return initialLineupState({ slate: SLATE, actuals: actualsVersion(actuals) });
}

function okPlan(plan: LineupPlan) {
  if (!plan.ok) assert.fail(`plan blocked: ${plan.issues.map((i) => i.message).join("; ")}`);
  return plan;
}

/** What the worker would answer for this request. */
function reply(requestId: number, fingerprint: string, job: SolveJob): LineupAction {
  const res = handleWorkerRequest({ type: "solve", protocol: PROTOCOL_VERSION, requestId, fingerprint, job }, solvers);
  if (res.type !== "result") assert.fail(res.message);
  return { type: "request-result", requestId, fingerprint, outcome: res.outcome, elapsedMs: res.elapsedMs };
}

function run(state: LineupState, plan: LineupPlan, requestId: number) {
  const p = okPlan(plan);
  return reduce(state, { type: "request-start", channel: "lineup", requestId, fingerprint: p.fingerprint }, reply(requestId, p.fingerprint, p.job));
}

function shownLineup(state: LineupState, data: LineupData) {
  const view = viewChannel(state.lineup, planLineup(state.selection, data).fingerprint);
  const best = view.current?.outcome.best;
  return { view, lineup: best?.status === "ok" ? best.lineup : null, best };
}

// A QB with a WR/TE teammate, the top projected WR on another team, and a TE to lock later.
const qb = pool.filter((p) => p.pos === "QB").sort((a, b) => a.salary - b.salary).find((q) => pool.some((p) => p.team === q.team && (p.pos === "WR" || p.pos === "TE")))!;
const topWr = pool.filter((p) => p.pos === "WR" && p.team !== qb.team).sort((a, b) => b.proj - a.proj)[0]!;
const te = pool.find((p) => p.pos === "TE" && p.team !== qb.team)!;

describe("lineup controller acceptance", () => {
  it("1. lock a QB, exclude a WR, require a stack, run: every constraint is in the result", () => {
    const data = dataOf(null);
    let state = reduce(fresh(), { type: "toggle-lock", id: qb.id }, { type: "toggle-exclude", id: topWr.id }, { type: "set-stack", stack: true });
    state = run(state, planLineup(state.selection, data), 1);
    const { view, lineup, best } = shownLineup(state, data);
    assert.ok(view.current && lineup && best?.status === "ok");
    const ids = lineup.players.map((p) => p.id);
    assert.ok(ids.includes(qb.id));
    assert.ok(!ids.includes(topWr.id));
    assert.equal(validateRoster(lineup.slots, { cap: slate.cap, locked: [qb.id], excluded: [topWr.id], requireStack: true }), null);
    assert.deepEqual(best, optimizeLineup({ players: pool, cap: slate.cap, locked: [qb.id], excluded: [topWr.id], requireStack: true }));
  });

  it("2. switching to hindsight keeps the controls, recomputes, and reports an unscored lock by id", () => {
    const actuals = actualsFor(0, [te.id]);
    const data = dataOf(actuals);
    let state = reduce(fresh(actuals), { type: "toggle-lock", id: qb.id }, { type: "set-stack", stack: true });
    state = run(state, planLineup(state.selection, data), 1);
    const before = state.selection;
    const key = autoRunKey(state);

    state = reduce(state, { type: "set-mode", mode: "actual" });
    assert.deepEqual({ ...state.selection, mode: "proj" }, before);
    assert.notEqual(autoRunKey(state), key, "a mode change must trigger a recompute");
    const hindsight = okPlan(planLineup(state.selection, data));
    assert.deepEqual([hindsight.job.mode, hindsight.job.locked, hindsight.job.requireStack], ["actual", [qb.id], true]);
    assert.equal(shownLineup(state, data).view.current, null, "the projection lineup is no longer current");
    assert.equal(viewChannel(state.lineup, hindsight.fingerprint).outdated?.outcome.mode, "proj");

    state = run(state, hindsight, 2);
    const shown = shownLineup(state, data);
    assert.ok(shown.lineup?.players.some((p) => p.id === qb.id));
    assert.equal(shown.view.current?.outcome.mode, "actual");

    state = reduce(state, { type: "toggle-lock", id: te.id });
    const blocked = planLineup(state.selection, data);
    assert.ok(!blocked.ok);
    assert.deepEqual(blocked.issues.map((i) => [i.code, i.ids]), [["lock-unscored", [te.id]]]);
    assert.deepEqual(state.selection.locked, [qb.id, te.id].sort(), "the unavailable lock stays selected");
  });

  it("3. refreshed scores during a solve: only the newest configuration and data result lands", () => {
    const first = actualsFor(0);
    const refreshed = actualsFor(3);
    let state = reduce(fresh(first), { type: "set-mode", mode: "actual" }, { type: "toggle-lock", id: qb.id });
    const planA = okPlan(planLineup(state.selection, dataOf(first)));
    state = reduce(state, { type: "request-start", channel: "lineup", requestId: 1, fingerprint: planA.fingerprint });

    state = reduce(state, { type: "data", data: { slate: SLATE, actuals: actualsVersion(refreshed) } });
    const planB = okPlan(planLineup(state.selection, dataOf(refreshed)));
    assert.notEqual(planB.fingerprint, planA.fingerprint);
    state = reduce(state, { type: "request-start", channel: "lineup", requestId: 2, fingerprint: planB.fingerprint });

    const late = reply(1, planA.fingerprint, planA.job);
    assert.equal(lineupReducer(state, late), state, "request A's late result is ignored");
    const mislabelled = reply(2, planA.fingerprint, planA.job);
    assert.equal(lineupReducer(state, mislabelled), state, "a matching id with the wrong fingerprint is ignored");
    assert.equal(reduce(state, { type: "request-start", channel: "lineup", requestId: 1, fingerprint: planA.fingerprint }), state, "ids never move back");

    state = reduce(state, reply(2, planB.fingerprint, planB.job));
    const view = viewChannel(state.lineup, planB.fingerprint);
    assert.equal(view.current?.requestId, 2);
    assert.equal(lineupReducer(state, late), state);
  });

  it("4. changing a lock and restoring it gives back the same current result with no duplicates", () => {
    const data = dataOf(null);
    let state = reduce(fresh(), { type: "toggle-lock", id: qb.id }, { type: "toggle-exclude", id: topWr.id });
    state = run(state, planLineup(state.selection, data), 1);
    const selection = state.selection;
    const settled = state.lineup.settled;

    state = reduce(state, { type: "toggle-lock", id: te.id });
    assert.equal(shownLineup(state, data).view.current, null, "a plain edit marks the result as needing a rerun");
    assert.ok(viewChannel(state.lineup, planLineup(state.selection, data).fingerprint).outdated);
    state = reduce(state, { type: "toggle-exclude", id: te.id }, { type: "toggle-lock", id: topWr.id }, { type: "toggle-exclude", id: topWr.id }, { type: "toggle-exclude", id: te.id });

    assert.deepEqual(state.selection, selection);
    assert.equal(new Set(state.selection.locked).size, state.selection.locked.length);
    assert.ok(state.selection.locked.every((id) => !state.selection.excluded.includes(id)));
    assert.equal(shownLineup(state, data).view.current, settled, "restoring the setup makes the same result current again");
  });

  it("5. invalid shared constraints are reported and nothing illegal is applied or solved", () => {
    const data = dataOf(null);
    let state = run(fresh(), planLineup(emptySelection(SLATE), data), 1);
    const key = autoRunKey(state);
    const before = state;
    state = reduce(state, { type: "import", source: "link", raw: { version: 1, slate: SLATE, mode: "proj", locked: [qb.id], excluded: [qb.id], stack: false } });
    assert.equal(state.importReport?.applied, false);
    assert.deepEqual(state.importReport?.issues.map((i) => [i.code, i.ids]), [["lock-exclude-overlap", [qb.id]]]);
    assert.equal(state.selection, before.selection);
    assert.equal(autoRunKey(state), key, "a rejected import does not recompute");
    assert.ok(shownLineup(state, data).view.current, "the legal lineup for the unchanged setup stays current");
    const direct = handleWorkerRequest(
      {
        type: "solve",
        protocol: 1,
        requestId: 9,
        fingerprint: "x",
        job: { kind: "lineup", mode: "proj", players: pool, cap: slate.cap, locked: [qb.id], excluded: [qb.id], requireStack: false },
      },
      solvers,
    );
    assert.ok(direct.type === "result" && direct.outcome.kind === "lineup" && direct.outcome.best.status === "invalid-input");
    state = reduce(state, { type: "dismiss-import" });
    assert.equal(state.importReport, null);
  });

  it("6. reset clears controls, failures and notices together and recomputes", () => {
    const actuals = actualsFor(1);
    const data = dataOf(actuals);
    let state = reduce(fresh(actuals), { type: "toggle-lock", id: qb.id }, { type: "set-stack", stack: true }, { type: "set-mode", mode: "actual" });
    state = run(state, planLineup(state.selection, data), 1);
    const plan = okPlan(planLineup(state.selection, data));
    state = reduce(
      state,
      { type: "request-start", channel: "lineup", requestId: 2, fingerprint: plan.fingerprint },
      { type: "request-failure", channel: "lineup", requestId: 2, fingerprint: plan.fingerprint, code: "worker-crashed", message: "gone" },
      { type: "import", source: "link", raw: { version: 1, slate: SLATE, mode: "proj", locked: ["a"], excluded: ["a"], stack: false } },
    );
    assert.ok(viewChannel(state.lineup, plan.fingerprint).failure);
    const key = autoRunKey(state);

    state = reduce(state, { type: "reset" });
    assert.deepEqual(state.selection, emptySelection(SLATE));
    assert.equal(state.importReport, null);
    assert.equal(state.lineup.failure, null);
    assert.notEqual(autoRunKey(state), key);
    const after = planLineup(state.selection, data);
    const view = viewChannel(state.lineup, after.fingerprint);
    assert.equal(view.current, null, "the constrained result is not shown as current after reset");
    assert.equal(view.failure, null);
  });

  it("7. re-entering the route restores the in-memory selection with the same fingerprint", () => {
    const data = dataOf(null);
    const left = reduce(fresh(), { type: "toggle-lock", id: qb.id }, { type: "toggle-exclude", id: topWr.id }, { type: "set-stack", stack: true });
    const remembered = structuredClone(left.selection);
    const reentered = reduce(fresh(), { type: "import", source: "memory", raw: remembered });
    assert.deepEqual(reentered.selection, left.selection);
    assert.equal(reentered.importReport, null);
    assert.equal(planLineup(reentered.selection, data).fingerprint, planLineup(left.selection, data).fingerprint);
    assert.notEqual(autoRunKey(reentered), autoRunKey(fresh()), "a restored selection recomputes on mount");
  });
});

describe("request lifecycle", () => {
  const data = dataOf(null);
  const plan = okPlan(planLineup(emptySelection(SLATE), data));

  it("cancel stops the matching request, and its late result cannot land", () => {
    let state = reduce(fresh(), { type: "request-start", channel: "lineup", requestId: 4, fingerprint: plan.fingerprint });
    assert.equal(reduce(state, { type: "cancel", channel: "lineup", requestId: 3 }), state, "cancelling an older id is a no-op");
    state = reduce(state, { type: "cancel", channel: "lineup", requestId: 4 });
    const view = viewChannel(state.lineup, plan.fingerprint);
    assert.deepEqual([view.running, view.cancelled, view.current], [false, true, null]);
    assert.equal(lineupReducer(state, reply(4, plan.fingerprint, plan.job)), state);
  });

  it("failures only land for the pending request and are scoped to its fingerprint", () => {
    let state = reduce(fresh(), { type: "request-start", channel: "lineup", requestId: 1, fingerprint: plan.fingerprint });
    const stale: LineupAction = { type: "request-failure", channel: "lineup", requestId: 0, fingerprint: plan.fingerprint, code: "worker-crashed", message: "x" };
    assert.equal(lineupReducer(state, stale), state);
    state = reduce(state, { ...stale, requestId: 1 });
    assert.equal(viewChannel(state.lineup, plan.fingerprint).failure?.code, "worker-crashed");
    assert.equal(viewChannel(state.lineup, "another").failure, null);
    state = reduce(state, { type: "request-start", channel: "lineup", requestId: 2, fingerprint: plan.fingerprint });
    assert.equal(state.lineup.failure, null, "a new attempt clears the old failure");
  });

  it("channels are independent and results must match their channel's pending request", () => {
    const actuals = actualsFor(2);
    let state = reduce(fresh(actuals), { type: "request-start", channel: "compare", requestId: 1, fingerprint: "cmp" });
    const lineupReply = reply(1, "cmp", plan.job);
    assert.equal(lineupReducer(state, lineupReply), state, "a lineup outcome cannot settle the compare channel");
    state = reduce(state, { type: "request-start", channel: "lineup", requestId: 2, fingerprint: plan.fingerprint }, reply(2, plan.fingerprint, plan.job));
    assert.equal(state.compare.pending?.requestId, 1);
    assert.equal(state.lineup.settled?.requestId, 2);
  });

  it("no-op actions keep the same state object", () => {
    const state = fresh();
    assert.equal(lineupReducer(state, { type: "set-stack", stack: false }), state);
    assert.equal(lineupReducer(state, { type: "set-mode", mode: "proj" }), state);
    assert.equal(lineupReducer(state, { type: "data", data: { slate: SLATE, actuals: null } }), state);
    assert.equal(lineupReducer(state, { type: "dismiss-import" }), state);
  });
});
