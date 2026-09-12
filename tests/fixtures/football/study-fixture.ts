// Loaders for the synthetic study fixtures (see study-fixture-generator.ts). Text is read with CRLF
// folded to LF so identities and hashes match on Windows and Linux checkouts.

import { readFileSync } from "node:fs";
import type { StudyInputIdentity, StudyRunArtifact, StudyUniverse } from "../../../src/data/types.ts";
import type { SolveRequest, SolveResult } from "../../../src/lib/optimizer.ts";
import { RULESET_REF } from "../../../src/lib/football/scoring.ts";
import { describeInput } from "../../../scripts/lib/study/inputs.ts";
import { MODEL_PRESETS } from "../../../scripts/lib/study/models.ts";
import { prepareSeason, type SeasonTexts } from "../../../scripts/lib/study/prepare.ts";
import { runStudy, type StudyRunConfig } from "../../../scripts/lib/study/runner.ts";
import { playerWeekSpec, SCHEDULE_SPEC, teamWeekSpec, universeFileSpec } from "../../../scripts/lib/study/sources.ts";
import { legacyUniverse } from "../../../scripts/lib/study/universe.ts";

export const FANTASY = "study-fantasy.json";
export const GAMES = "study-games.csv";
export const playersFile = (season: number) => `study-stats_player_week_${season}.csv`;
export const teamsFile = (season: number) => `study-stats_team_week_${season}.csv`;

export function fixtureText(name: string): string {
  return readFileSync(new URL(name, import.meta.url), "utf8").replace(/\r\n/g, "\n");
}

export const encode = (text: string) => new TextEncoder().encode(text);

export function seasonTexts(season: number): SeasonTexts {
  return { playerWeek: fixtureText(playersFile(season)), teamWeek: fixtureText(teamsFile(season)), schedule: fixtureText(GAMES) };
}

export const fantasySpec = universeFileSpec(FANTASY, `file:${FANTASY}`, FANTASY);

export function inputsFor(season: number, texts: SeasonTexts = seasonTexts(season), fantasy = fixtureText(FANTASY)): StudyInputIdentity[] {
  return [
    describeInput(playerWeekSpec(season), encode(texts.playerWeek)).identity,
    describeInput(teamWeekSpec(season), encode(texts.teamWeek)).identity,
    describeInput(SCHEDULE_SPEC, encode(texts.schedule)).identity,
    describeInput(fantasySpec, encode(fantasy)).identity,
  ];
}

export function fixtureUniverse(): StudyUniverse {
  return legacyUniverse(encode(fixtureText(FANTASY)), FANTASY);
}

export function fixtureConfig(overrides: Partial<StudyRunConfig> = {}): StudyRunConfig {
  return {
    season: 2041,
    weeks: { from: 1, to: 5 },
    role: "development",
    scoring: RULESET_REF,
    models: MODEL_PRESETS.core!(),
    minHistoryGames: 1,
    positionPriorFallback: 8,
    uncertainty: { resamples: 500, seed: 7, level: 0.95 },
    ...overrides,
  };
}

/** Prepares and runs a fixture season end to end. */
export function runFixture(
  opts: {
    config?: Partial<StudyRunConfig>;
    texts?: SeasonTexts;
    universe?: StudyUniverse;
    solve?: (request: SolveRequest) => SolveResult;
  } = {},
): StudyRunArtifact {
  const config = fixtureConfig(opts.config);
  const texts = opts.texts ?? seasonTexts(config.season);
  const data = prepareSeason(config.season, texts, { scoring: config.scoring });
  return runStudy({
    config,
    data,
    universe: opts.universe ?? fixtureUniverse(),
    inputs: inputsFor(config.season, texts),
    solve: opts.solve,
  });
}

// The helpers below split on commas: the synthetic fixtures contain no quoted cells.

function table(text: string) {
  const lines = text.split("\n").filter(Boolean);
  const header = lines[0]!.split(",");
  const rows = lines.slice(1).map((l) => Object.fromEntries(header.map((h, j) => [h, l.split(",")[j] ?? ""])));
  return { header, rows };
}

function render(header: readonly string[], rows: readonly Record<string, string>[]): string {
  return [header.join(","), ...rows.map((r) => header.map((h) => r[h] ?? "").join(","))].join("\n") + "\n";
}

export function dropColumn(text: string, column: string): string {
  const { header, rows } = table(text);
  if (!header.includes(column)) throw new Error(`no column ${column}`);
  return render(
    header.filter((h) => h !== column),
    rows,
  );
}

export function dropRows(text: string, drop: (cells: Record<string, string>) => boolean): string {
  const { header, rows } = table(text);
  return render(
    header,
    rows.filter((r) => !drop(r)),
  );
}

export function reverseRows(text: string): string {
  const { header, rows } = table(text);
  return render(header, [...rows].reverse());
}

/** Rewrites CSV rows whose `week` column satisfies the predicate. */
export function mapRows(text: string, keep: (week: number) => boolean, edit: (cells: Record<string, string>) => void): string {
  const lines = text.split("\n");
  const header = lines[0]!.split(",");
  const weekAt = header.indexOf("week");
  return lines
    .map((line, i) => {
      if (i === 0 || !line) return line;
      const cells = line.split(",");
      if (!keep(Number(cells[weekAt]))) return line;
      const record = Object.fromEntries(header.map((h, j) => [h, cells[j] ?? ""]));
      edit(record);
      return header.map((h) => record[h]).join(",");
    })
    .join("\n");
}
