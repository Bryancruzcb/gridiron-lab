import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { StudyFactsFile, StudyUniverse } from "../../src/data/types.ts";
import { RULESET_REF } from "../../src/lib/football/scoring.ts";
import { parseFactsArgs, parseStudyArgs } from "../../scripts/lib/study/cli.ts";
import { runFactsCommand, runStudyCommand, sortedJson } from "../../scripts/lib/study/command.ts";
import { buildFactsFile, runFacts, sweepFacts } from "../../scripts/lib/study/facts.ts";
import { hashJson } from "../../scripts/lib/study/hash.ts";
import { storeSnapshot } from "../../scripts/lib/study/inputs.ts";
import { LEGACY_SCORING_REF } from "../../scripts/lib/study/legacy-scoring.ts";
import { EWMA_SWEEP_ALPHAS, MODEL_PRESETS } from "../../scripts/lib/study/models.ts";
import { prepareSeason } from "../../scripts/lib/study/prepare.ts";
import { buildMultiSeason } from "../../scripts/lib/study/report.ts";
import { playerWeekSpec, SCHEDULE_SPEC, teamWeekSpec } from "../../scripts/lib/study/sources.ts";
import { defaultSyntheticParams, syntheticUniverse } from "../../scripts/lib/study/universe.ts";
import { encode, fixtureText, fixtureUniverse, GAMES, playersFile, runFixture, seasonTexts, teamsFile } from "../fixtures/football/study-fixture.ts";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const fantasyPath = fileURLToPath(new URL("../fixtures/football/study-fantasy.json", import.meta.url));

const temp: string[] = [];
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "gridiron-study-facts-"));
  temp.push(dir);
  return dir;
}
after(() => {
  for (const dir of temp) rmSync(dir, { recursive: true, force: true });
});

const byHash = (...universes: StudyUniverse[]) => new Map(universes.map((u) => [hashJson(u), u]));

describe("run facts", () => {
  const run = runFixture();

  it("count availability, inactive lineup slots and solver records from the week records", () => {
    const f = runFacts(run);
    const common = run.weeks.filter((w) => w.comparable);
    assert.deepEqual([f.commonWeeks, f.excludedWeeks], [common.length, run.weeks.length - common.length]);
    assert.ok(f.excludedWeeks > 0, "the fixture range includes excluded weeks");
    assert.deepEqual(f.slateSize, { min: Math.min(...common.map((w) => w.slate.length)), max: Math.max(...common.map((w) => w.slate.length)) });
    assert.equal(f.slateStatuses.played, run.summary.models.find((m) => m.model === "trail")!.playerError.n);
    assert.equal(
      Object.values(f.slateStatuses).reduce((a, b) => a + b, 0),
      common.reduce((n, w) => n + w.slate.length, 0),
    );
    assert.equal(
      Object.values(f.offSlate).reduce((a, b) => a + b, 0),
      common.reduce((n, w) => n + w.offSlate.length, 0),
    );
    const inactive = common.flatMap((w) => w.models.find((m) => m.model === "trail")!.lineup!.slots).filter((s) => s.status === "inactive");
    assert.equal(f.baselineInactiveSlots, inactive.length);
    assert.equal(
      Object.values(f.solverRecords).reduce((a, b) => a + b, 0),
      run.weeks.reduce((n, w) => n + w.models.length, 0),
    );
    assert.ok((f.solverRecords["exact-dp/proven"] ?? 0) > 0 && (f.solverRecords["greedy-proj/heuristic"] ?? 0) > 0);
  });

  it("describe a sweep's best alpha, alone and pooled", () => {
    const sweep2041 = runFixture({ config: { models: MODEL_PRESETS["ewma-sweep"]!() } });
    const sweep2040 = runFixture({ config: { season: 2040, weeks: { from: 1, to: 3 }, allowUniverseSeasonMismatch: true, models: MODEL_PRESETS["ewma-sweep"]!() } });
    const one = sweepFacts([sweep2041]);
    assert.deepEqual(one.points.map((p) => p.alpha), [...EWMA_SWEEP_ALPHAS]);
    const top = Math.max(...one.points.map((p) => p.lineupMean));
    assert.equal(one.best.lineupMean, top);
    assert.equal(one.best.alpha, one.points.find((p) => p.lineupMean === top)!.alpha);
    assert.equal(one.baseline.lineupMean, sweep2041.summary.models.find((m) => m.model === "trail")!.lineupActualMean);

    const pooled = sweepFacts([sweep2041, sweep2040]);
    const multi = buildMultiSeason([sweep2040, sweep2041]);
    assert.deepEqual([pooled.seasons, pooled.commonWeeks], [[2040, 2041], multi.pooled.commonWeeks.length]);
    assert.equal(pooled.points[6]!.lineupMean, multi.pooled.models.find((m) => m.model === "ewma-0.35")!.lineupActualMean);
  });
});

describe("facts file", () => {
  const prior = prepareSeason(2040, seasonTexts(2040), { scoring: RULESET_REF });
  const params = { ...defaultSyntheticParams(2040), minGames: 2, counts: { QB: 3, RB: 6, WR: 6, TE: 3, DST: 3 } };
  const synthetic = syntheticUniverse(prior, params, { sourceInputs: [] });
  const clean = runFixture({ universe: synthetic });
  const shipped = runFixture();

  it("count the shipped slate's players that are also in the clean pool, by id", () => {
    const facts = buildFactsFile({ runs: [clean], shippedSlate: shipped, sweeps: [], universes: byHash(fixtureUniverse(), synthetic) });
    const ids = new Set(synthetic.players.map((p) => p.id));
    const shared = fixtureUniverse().players.filter((p) => ids.has(p.id));
    assert.ok(shared.length > 0 && shared.length < fixtureUniverse().players.length);
    assert.equal(facts.universeOverlap!.shared, shared.length);
    assert.equal(facts.universeOverlap!.byPosition.WR, shared.filter((p) => p.pos === "WR").length);
    assert.deepEqual([facts.universeOverlap!.shipped.sha256, facts.universeOverlap!.clean.sha256], [shipped.run.universe.sha256, clean.run.universe.sha256]);
    assert.deepEqual(facts.pooledBaselineInactiveSlots, { seasons: [2041], commonWeeks: facts.runs[0]!.commonWeeks, slots: facts.runs[0]!.baselineInactiveSlots });
    const { resultSha256, ...body } = facts;
    assert.equal(resultSha256, hashJson(body));
  });

  it("refuse missing universe files, edited runs and attribution-only runs", () => {
    assert.throws(() => buildFactsFile({ runs: [clean], shippedSlate: shipped, sweeps: [], universes: byHash(synthetic) }), /no universe file hashes to/);
    const edited = structuredClone(clean);
    edited.summary.models[0]!.lineupActualMean! += 1;
    assert.throws(() => buildFactsFile({ runs: [edited], shippedSlate: null, sweeps: [], universes: new Map() }), /does not match|does not recompute/);
    const legacy = runFixture({ config: { scoring: LEGACY_SCORING_REF } });
    assert.throws(() => buildFactsFile({ runs: [legacy], shippedSlate: null, sweeps: [], universes: new Map() }), /attribution-only/);
  });
});

describe("facts command", () => {
  it("reads written runs and their universe files and writes sorted JSON", async () => {
    const cache = tempDir();
    for (const season of [2040, 2041]) {
      storeSnapshot(cache, playerWeekSpec(season), encode(fixtureText(playersFile(season))), "2026-09-12T00:00:00.000Z", null);
      storeSnapshot(cache, teamWeekSpec(season), encode(fixtureText(teamsFile(season))), "2026-09-12T00:00:00.000Z", null);
    }
    storeSnapshot(cache, SCHEDULE_SPEC, encode(fixtureText(GAMES)), "2026-09-12T00:00:00.000Z", null);
    const out = tempDir();
    const study = (models: string, dir: string) => {
      const argv = [
        "--seasons", "2040,2041", "--weeks", "2-4", "--role", "development", "--offline", "--input-dir", cache, "--out-dir", dir,
        "--universe", `legacy-fantasy-json:${fantasyPath}`, "--models", models, "--resamples", "200",
      ];
      return runStudyCommand(parseStudyArgs(argv, { repoRoot }), {
        repoRoot,
        command: argv,
        log: () => {},
        sourceState: () => ({ commit: null, dirty: null }),
      });
    };
    await study("core", out);
    await study("ewma-sweep", join(out, "sweep"));
    const opts = parseFactsArgs([
      "--runs", [2040, 2041].map((s) => join(out, `study-run-${s}-core.json`)).join(","),
      "--sweeps", [2040, 2041].map((s) => join(out, "sweep", `study-run-${s}-ewma-sweep.json`)).join(","),
      "--out", join(out, "facts.json"),
    ]);
    const file = runFactsCommand(opts, { log: () => {} });
    assert.equal(readFileSync(join(out, "facts.json"), "utf8"), sortedJson(file));
    assert.deepEqual((JSON.parse(readFileSync(join(out, "facts.json"), "utf8")) as StudyFactsFile).runs.map((r) => r.season), [2040, 2041]);
    assert.deepEqual(file.sweeps.map((s) => s.seasons), [[2040], [2041], [2040, 2041]]);
    assert.equal(file.universeOverlap, null);
    assert.throws(() => parseFactsArgs(["--out", "x.json"]), /facts needs --runs/);
  });
});
