// Command-line parsing shared by scripts/study.ts and the three legacy wrapper scripts.

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { StudyRole } from "../../../src/data/types.ts";
import { CsvColumnError, CsvFormatError, CsvValueError } from "../../../src/lib/football/csv.ts";
import { RULESET_REF } from "../../../src/lib/football/scoring.ts";
import { StudyConfigError, StudyInputError } from "./errors.ts";
import { LEGACY_SCORING_REF } from "./legacy-scoring.ts";
import { MODEL_PRESETS } from "./models.ts";
import { DEFAULT_RUN_SETTINGS } from "./runner.ts";
import { LEGACY_UNIVERSE_ID, SYNTHETIC_RULE } from "./universe.ts";

export type StudyCliOptions = {
  seasons: number[];
  weeks: { from: number; to: number };
  role: StudyRole;
  inputDir: string;
  outDir: string;
  offline: boolean;
  refresh: boolean;
  pinInputs: string[];
  scoring: string;
  universe: string;
  models: string;
  seed: number;
  resamples: number;
  minHistoryGames: number;
  qbLag: boolean;
  /** Legacy wrappers only: where the old-shape study file goes. */
  legacyOut: string | null;
  help: boolean;
};

export const STUDY_USAGE = `Usage: npm run study:build -- --seasons <list> --role <role> [options]
       node --experimental-strip-types scripts/study.ts --seasons <list> --role <role> [options]

  --seasons 2023,2024,2025 | 2023-2025  seasons to evaluate, one run each (--season also works)
  --weeks 2-18                          week range (default 2-18)
  --role development|holdout|retrospective
                                        required label for how these seasons are being used
  --input-dir <dir>                     source cache (default .study-cache)
  --out-dir <dir>                       run artifacts (default artifacts/study)
  --offline                             read only the cache; fail when an input is absent
  --refresh                             fetch sources again even when cached
  --pin-inputs <file>[,<file>]          require the input hashes recorded in earlier run or meta files
  --scoring <ref>                       ${RULESET_REF} (default) or ${LEGACY_SCORING_REF} (attribution only)
  --universe <rule>                     ${SYNTHETIC_RULE} (default), ${LEGACY_UNIVERSE_ID}[:<fantasy.json>],
                                        or frozen:<universe.json>
  --models <preset|file.json>           ${Object.keys(MODEL_PRESETS).join(", ")} (default core)
  --seed <n>                            bootstrap seed (default ${DEFAULT_RUN_SETTINGS.uncertainty.seed})
  --resamples <n>                       bootstrap resamples (default ${DEFAULT_RUN_SETTINGS.uncertainty.resamples})
  --min-history <n>                     scored games before the cutoff to join a slate (default 1)
  --qb-lag                              also write the QB week-to-week lag artifact
  --help`;

export type WrapperDefaults = { models: string; qbLag: boolean; season: number };

function int(name: string, raw: string, min: number, max: number): number {
  if (!/^\d+$/.test(raw)) throw new StudyConfigError(`--${name} must be a whole number, got ${JSON.stringify(raw)}`);
  const n = Number(raw);
  if (n < min || n > max) throw new StudyConfigError(`--${name} must be between ${min} and ${max}, got ${n}`);
  return n;
}

export function parseSeasons(raw: string): number[] {
  const range = /^(\d{4})-(\d{4})$/.exec(raw);
  let seasons: number[];
  if (range) {
    const [from, to] = [int("seasons", range[1]!, 1999, 2100), int("seasons", range[2]!, 1999, 2100)];
    if (from > to) throw new StudyConfigError(`--seasons range ${raw} runs backwards`);
    seasons = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  } else {
    seasons = raw.split(",").map((s) => int("seasons", s.trim(), 1999, 2100));
  }
  if (new Set(seasons).size !== seasons.length) throw new StudyConfigError(`--seasons ${raw} repeats a season`);
  return seasons.sort((a, b) => a - b);
}

export function parseWeeks(raw: string): { from: number; to: number } {
  const m = /^(\d{1,2})(?:-(\d{1,2}))?$/.exec(raw);
  if (!m) throw new StudyConfigError(`--weeks must look like 2-18, got ${JSON.stringify(raw)}`);
  const from = int("weeks", m[1]!, 1, 22);
  const to = m[2] ? int("weeks", m[2], 1, 22) : from;
  if (from > to) throw new StudyConfigError(`--weeks ${raw} runs backwards`);
  return { from, to };
}

/** Parses study arguments. Relative paths resolve against cwd; defaults live under the repo root. */
export function parseStudyArgs(argv: string[], ctx: { repoRoot: string; cwd?: string; wrapper?: WrapperDefaults }): StudyCliOptions {
  const cwd = ctx.cwd ?? process.cwd();
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        season: { type: "string" },
        seasons: { type: "string" },
        weeks: { type: "string" },
        role: { type: "string" },
        "input-dir": { type: "string" },
        "out-dir": { type: "string" },
        offline: { type: "boolean" },
        refresh: { type: "boolean" },
        "pin-inputs": { type: "string" },
        scoring: { type: "string" },
        universe: { type: "string" },
        models: { type: "string" },
        seed: { type: "string" },
        resamples: { type: "string" },
        "min-history": { type: "string" },
        "qb-lag": { type: "boolean" },
        "legacy-out": { type: "string" },
        help: { type: "boolean" },
      },
    }));
  } catch (e) {
    throw new StudyConfigError((e as Error).message);
  }
  const help = values.help === true;
  const wrapper = ctx.wrapper;
  if (values.season && values.seasons) throw new StudyConfigError("use --season or --seasons, not both");
  const seasonArg = values.seasons ?? values.season;
  let seasons: number[];
  if (seasonArg) seasons = parseSeasons(seasonArg);
  else if (wrapper) seasons = [wrapper.season];
  else if (help) seasons = [];
  else throw new StudyConfigError("--seasons is required (for example --seasons 2023,2024,2025)");
  if (wrapper && seasons.length !== 1) throw new StudyConfigError("this wrapper runs exactly one season");
  if (wrapper && values.models) throw new StudyConfigError(`this wrapper always uses the ${wrapper.models} preset; use scripts/study.ts for other models`);
  if (!wrapper && values["legacy-out"]) throw new StudyConfigError("--legacy-out is only for the legacy wrapper scripts");

  const role = values.role ?? (wrapper ? "retrospective" : undefined);
  if (!help && role !== "development" && role !== "holdout" && role !== "retrospective") {
    throw new StudyConfigError("--role must be development, holdout or retrospective");
  }
  const scoring = values.scoring ?? RULESET_REF;
  if (scoring !== RULESET_REF && scoring !== LEGACY_SCORING_REF) {
    throw new StudyConfigError(`--scoring must be ${RULESET_REF} or ${LEGACY_SCORING_REF}`);
  }
  if (values.offline && values.refresh) throw new StudyConfigError("--offline and --refresh cannot be combined");
  return {
    seasons,
    weeks: parseWeeks(values.weeks ?? "2-18"),
    role: (role ?? "retrospective") as StudyRole,
    inputDir: values["input-dir"] ? resolve(cwd, values["input-dir"]) : resolve(ctx.repoRoot, ".study-cache"),
    outDir: values["out-dir"] ? resolve(cwd, values["out-dir"]) : resolve(ctx.repoRoot, "artifacts", "study"),
    offline: values.offline === true,
    refresh: values.refresh === true,
    pinInputs: values["pin-inputs"] ? values["pin-inputs"].split(",").map((p) => resolve(cwd, p.trim())) : [],
    scoring,
    universe: values.universe ?? (wrapper ? LEGACY_UNIVERSE_ID : SYNTHETIC_RULE),
    models: wrapper ? wrapper.models : (values.models ?? "core"),
    seed: values.seed ? int("seed", values.seed, 0, 0xffffffff) : DEFAULT_RUN_SETTINGS.uncertainty.seed,
    resamples: values.resamples ? int("resamples", values.resamples, 100, 1_000_000) : DEFAULT_RUN_SETTINGS.uncertainty.resamples,
    minHistoryGames: values["min-history"] ? int("min-history", values["min-history"], 1, 18) : DEFAULT_RUN_SETTINGS.minHistoryGames,
    qbLag: wrapper ? wrapper.qbLag : values["qb-lag"] === true,
    legacyOut: values["legacy-out"] ? resolve(cwd, values["legacy-out"]) : null,
    help,
  };
}

/** A one-line message for expected failures, the stack for anything else. */
export function describeFailure(e: unknown): string {
  const known = [StudyInputError, StudyConfigError, CsvColumnError, CsvValueError, CsvFormatError];
  if (known.some((k) => e instanceof k)) return `error: ${(e as Error).message}`;
  return e instanceof Error ? (e.stack ?? e.message) : String(e);
}
