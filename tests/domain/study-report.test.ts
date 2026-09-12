import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { RULESET_REF } from "../../src/lib/football/scoring.ts";
import { StudyConfigError } from "../../scripts/lib/study/errors.ts";
import { hashJson, sha256Hex } from "../../scripts/lib/study/hash.ts";
import { toBacktestFile, toEwmaFile, toProjectionFile } from "../../scripts/lib/study/legacy-files.ts";
import { EWMA_SWEEP_ALPHAS, MODEL_PRESETS, makeModel, validateModelConfig } from "../../scripts/lib/study/models.ts";
import { prepareSeason } from "../../scripts/lib/study/prepare.ts";
import { pearson, qbLag } from "../../scripts/lib/study/qb-lag.ts";
import { buildMultiSeason, serializeArtifact } from "../../scripts/lib/study/report.ts";
import {
  defaultSyntheticParams,
  legacyUniverse,
  parseFrozenUniverse,
  syntheticUniverse,
  universeRef,
} from "../../scripts/lib/study/universe.ts";
import { fixtureUniverse, runFixture, seasonTexts } from "../fixtures/football/study-fixture.ts";

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

describe("universes", () => {
  it("keep the shipped slate as the named legacy universe with its look-ahead disclosed", () => {
    const bytes = readFileSync(new URL("../../src/data/fantasy.json", import.meta.url));
    const u = legacyUniverse(bytes);
    assert.deepEqual([u.id, u.rule, u.season, u.cap, u.players.length, u.lookAhead], ["legacy-fantasy-json", "legacy-fantasy-json", 2025, 50000, 114, true]);
    assert.deepEqual(u.sourceInputs, [{ id: "fantasy.json", sha256: sha256Hex(bytes) }]);
    const ids = u.players.map((p) => p.id);
    assert.deepEqual(ids, [...ids].sort());
    assert.equal(universeRef(u).sha256, hashJson(u));
  });

  it("build a synthetic universe from the prior season only, frozen by hash", () => {
    const prior = prepareSeason(2040, seasonTexts(2040), { scoring: RULESET_REF });
    const params = { ...defaultSyntheticParams(2040), minGames: 2, counts: { QB: 3, RB: 6, WR: 6, TE: 3, DST: 3 } };
    const opts = { cap: 40000, sourceInputs: [{ id: "stats_player_week_2040", sha256: "0".repeat(64) }] };
    const u = syntheticUniverse(prior, params, opts);
    assert.deepEqual([u.id, u.season, u.lookAhead, u.cap], ["synthetic-prior-season@1:2041", 2041, false, 40000]);
    for (const pos of ["QB", "RB", "WR", "TE", "DST"] as const) {
      const group = u.players.filter((p) => p.pos === pos);
      assert.equal(group.length, params.counts[pos], pos);
      const [lo, hi] = params.salaryBands[pos];
      assert.ok(group.every((p) => p.salary >= lo && p.salary <= hi && p.salary % 100 === 0), pos);
      assert.equal(Math.max(...group.map((p) => p.salary)), hi, pos);
      assert.equal(Math.min(...group.map((p) => p.salary)), lo, pos);
    }
    // The top QB by 2040 points per game gets the top QB salary.
    const qbPpg = new Map<string, number>();
    for (const id of new Set(prior.players.filter((r) => r.position === "QB").map((r) => r.playerId))) {
      const pts = prior.players.filter((r) => r.playerId === id).map((r) => r.points!);
      qbPpg.set(id, pts.reduce((a, b) => a + b, 0) / pts.length);
    }
    const bestQb = [...qbPpg].sort((a, b) => b[1] - a[1])[0]![0];
    assert.equal(u.players.find((p) => p.id === bestQb)!.salary, params.salaryBands.QB[1]);
    assert.equal(hashJson(syntheticUniverse(prior, params, opts)), hashJson(u));
    const evaluated = prepareSeason(2041, seasonTexts(2041), { scoring: RULESET_REF });
    assert.throws(() => syntheticUniverse(evaluated, params, opts), /is not fromSeason 2040/);
  });

  it("round-trip when frozen and reject a broken contract", () => {
    const u = fixtureUniverse();
    const text = serializeArtifact(u);
    assert.deepEqual(parseFrozenUniverse(text, "u.json"), u);
    assert.throws(() => parseFrozenUniverse(text.replace('"salary":3000', '"salary":3050.5'), "u.json"), StudyConfigError);
    assert.throws(() => parseFrozenUniverse(text.replace("gridiron-lab-study-universe@1", "v0"), "u.json"), /schemaVersion/);
  });

  it("refuse another season's universe unless the run declares a common-pool experiment", () => {
    assert.throws(() => runFixture({ config: { season: 2040, weeks: { from: 2, to: 2 } } }), /frozen for 2041, not 2040/);
    const run = runFixture({ config: { season: 2040, weeks: { from: 2, to: 2 }, allowUniverseSeasonMismatch: true } });
    assert.ok(run.run.policies.some((p) => p.startsWith("Common-pool experiment")));
  });
});

describe("multi-season pooling", () => {
  const y2040 = runFixture({ config: { season: 2040, weeks: { from: 1, to: 2 }, allowUniverseSeasonMismatch: true } });
  const y2041 = runFixture();

  it("pools every run's common weeks with (season, week) as the unit", () => {
    const multi = buildMultiSeason([y2041, y2040]);
    assert.deepEqual(multi.runs.map((x) => [x.season, x.runId]), [
      [2040, y2040.runId],
      [2041, y2041.runId],
    ]);
    assert.deepEqual(multi.pooled.commonWeeks, [...y2040.summary.commonWeeks, ...y2041.summary.commonWeeks]);
    assert.ok(y2040.summary.commonWeeks.length > 0);
    for (const m of multi.pooled.models) assert.equal(m.weeks, multi.pooled.commonWeeks.length);
    assert.equal(multi.resultSha256, buildMultiSeason([y2040, y2041]).resultSha256);
  });

  it("refuses runs that do not share one locked configuration", () => {
    const other = runFixture({
      config: { season: 2040, weeks: { from: 1, to: 2 }, allowUniverseSeasonMismatch: true, models: MODEL_PRESETS.backtest!() },
    });
    assert.throws(() => buildMultiSeason([y2041, other]), /one locked configuration/);
    assert.throws(() => buildMultiSeason([y2041, y2041]), /appears in two runs/);
  });
});

describe("legacy study files", () => {
  it("derive the backtest shape from the common weeks", () => {
    const run = runFixture({ config: { models: MODEL_PRESETS.backtest!() } });
    const file = toBacktestFile(run);
    assert.deepEqual(file.weeks.map((w) => w.week), [2, 3, 4]);
    assert.equal(file.cap, 40000);
    const exact = file.weeks.map((w) => w.exact.actual);
    assert.equal(file.summary.exactMean, round(exact.reduce((a, b) => a + b, 0) / exact.length, 1));
    assert.equal(file.summary.exactBeatsProj, file.weeks.filter((w) => w.exact.actual > w.greedyProj.actual).length);
    assert.ok(file.notes.some((n) => n.includes(run.runId)));
  });

  it("derive the projection and EWMA shapes from the summaries", () => {
    const run = runFixture();
    const proj = toProjectionFile(run);
    assert.deepEqual(proj.models.map((m) => m.id), ["trail", "last1", "last3", "blend", "ewma", "shrink", "usage", "opp"]);
    const trail = run.summary.models.find((m) => m.model === "trail")!;
    assert.deepEqual(
      [proj.models[0]!.mae, proj.models[0]!.n, proj.models[0]!.weeks, proj.models[0]!.lineupMean],
      [round(trail.playerError.mae!, 2), trail.playerError.n, 3, round(trail.lineupActualMean!, 1)],
    );
    const ewma = toEwmaFile(runFixture({ config: { models: MODEL_PRESETS["ewma-sweep"]!() } }));
    assert.deepEqual(ewma.points.map((p) => p.alpha), [...EWMA_SWEEP_ALPHAS]);
    assert.ok(EWMA_SWEEP_ALPHAS.includes(ewma.bestLineup.alpha));
    assert.match(ewma.note, /exploratory/);
  });
});

describe("QB lag", () => {
  it("pairs consecutive weeks with enough attempts and skips byes", () => {
    const data = prepareSeason(2041, seasonTexts(2041), { scoring: RULESET_REF });
    const lag = qbLag(data, 15);
    // AAA and BBB were on bye in week 3; CCC and DDD played weeks 1-4.
    assert.deepEqual(
      lag.pairs.map((p) => `${p.id}:${p.week}`),
      ["AAA-QB:2", "BBB-QB:2", "CCC-QB:2", "CCC-QB:3", "CCC-QB:4", "DDD-QB:2", "DDD-QB:3", "DDD-QB:4"],
    );
    const row = data.players.find((r) => r.playerId === "CCC-QB" && r.week === 3)!;
    assert.equal(lag.pairs.find((p) => p.id === "CCC-QB" && p.week === 3)!.epaNext, round(row.passingEpa! / row.attempts!, 3));
    assert.equal(lag.corrEpa, pearson(lag.pairs.map((p) => p.epaPrev), lag.pairs.map((p) => p.epaNext)));
    assert.equal(qbLag(data, 99).n, 0);
  });
});

describe("model configuration", () => {
  it("validates every preset", () => {
    for (const [name, preset] of Object.entries(MODEL_PRESETS)) validateModelConfig(preset(), name);
    const sweep = MODEL_PRESETS["ewma-sweep"]!();
    assert.deepEqual(sweep.models.slice(1, 3).map((m) => [m.id, m.params.alpha]), [["ewma-0.05", 0.05], ["ewma-0.10", 0.1]]);
    assert.equal(sweep.models.at(-1)!.id, "ewma-1.00");
  });

  it("rejects unknown methods, bad parameters, duplicate ids and a missing baseline", () => {
    const ok = makeModel("ewma");
    const bad = (models: unknown[], baseline = "ewma") => () => validateModelConfig({ models, baseline }, "cfg");
    assert.throws(bad([{ ...ok, method: "magic" }]), /unknown method "magic"/);
    assert.throws(bad([{ ...ok, params: { alpha: 1.5 } }]), /alpha must be a number in \[0.01, 1\]/);
    assert.throws(bad([{ ...ok, params: { alfa: 0.2 } }]), /ewma has no parameter alfa/);
    assert.throws(bad([{ ...ok, solver: "exact" }]), /unknown solver/);
    assert.throws(bad([ok, ok]), /appears twice/);
    assert.throws(bad([ok], "trail"), /baseline trail is not one of the models/);
    assert.throws(bad([{ ...makeModel("opp"), params: { clampLow: 2, clampHigh: 1 } }], "opp"), /clampLow 2 exceeds clampHigh 1/);
    assert.throws(bad([{ ...makeModel("last3"), params: { windowWeeks: 2.5 } }], "last3"), /whole number/);
  });
});
