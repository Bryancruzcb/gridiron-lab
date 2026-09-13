import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { BacktestFile } from "../../src/data/types.ts";
import { RULESET_REF } from "../../src/lib/football/scoring.ts";
import { StudyConfigError } from "../../scripts/lib/study/errors.ts";
import { storeSnapshot } from "../../scripts/lib/study/inputs.ts";
import { toBacktestFile, toEwmaFile, toProjectionFile } from "../../scripts/lib/study/legacy-files.ts";
import { LEGACY_SCORING_REF } from "../../scripts/lib/study/legacy-scoring.ts";
import { MODEL_PRESETS } from "../../scripts/lib/study/models.ts";
import { playerWeekSpec, SCHEDULE_SPEC, teamWeekSpec } from "../../scripts/lib/study/sources.ts";
import { checkLegacyOutput, isInPageData, legacyWrapperMain } from "../../scripts/lib/study/wrapper.ts";
import { encode, fixtureText, GAMES, playersFile, runFixture, teamsFile } from "../fixtures/football/study-fixture.ts";

const fantasyPath = fileURLToPath(new URL("../fixtures/football/study-fantasy.json", import.meta.url));

const temp: string[] = [];
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "gridiron-study-wrapper-"));
  temp.push(dir);
  return dir;
}
after(() => {
  for (const dir of temp) rmSync(dir, { recursive: true, force: true });
});

describe("legacy page files and attribution-only scoring", () => {
  const legacy = (preset: string) => runFixture({ config: { scoring: LEGACY_SCORING_REF, models: MODEL_PRESETS[preset]!() } });

  it("refuse an attribution-only run unless the caller writes outside src/data", () => {
    const backtest = legacy("backtest");
    assert.equal(backtest.run.scoring.legacyAttributionOnly, true);
    assert.throws(() => toBacktestFile(backtest), (e: unknown) => e instanceof StudyConfigError && /attribution-only scoring/.test(e.message));
    assert.throws(() => toProjectionFile(legacy("projections")), /attribution-only scoring/);
    assert.throws(() => toEwmaFile(legacy("ewma-sweep")), /attribution-only scoring/);

    assert.match(toBacktestFile(backtest, { allowAttributionOnly: true }).notes[0]!, /^Attribution only \(legacy-study-dst@ce5d6b1\)/);
    assert.match(toProjectionFile(legacy("projections"), { allowAttributionOnly: true }).notes[0]!, /^Attribution only/);
    assert.match(toEwmaFile(legacy("ewma-sweep"), { allowAttributionOnly: true }).note, /^Attribution only/);
  });

  it("leave ruleset runs unmarked", () => {
    const run = runFixture({ config: { models: MODEL_PRESETS.backtest!() } });
    assert.deepEqual(toBacktestFile(run, { allowAttributionOnly: true }), toBacktestFile(run));
    assert.ok(!toBacktestFile(run).notes.some((n) => n.includes("Attribution only")));
  });
});

describe("legacy wrapper output checks", () => {
  const root = join(tmpdir(), "repo");

  it("know which paths are the page data directory", () => {
    assert.equal(isInPageData(root, join(root, "src", "data")), true);
    assert.equal(isInPageData(root, join(root, "src", "data", "study-backtest.json")), true);
    assert.equal(isInPageData(root, join(root, "src", "data", "sub", "x.json")), true);
    assert.equal(isInPageData(root, join(root, "src", "data-old", "x.json")), false);
    assert.equal(isInPageData(root, join(root, "artifacts", "study-backtest.json")), false);
    assert.equal(isInPageData(root, join(tmpdir(), "elsewhere", "src", "data", "x.json")), false);
  });

  it("allow attribution-only scoring only with --legacy-out outside src/data", () => {
    checkLegacyOutput({ scoring: RULESET_REF, legacyOut: null }, root);
    checkLegacyOutput({ scoring: LEGACY_SCORING_REF, legacyOut: join(root, "artifacts", "b.json") }, root);
    assert.throws(() => checkLegacyOutput({ scoring: LEGACY_SCORING_REF, legacyOut: null }, root), /attribution-only.*--legacy-out/);
    assert.throws(
      () => checkLegacyOutput({ scoring: LEGACY_SCORING_REF, legacyOut: join(root, "src", "data", "study-backtest.json") }, root),
      StudyConfigError,
    );
  });
});

describe("legacy wrapper end to end", () => {
  // A scratch repo root, so the default output (src/data) is never the real page data.
  const repoRoot = tempDir();
  mkdirSync(join(repoRoot, "src", "data"), { recursive: true });
  const cache = tempDir();
  storeSnapshot(cache, playerWeekSpec(2041), encode(fixtureText(playersFile(2041))), "2026-09-12T00:00:00.000Z", null);
  storeSnapshot(cache, teamWeekSpec(2041), encode(fixtureText(teamsFile(2041))), "2026-09-12T00:00:00.000Z", null);
  storeSnapshot(cache, SCHEDULE_SPEC, encode(fixtureText(GAMES)), "2026-09-12T00:00:00.000Z", null);

  const wrapper = (out: string, extra: string[]) =>
    legacyWrapperMain({
      repoRoot,
      argv: [
        "--season", "2041", "--weeks", "2-4", "--offline", "--input-dir", cache, "--out-dir", out,
        "--universe", `legacy-fantasy-json:${fantasyPath}`, "--resamples", "200", ...extra,
      ],
      models: "backtest",
      qbLag: true,
      defaultOut: "src/data/study-backtest.json",
      toLegacy: toBacktestFile,
      pretty: false,
      log: () => {},
      context: {
        now: () => new Date("2026-09-12T01:00:00.000Z"),
        sourceState: () => ({ commit: null, dirty: null }),
        fetchImpl: async () => {
          throw new Error("the network must not be used");
        },
      },
    });

  it("refuses attribution-only scoring before running when the output would land in src/data", async () => {
    const out = tempDir();
    await assert.rejects(wrapper(out, ["--scoring", LEGACY_SCORING_REF]), /attribution-only/);
    await assert.rejects(
      wrapper(out, ["--scoring", LEGACY_SCORING_REF, "--legacy-out", join(repoRoot, "src", "data", "study-backtest.json")]),
      /attribution-only/,
    );
    assert.deepEqual(readdirSync(join(repoRoot, "src", "data")), []);
    assert.deepEqual(readdirSync(out), []);
  });

  it("writes attribution-only files outside src/data, labelled, and ruleset files to the default", async () => {
    const out = tempDir();
    const target = join(out, "attribution", "study-backtest.json");
    mkdirSync(join(out, "attribution"));
    const written = await wrapper(out, ["--scoring", LEGACY_SCORING_REF, "--legacy-out", target]);
    assert.deepEqual(written, [target, join(out, "attribution", "study-backtest-qb-lag.json")]);
    assert.match((JSON.parse(readFileSync(target, "utf8")) as BacktestFile).notes[0]!, /^Attribution only/);
    assert.deepEqual(readdirSync(join(repoRoot, "src", "data")), []);

    const page = await wrapper(tempDir(), []);
    assert.deepEqual(page, [join(repoRoot, "src", "data", "study-backtest.json"), join(repoRoot, "src", "data", "study-qb-lag.json")]);
    assert.ok(existsSync(page[0]!));
    assert.ok(!(JSON.parse(readFileSync(page[0]!, "utf8")) as BacktestFile).notes.some((n) => n.includes("Attribution only")));
  });
});
