import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { StudyInputManifestFile, StudyQbLagArtifact, StudyRunArtifact, StudyRunMeta, StudySeasonsFile } from "../../src/data/types.ts";
import { RULESET_REF } from "../../src/lib/football/scoring.ts";
import { parsePublishArgs, parseStudyArgs } from "../../scripts/lib/study/cli.ts";
import { metaPathOf, runPublishCommand, runStudyCommand, sortedJson } from "../../scripts/lib/study/command.ts";
import { StudyConfigError } from "../../scripts/lib/study/errors.ts";
import { hashJson } from "../../scripts/lib/study/hash.ts";
import { storeSnapshot } from "../../scripts/lib/study/inputs.ts";
import { MODEL_PRESETS } from "../../scripts/lib/study/models.ts";
import { prepareSeason } from "../../scripts/lib/study/prepare.ts";
import { buildInputManifest, buildSeasonsFile } from "../../scripts/lib/study/publish.ts";
import { qbLag } from "../../scripts/lib/study/qb-lag.ts";
import { buildMultiSeason } from "../../scripts/lib/study/report.ts";
import { playerWeekSpec, SCHEDULE_SPEC, teamWeekSpec } from "../../scripts/lib/study/sources.ts";
import { encode, fixtureText, GAMES, inputsFor, playersFile, runFixture, seasonTexts, teamsFile } from "../fixtures/football/study-fixture.ts";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const fantasyPath = fileURLToPath(new URL("../fixtures/football/study-fantasy.json", import.meta.url));

const temp: string[] = [];
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "gridiron-study-publish-"));
  temp.push(dir);
  return dir;
}
after(() => {
  for (const dir of temp) rmSync(dir, { recursive: true, force: true });
});

const y2040 = runFixture({ config: { season: 2040, weeks: { from: 1, to: 3 }, allowUniverseSeasonMismatch: true } });
const y2041 = runFixture({ config: { role: "retrospective" } });

function lagArtifact(season: number, playerWeekSha256?: string): StudyQbLagArtifact {
  const identity = inputsFor(season)[0]!;
  const body = {
    ...qbLag(prepareSeason(season, seasonTexts(season), { scoring: RULESET_REF })),
    schemaVersion: "gridiron-lab-study-qb-lag@1" as const,
    inputs: [{ ...identity, sha256: playerWeekSha256 ?? identity.sha256 }],
  };
  return { ...body, resultSha256: hashJson(body) };
}

function meta(artifact: StudyRunArtifact, retrievedAt: string, localPath = (sha: string) => `snapshots/${sha}/file`): StudyRunMeta {
  return {
    schemaVersion: "gridiron-lab-study-run-meta@1",
    runId: artifact.runId,
    resultSha256: artifact.resultSha256,
    generatedAt: retrievedAt,
    elapsedMs: 1,
    sourceCommit: null,
    sourceDirty: null,
    node: "test",
    command: [],
    codeSha256: {},
    cacheDir: "/cache",
    inputs: artifact.run.inputs.map((i) => ({ ...i, localPath: localPath(i.sha256), retrievedAt, http: null })),
    warnings: [],
  };
}

describe("published seasons file", () => {
  it("copies each run's summary and weekly lineup totals from its stored records", () => {
    const file = buildSeasonsFile({ runs: [y2041, y2040], qbLags: [lagArtifact(2041)] });
    assert.deepEqual(file.seasons.map((s) => [s.season, s.role, s.runId]), [
      [2040, "development", y2040.runId],
      [2041, "retrospective", y2041.runId],
    ]);
    const row = file.seasons[1]!;
    assert.deepEqual(row.summary, y2041.summary);
    assert.deepEqual(row.weekly.map((w) => w.week), y2041.summary.commonWeeks.map((w) => w.week));
    const week = y2041.weeks.find((w) => w.week === row.weekly[0]!.week)!;
    const trail = week.models.find((m) => m.model === "trail")!.lineup!;
    assert.deepEqual(row.weekly[0]!.lineups.trail, { proj: trail.proj, actual: trail.actual });
    assert.deepEqual(row.qbLag && [row.qbLag.n, row.qbLag.corrEpa], [lagArtifact(2041).n, lagArtifact(2041).corrEpa]);
    assert.equal(file.seasons[0]!.qbLag, null);

    assert.equal(file.pools.length, 1);
    assert.deepEqual(file.pools[0]!.summary, buildMultiSeason([y2040, y2041]).pooled);
    assert.deepEqual(file.pools[0]!.roles, ["development", "retrospective"]);
    const { resultSha256, ...body } = file;
    assert.equal(resultSha256, hashJson(body));
    assert.equal(buildSeasonsFile({ runs: [y2040, y2041], qbLags: [lagArtifact(2041)] }).resultSha256, resultSha256);
    assert.equal(file.shippedSlate, null);
  });

  it("refuses edited runs, mixed configurations and QB lag files that do not match", () => {
    const edited = structuredClone(y2041);
    edited.summary.models[0]!.lineupActualMean! += 1;
    assert.throws(() => buildSeasonsFile({ runs: [edited] }), /resultSha256 does not match|does not recompute/);
    const backtest = runFixture({ config: { models: MODEL_PRESETS.backtest!() } });
    assert.throws(() => buildSeasonsFile({ runs: [y2041], shippedSlate: backtest }), /differs from/);
    const lag = lagArtifact(2041);
    assert.throws(() => buildSeasonsFile({ runs: [y2041], qbLags: [{ ...lag, n: lag.n + 1 }] }), /resultSha256 does not match/);
    assert.throws(() => buildSeasonsFile({ runs: [y2041], qbLags: [lagArtifact(2041, "f".repeat(64))] }), /different player-week bytes/);
    assert.throws(() => buildSeasonsFile({ runs: [y2041], qbLags: [lagArtifact(2040)] }), /no season run/);
  });
});

describe("input manifest", () => {
  it("keeps one entry per content hash with the earliest retrieval and every run that read it", () => {
    const manifest = buildInputManifest([
      { artifact: y2041, meta: meta(y2041, "2026-09-12T02:00:00.000Z") },
      { artifact: y2040, meta: meta(y2040, "2026-09-12T01:00:00.000Z") },
    ]);
    const games = manifest.inputs.filter((i) => i.id === "nfldata_games");
    assert.equal(games.length, 1);
    assert.deepEqual(games[0]!.usedBy, [y2040.runId, y2041.runId].sort());
    assert.equal(games[0]!.retrievedAt, "2026-09-12T01:00:00.000Z");
    assert.deepEqual(manifest.inputs.map((i) => i.id), [...manifest.inputs.map((i) => i.id)].sort());
    assert.ok(manifest.inputs.some((i) => i.id === "stats_player_week_2040") && manifest.inputs.some((i) => i.id === "stats_player_week_2041"));
  });

  it("keeps the first recorded retrieval when republished and drops inputs no run reads", () => {
    const first = buildInputManifest([{ artifact: y2041, meta: meta(y2041, "2026-09-12T01:00:00.000Z") }]);
    const withStale = { ...first, inputs: [...first.inputs, { ...first.inputs[0]!, sha256: "e".repeat(64) }] };
    const again = buildInputManifest([{ artifact: y2041, meta: meta(y2041, "2026-09-13T05:00:00.000Z") }], withStale);
    assert.deepEqual(again, first);
  });

  it("refuses a meta file from another run or two descriptions of the same bytes", () => {
    assert.throws(() => buildInputManifest([{ artifact: y2041, meta: meta(y2040, "2026-09-12T01:00:00.000Z") }]), /does not describe/);
    assert.throws(
      () =>
        buildInputManifest([
          { artifact: y2041, meta: meta(y2041, "2026-09-12T02:00:00.000Z") },
          { artifact: y2040, meta: meta(y2040, "2026-09-12T01:00:00.000Z", (sha) => `elsewhere/${sha}`) },
        ]),
      /described two different ways/,
    );
  });
});

describe("publish command", () => {
  it("writes the seasons file and manifest from written runs and their meta files", async () => {
    const cache = tempDir();
    for (const season of [2040, 2041]) {
      storeSnapshot(cache, playerWeekSpec(season), encode(fixtureText(playersFile(season))), "2026-09-12T00:00:00.000Z", null);
      storeSnapshot(cache, teamWeekSpec(season), encode(fixtureText(teamsFile(season))), "2026-09-12T00:00:00.000Z", null);
    }
    storeSnapshot(cache, SCHEDULE_SPEC, encode(fixtureText(GAMES)), "2026-09-12T00:00:00.000Z", null);
    const out = tempDir();
    const argv = [
      "--seasons", "2040,2041", "--weeks", "2-4", "--role", "development", "--offline", "--input-dir", cache, "--out-dir", out,
      "--universe", `legacy-fantasy-json:${fantasyPath}`, "--models", "projections", "--resamples", "200", "--qb-lag",
    ];
    await runStudyCommand(parseStudyArgs(argv, { repoRoot }), {
      repoRoot,
      command: argv,
      log: () => {},
      now: () => new Date("2026-09-12T01:00:00.000Z"),
      sourceState: () => ({ commit: null, dirty: null }),
    });
    const runs = [2040, 2041].map((s) => join(out, `study-run-${s}-projections.json`));
    const logs: string[] = [];
    const opts = parsePublishArgs([
      "--runs", runs.join(","), "--qb-lag", join(out, "study-qb-lag-2041.json"),
      "--out", join(out, "page", "seasons.json"), "--manifest", join(out, "manifest.json"),
    ]);
    const { file, manifest } = runPublishCommand(opts, { log: (m) => logs.push(m) });
    const written = readFileSync(join(out, "page", "seasons.json"), "utf8");
    assert.equal(written, sortedJson(file));
    assert.deepEqual((JSON.parse(written) as StudySeasonsFile).seasons.map((s) => s.season), [2040, 2041]);
    assert.equal(Object.keys(JSON.parse(written))[0], "baselineModel");
    const onDisk = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")) as StudyInputManifestFile;
    assert.deepEqual(onDisk, manifest);
    assert.deepEqual(
      onDisk.inputs.map((i) => i.id),
      ["nfldata_games", "stats_player_week_2040", "stats_player_week_2041", "stats_team_week_2040", "stats_team_week_2041", "study-fantasy.json"],
    );
    assert.equal(onDisk.inputs[0]!.retrievedAt, "2026-09-12T00:00:00.000Z");
    assert.ok(logs.some((l) => l.includes(file.resultSha256)));
    assert.equal(metaPathOf(runs[0]!), join(out, "study-run-2040-projections.meta.json"));
  });

  it("fails clearly on missing arguments and files", () => {
    assert.throws(() => parsePublishArgs(["--out", "x.json"]), /publish needs --runs/);
    assert.throws(() => parsePublishArgs(["--runs", "a.json"]), /publish needs --out/);
    const dir = tempDir();
    assert.throws(
      () => runPublishCommand(parsePublishArgs(["--runs", join(dir, "missing.json"), "--out", join(dir, "o.json")]), { log: () => {} }),
      (e: unknown) => e instanceof StudyConfigError && /does not exist/.test(e.message),
    );
  });
});
