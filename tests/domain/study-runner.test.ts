import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StudyRunArtifact, StudyWeekRecord } from "../../src/data/types.ts";
import { solveLineup, type SolveRequest, type SolveResult } from "../../src/lib/optimizer.ts";
import { RULESET_REF } from "../../src/lib/football/scoring.ts";
import { LEGACY_SCORING_REF } from "../../scripts/lib/study/legacy-scoring.ts";
import { MODEL_PRESETS } from "../../scripts/lib/study/models.ts";
import { serializeArtifact, verifyRunArtifact } from "../../scripts/lib/study/report.ts";
import { bootstrapMeanInterval } from "../../scripts/lib/study/stats.ts";
import { dropRows, encode, runFixture, seasonTexts } from "../fixtures/football/study-fixture.ts";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const fold = (x: number) => (x === 0 ? 0 : x);
const r = (x: number, d: number) => fold(Math.round(x * 10 ** d) / 10 ** d);

describe("run identity", () => {
  it("two runs with identical inputs and configuration are byte-identical", () => {
    const a = runFixture();
    const b = runFixture();
    assert.equal(serializeArtifact(a), serializeArtifact(b));
    assert.match(a.runId, /^run-[0-9a-f]{16}$/);
    assert.match(a.resultSha256, /^[0-9a-f]{64}$/);
    verifyRunArtifact(a);
  });

  it("a one-byte source change changes the input hash and the run id", () => {
    const texts = seasonTexts(2041);
    const changed = { ...texts, playerWeek: texts.playerWeek.replace("AAA.QB", "AAA.QC") };
    assert.equal(encode(changed.playerWeek).byteLength, encode(texts.playerWeek).byteLength);
    const a = runFixture();
    const b = runFixture({ texts: changed });
    const sha = (x: StudyRunArtifact, id: string) => x.run.inputs.find((i) => i.id === id)!.sha256;
    assert.notEqual(sha(b, "stats_player_week_2041"), sha(a, "stats_player_week_2041"));
    assert.equal(sha(b, "nfldata_games"), sha(a, "nfldata_games"));
    assert.notEqual(b.runId, a.runId);
    assert.notEqual(b.resultSha256, a.resultSha256);
    // player_name is not read, so only the identity moved.
    assert.deepEqual(b.summary, a.summary);
  });

  it("configuration changes move the run id and the legacy scoring variant is labelled", () => {
    const base = runFixture();
    assert.equal(base.run.scoring.ref, RULESET_REF);
    assert.equal(base.run.scoring.legacyAttributionOnly, false);
    assert.notEqual(runFixture({ config: { uncertainty: { resamples: 500, seed: 8, level: 0.95 } } }).runId, base.runId);
    assert.notEqual(runFixture({ config: { models: MODEL_PRESETS.projections!() } }).runId, base.runId);
    const legacy = runFixture({ config: { scoring: LEGACY_SCORING_REF } });
    assert.notEqual(legacy.runId, base.runId);
    assert.equal(legacy.run.scoring.legacyAttributionOnly, true);
  });
});

describe("common weeks", () => {
  it("compares every model on one documented week set with exclusions recorded", () => {
    const a = runFixture();
    assert.deepEqual(a.summary.commonWeeks, [2, 3, 4].map((week) => ({ season: 2041, week })));
    assert.deepEqual(
      a.summary.excludedWeeks.map((w) => [w.week, [...new Set(w.exclusions.map((e) => e.reason))]]),
      [
        [1, ["empty-slate"]],
        [5, ["lineup-actual-incomplete"]],
      ],
    );
    for (const m of a.summary.models) assert.equal(m.weeks, 3);
    const w5 = a.weeks.find((w) => w.week === 5)!;
    assert.deepEqual(w5.exclusions.map((e) => e.model), a.run.models.map((m) => m.id));
    assert.ok(w5.models.every((m) => m.solver.status === "ok" && m.lineup!.actual === null && m.lineup!.missing.length === 9));
  });

  it("records a strict solver failure as an invalid week, with no fallback call", () => {
    const calls: string[] = [];
    let week3Calls = 0;
    const solve = (req: SolveRequest): SolveResult => {
      calls.push(req.method);
      const week3 = req.players.every((p) => p.team === "CCC" || p.team === "DDD");
      if (week3 && week3Calls++ === 1) return { status: "error", code: "reconstruction-failed", message: "stub failure" };
      return solveLineup(req);
    };
    const run = runFixture({ solve });
    const w3 = run.weeks.find((w) => w.week === 3)!;
    const last1 = w3.models.find((m) => m.model === "last1")!;
    assert.deepEqual(last1.solver, {
      requested: "exact-dp",
      used: null,
      status: "error",
      code: "reconstruction-failed",
      optimality: null,
      message: "stub failure",
    });
    assert.equal(last1.lineup, null);
    assert.equal(w3.comparable, false);
    assert.deepEqual(w3.exclusions, [{ reason: "solver-failed", model: "last1", detail: "exact-dp: error/reconstruction-failed" }]);
    assert.deepEqual(run.summary.commonWeeks.map((w) => w.week), [2, 4]);
    for (const m of run.summary.models) assert.equal(m.weeks, 2);
    assert.equal(run.summary.models.find((m) => m.model === "last1")!.validWeeks, 2);
    assert.equal(run.summary.models.find((m) => m.model === "trail")!.validWeeks, 3);
    assert.deepEqual(calls, [2, 3, 4, 5].flatMap(() => run.run.models.map((m) => m.solver)));
    verifyRunArtifact(run);
  });

  it("rejects an ok result from a different method", () => {
    const solve = (req: SolveRequest) => solveLineup({ ...req, method: "hill-climb" });
    const run = runFixture({ solve, config: { models: MODEL_PRESETS.backtest!(), weeks: { from: 2, to: 2 } } });
    const trail = run.weeks[0]!.models[0]!;
    assert.deepEqual([trail.solver.status, trail.solver.code, trail.solver.requested, trail.solver.used], ["error", "method-mismatch", "exact-dp", "hill-climb"]);
    assert.equal(trail.lineup, null);
    assert.deepEqual(run.summary.commonWeeks, []);
  });

  it("keeps missing defense actuals missing and excludes lineups that need them", () => {
    const texts = seasonTexts(2041);
    const teamWeek = dropRows(texts.teamWeek, (c) => c.week === "2" && c.team === "DDD");
    const run = runFixture({ texts: { ...texts, teamWeek }, config: { weeks: { from: 2, to: 2 } } });
    const w = run.weeks[0]!;
    const entry = (id: string) => w.slate.find((s) => s.id === id)!;
    assert.deepEqual([entry("DST-BBB").status, entry("DST-BBB").points], ["missing-source", null]);
    assert.match(entry("DST-BBB").note!, /score missing: sacks, interceptions, fumbleRecoveries/);
    assert.deepEqual([entry("DST-DDD").status, entry("DST-DDD").note], ["missing-source", "no team-week row for a final game"]);
    const needing = w.models.filter((m) => m.lineup?.slots.some((s) => s.id === "DST-BBB" || s.id === "DST-DDD"));
    assert.ok(needing.length > 0);
    for (const m of needing) {
      assert.equal(m.lineup!.actual, null);
      assert.ok(w.exclusions.some((e) => e.model === m.model && e.reason === "lineup-actual-incomplete"));
    }
    assert.equal(w.comparable, false);
  });
});

describe("summaries", () => {
  const run = runFixture();
  const common = run.weeks.filter((w) => w.comparable);
  const lineup = (w: StudyWeekRecord, id: string) => w.models.find((m) => m.model === id)!.lineup!;

  it("recompute from the stored per-week records", () => {
    for (const m of run.run.models) {
      const s = run.summary.models.find((x) => x.model === m.id)!;
      const actuals = common.map((w) => lineup(w, m.id).actual!);
      const sorted = [...actuals].sort((a, b) => a - b);
      const mid = (sorted.length - 1) / 2;
      assert.equal(s.weeks, common.length);
      assert.equal(s.lineupActualMean, r(sum(actuals) / actuals.length, 3));
      assert.equal(s.lineupActualMedian, r((sorted[Math.floor(mid)]! + sorted[Math.ceil(mid)]!) / 2, 3));
      assert.equal(s.lineupProjMean, r(sum(common.map((w) => lineup(w, m.id).proj)) / common.length, 3));
      const errors = common.flatMap((w) => {
        const mw = w.models.find((x) => x.model === m.id)!;
        return w.slate.flatMap((p, i) => (p.status === "played" ? [mw.projections[i]! - p.points!] : []));
      });
      assert.equal(s.playerError.n, errors.length);
      assert.equal(s.playerError.mae, r(sum(errors.map(Math.abs)) / errors.length, 3));
      assert.equal(s.playerError.rmse, r(Math.sqrt(sum(errors.map((e) => e * e)) / errors.length), 3));
      assert.equal(s.playerError.bias, r(sum(errors) / errors.length, 3));
      for (const w of common) {
        const l = lineup(w, m.id);
        assert.equal(l.salary, sum(l.slots.map((x) => x.salary)));
        assert.ok(l.salary <= run.run.solver.cap);
        assert.equal(l.proj, r(sum(l.slots.map((x) => x.proj)), 4));
        assert.equal(l.actual, r(sum(l.slots.map((x) => x.points ?? 0)), 2));
        for (const slot of l.slots) {
          const i = w.slate.findIndex((p) => p.id === slot.id);
          assert.deepEqual([slot.proj, slot.points, slot.salary], [w.models.find((x) => x.model === m.id)!.projections[i], w.slate[i]!.points, w.slate[i]!.salary]);
        }
      }
    }
    for (const p of run.summary.paired) {
      const diffs = common.map((w) => r(lineup(w, p.model).actual! - lineup(w, p.baseline).actual!, 2));
      assert.equal(p.n, diffs.length);
      assert.equal(p.meanDiff, r(sum(diffs) / diffs.length, 3));
      assert.deepEqual([p.wins, p.losses, p.ties], [diffs.filter((d) => d > 0).length, diffs.filter((d) => d < 0).length, diffs.filter((d) => d === 0).length]);
      const interval = bootstrapMeanInterval(diffs, run.run.uncertainty)!;
      assert.deepEqual(p.interval, { level: 0.95, low: r(interval.low, 3), high: r(interval.high, 3) });
    }
  });

  it("detect a stored record that no longer matches its summary", () => {
    const tampered = structuredClone(run);
    lineup(tampered.weeks.find((w) => w.week === 3)!, "trail").actual! += 1;
    assert.throws(() => verifyRunArtifact(tampered), /resultSha256 does not match/);
    const resealed = { ...tampered, resultSha256: "" };
    const { resultSha256: _drop, ...body } = resealed;
    assert.throws(() => verifyRunArtifact({ ...body, resultSha256: runFixture().resultSha256 }), /does not match/);
  });

  it("bootstraps over weeks with a fixed seed", () => {
    const diffs = [3, -1, 4, 1, -5, 9];
    const opts = { resamples: 1000, seed: 42, level: 0.9 };
    const a = bootstrapMeanInterval(diffs, opts)!;
    assert.deepEqual(bootstrapMeanInterval(diffs, opts), a);
    assert.notDeepEqual(bootstrapMeanInterval(diffs, { ...opts, seed: 43 }), a);
    assert.ok(a.low >= -5 && a.high <= 9 && a.low <= a.high);
    assert.equal(bootstrapMeanInterval([2], opts), null);
  });
});
