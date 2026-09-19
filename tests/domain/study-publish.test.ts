import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { defaultSyntheticParams, syntheticUniverse } from "../../scripts/lib/study/universe.ts";
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

const prior2040 = prepareSeason(2040, seasonTexts(2040), { scoring: RULESET_REF });
const syntheticParams = { ...defaultSyntheticParams(2040), minGames: 2, counts: { QB: 3, RB: 6, WR: 6, TE: 3, DST: 3 } };
const synthetic = syntheticUniverse(prior2040, syntheticParams, { sourceInputs: [] });
const y2040 = runFixture({
  config: { season: 2040, weeks: { from: 1, to: 3 }, allowUniverseSeasonMismatch: true },
  universe: synthetic,
});
const y2041 = runFixture({ config: { role: "retrospective" }, universe: synthetic });
const leak = runFixture(); // legacy look-ahead slate — comparison only
