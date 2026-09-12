import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { StudyRunArtifact, StudyRunMeta } from "../../src/data/types.ts";
import { RULESET_REF } from "../../src/lib/football/scoring.ts";
import { parseStudyArgs } from "../../scripts/lib/study/cli.ts";
import { runStudyCommand } from "../../scripts/lib/study/command.ts";
import { StudyConfigError, StudyInputError } from "../../scripts/lib/study/errors.ts";
import { sha256Hex } from "../../scripts/lib/study/hash.ts";
import { storeSnapshot } from "../../scripts/lib/study/inputs.ts";
import { LEGACY_SCORING_REF } from "../../scripts/lib/study/legacy-scoring.ts";
import { verifyRunArtifact } from "../../scripts/lib/study/report.ts";
import { playerWeekSpec, SCHEDULE_SPEC, teamWeekSpec } from "../../scripts/lib/study/sources.ts";
import { encode, fixtureText, GAMES, playersFile, teamsFile } from "../fixtures/football/study-fixture.ts";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const fantasyPath = fileURLToPath(new URL("../fixtures/football/study-fantasy.json", import.meta.url));

const temp: string[] = [];
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "gridiron-study-cli-"));
  temp.push(dir);
  return dir;
}
after(() => {
  for (const dir of temp) rmSync(dir, { recursive: true, force: true });
});

function seedCache(dir: string, seasons: number[]) {
  for (const season of seasons) {
    storeSnapshot(dir, playerWeekSpec(season), encode(fixtureText(playersFile(season))), "2026-09-12T00:00:00.000Z", null);
    storeSnapshot(dir, teamWeekSpec(season), encode(fixtureText(teamsFile(season))), "2026-09-12T00:00:00.000Z", null);
  }
  storeSnapshot(dir, SCHEDULE_SPEC, encode(fixtureText(GAMES)), "2026-09-12T00:00:00.000Z", null);
}

function command(argv: string[], at = "2026-09-12T01:00:00.000Z", logs: string[] = []) {
  return runStudyCommand(parseStudyArgs(argv, { repoRoot }), {
    repoRoot,
    command: argv,
    log: (m) => logs.push(m),
    now: () => new Date(at),
    sourceState: () => ({ commit: "0123abc", dirty: false }),
    fetchImpl: async () => {
      throw new Error("the network must not be used");
    },
  });
}

describe("study arguments", () => {
  const ctx = { repoRoot: "/repo", cwd: "/work" };
  const base = ["--seasons", "2023-2025", "--role", "holdout"];

  it("default to the ruleset, the synthetic universe and the core models", () => {
    const o = parseStudyArgs(base, ctx);
    assert.deepEqual(o.seasons, [2023, 2024, 2025]);
    assert.deepEqual(o.weeks, { from: 2, to: 18 });
    assert.deepEqual([o.scoring, o.universe, o.models, o.role, o.offline, o.qbLag], [RULESET_REF, "synthetic-prior-season@1", "core", "holdout", false, false]);
    assert.deepEqual([o.seed, o.resamples, o.minHistoryGames], [20260912, 2000, 1]);
    assert.equal(o.inputDir, resolve("/repo", ".study-cache"));
    assert.equal(o.outDir, resolve("/repo", "artifacts", "study"));
    assert.equal(parseStudyArgs([...base, "--input-dir", "cache", "--season", "2024"].filter((a) => a !== "--seasons" && a !== "2023-2025"), ctx).inputDir, resolve("/work", "cache"));
    assert.deepEqual(parseStudyArgs(["--seasons", "2025,2023", "--role", "retrospective"], ctx).seasons, [2023, 2025]);
  });

  it("select the legacy scoring variant only when named", () => {
    assert.equal(parseStudyArgs([...base, "--scoring", LEGACY_SCORING_REF], ctx).scoring, LEGACY_SCORING_REF);
    assert.throws(() => parseStudyArgs([...base, "--scoring", "legacy"], ctx), /--scoring must be/);
  });

  it("fail clearly on missing or malformed arguments", () => {
    assert.throws(() => parseStudyArgs(["--role", "holdout"], ctx), /--seasons is required/);
    assert.throws(() => parseStudyArgs(["--seasons", "2025"], ctx), /--role must be/);
    assert.throws(() => parseStudyArgs([...base, "--bogus"], ctx), StudyConfigError);
    assert.throws(() => parseStudyArgs([...base, "--weeks", "18-2"], ctx), /runs backwards/);
    assert.throws(() => parseStudyArgs([...base, "--seed", "1.5"], ctx), /--seed must be a whole number/);
    assert.throws(() => parseStudyArgs([...base, "--offline", "--refresh"], ctx), /cannot be combined/);
    assert.throws(() => parseStudyArgs([...base, "--legacy-out", "x.json"], ctx), /only for the legacy wrapper/);
  });

  it("pin the legacy wrappers to their preset, season and the shipped slate", () => {
    const wrapper = { models: "backtest", qbLag: true, season: 2025 };
    const o = parseStudyArgs([], { ...ctx, wrapper });
    assert.deepEqual([o.seasons, o.models, o.universe, o.role, o.qbLag], [[2025], "backtest", "legacy-fantasy-json", "retrospective", true]);
    assert.throws(() => parseStudyArgs(["--models", "core"], { ...ctx, wrapper }), /always uses the backtest preset/);
    assert.throws(() => parseStudyArgs(["--seasons", "2024,2025"], { ...ctx, wrapper }), /exactly one season/);
  });
});

describe("study command offline", () => {
  it("runs from the cache without the network and writes byte-identical semantic artifacts", async () => {
    const cache = tempDir();
    seedCache(cache, [2041]);
    const argv = (out: string) => [
      "--seasons", "2041", "--weeks", "1-5", "--role", "development", "--offline", "--input-dir", cache, "--out-dir", out,
      "--universe", `legacy-fantasy-json:${fantasyPath}`, "--models", "backtest", "--resamples", "200", "--qb-lag",
    ];
    const [out1, out2] = [tempDir(), tempDir()];
    const logs: string[] = [];
    const first = await command(argv(out1), "2026-09-12T01:00:00.000Z", logs);
    await command(argv(out2), "2026-09-12T02:00:00.000Z");
    const read = (dir: string, name: string) => readFileSync(join(dir, name), "utf8");
    for (const name of ["study-run-2041-backtest.json", "study-qb-lag-2041.json", "universe-2041-legacy-fantasy-json.json"]) {
      assert.equal(read(out1, name), read(out2, name), name);
    }
    const semantic = read(out1, "study-run-2041-backtest.json");
    assert.ok(!semantic.includes("2026-09-12"), "no timestamps in the semantic artifact");
    const artifact = JSON.parse(semantic) as StudyRunArtifact;
    verifyRunArtifact(artifact);
    assert.equal(artifact.runId, first.runs[0]!.artifact.runId);

    const meta1 = JSON.parse(read(out1, "study-run-2041-backtest.meta.json")) as StudyRunMeta;
    const meta2 = JSON.parse(read(out2, "study-run-2041-backtest.meta.json")) as StudyRunMeta;
    assert.deepEqual([meta1.generatedAt, meta2.generatedAt], ["2026-09-12T01:00:00.000Z", "2026-09-12T02:00:00.000Z"]);
    assert.equal(meta1.runId, meta2.runId);
    assert.deepEqual(meta1.inputs.map((i) => i.id), ["nfldata_games", "stats_player_week_2041", "stats_team_week_2041", "study-fantasy.json"]);
    const player = meta1.inputs.find((i) => i.id === "stats_player_week_2041")!;
    assert.equal(player.localPath, `snapshots/${sha256Hex(fixtureText(playersFile(2041)))}/stats_player_week_2041.csv`);
    assert.equal(player.retrievedAt, "2026-09-12T00:00:00.000Z");
    assert.equal(meta1.sourceCommit, "0123abc");
    assert.ok(meta1.codeSha256["scripts/lib/study/runner.ts"] && meta1.codeSha256["src/lib/optimizer.ts"]);
    assert.ok(meta1.warnings.some((w) => w.includes("look-ahead")));
    assert.ok(logs.some((l) => l.includes(artifact.runId) && l.includes("common weeks: 2041/2 2041/3 2041/4")));
  });

  it("fails clearly when an input is not cached", async () => {
    await assert.rejects(
      command(["--seasons", "2041", "--role", "development", "--offline", "--input-dir", tempDir(), "--out-dir", tempDir(), "--universe", `legacy-fantasy-json:${fantasyPath}`]),
      (e: unknown) => e instanceof StudyInputError && /offline: stats_player_week_2041 is not cached/.test(e.message),
    );
  });

  it("writes a pooled multi-season artifact and reproduces a run from pinned inputs", async () => {
    const cache = tempDir();
    seedCache(cache, [2040, 2041]);
    const out = tempDir();
    const argv = (dir: string, extra: string[] = []) => [
      "--seasons", "2040,2041", "--weeks", "2-4", "--role", "development", "--offline", "--input-dir", cache, "--out-dir", dir,
      "--universe", `legacy-fantasy-json:${fantasyPath}`, "--models", "projections", "--resamples", "200", ...extra,
    ];
    const result = await command(argv(out));
    assert.ok(result.multi);
    assert.equal(result.multi.artifact.runs.length, 2);
    const runFile = join(out, "study-run-2041-projections.json");

    // A newer upstream snapshot becomes current; a pinned run still reads the original bytes.
    const texts = fixtureText(playersFile(2041)).replace("AAA.QB", "AAA.QC");
    storeSnapshot(cache, playerWeekSpec(2041), encode(texts), "2026-09-13T00:00:00.000Z", null);
    const unpinned = await command([...argv(tempDir())].map((a) => (a === "2040,2041" ? "2041" : a)));
    const pinned = await command([...argv(tempDir(), ["--pin-inputs", runFile])].map((a) => (a === "2040,2041" ? "2041" : a)));
    const original = result.runs.find((x) => x.artifact.run.season === 2041)!.artifact.runId;
    assert.notEqual(unpinned.runs[0]!.artifact.runId, original);
    assert.equal(pinned.runs[0]!.artifact.runId, original);
  });
});
