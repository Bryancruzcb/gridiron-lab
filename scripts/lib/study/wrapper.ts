// Shared body of the legacy script names (build-study, compare-proj, compare-ewma): one season on
// a fixed preset through the study library, then the old-shape file the study page reads.

import { writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import type { StudyRunArtifact } from "../../../src/data/types.ts";
import { describeFailure, parseStudyArgs, STUDY_USAGE, type StudyCliOptions } from "./cli.ts";
import { runStudyCommand, type StudyCommandContext } from "./command.ts";
import { StudyConfigError } from "./errors.ts";
import type { LegacyFileOptions } from "./legacy-files.ts";
import { LEGACY_SCORING_REF } from "./legacy-scoring.ts";

export type LegacyWrapper = {
  repoRoot: string;
  argv: string[];
  models: string;
  qbLag: boolean;
  /** Repo-relative default for --legacy-out. */
  defaultOut: string;
  toLegacy: (artifact: StudyRunArtifact, opts: LegacyFileOptions) => unknown;
  pretty: boolean;
  log?: (message: string) => void;
  /** Tests inject the clock, the source state and a network stub. */
  context?: Pick<StudyCommandContext, "fetchImpl" | "now" | "sourceState">;
};

/** Whether a path is the study page's data directory or inside it. */
export function isInPageData(repoRoot: string, path: string): boolean {
  const rel = relative(join(repoRoot, "src", "data"), path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Attribution-only scoring never reaches src/data: it needs an explicit --legacy-out outside it. */
export function checkLegacyOutput(opts: Pick<StudyCliOptions, "scoring" | "legacyOut">, repoRoot: string): void {
  if (opts.scoring !== LEGACY_SCORING_REF) return;
  if (opts.legacyOut && !isInPageData(repoRoot, opts.legacyOut)) return;
  throw new StudyConfigError(
    `${LEGACY_SCORING_REF} is attribution-only and its numbers never go into src/data; ` +
      `pass --legacy-out <file> outside src/data (for example artifacts/attribution/study-backtest.json)`,
  );
}

/** Runs the wrapper and returns the files it wrote; throws on any failure. */
export async function legacyWrapperMain(w: LegacyWrapper): Promise<string[]> {
  const log = w.log ?? ((m: string) => console.log(m));
  const opts = parseStudyArgs(w.argv, { repoRoot: w.repoRoot, wrapper: { models: w.models, qbLag: w.qbLag, season: 2025 } });
  if (opts.help) {
    log(`${STUDY_USAGE}\n\nWrapper defaults: --season 2025 --role retrospective --universe legacy-fantasy-json --models ${w.models}` +
      `\n  --legacy-out <file>                   old-shape output (default ${w.defaultOut}; required outside src/data with ${LEGACY_SCORING_REF})`);
    return [];
  }
  checkLegacyOutput(opts, w.repoRoot);
  const result = await runStudyCommand(opts, { repoRoot: w.repoRoot, command: w.argv, log, ...w.context });
  const out = opts.legacyOut ?? join(w.repoRoot, w.defaultOut);
  const legacy = w.toLegacy(result.runs[0]!.artifact, { allowAttributionOnly: !isInPageData(w.repoRoot, out) });
  writeFileSync(out, w.pretty ? JSON.stringify(legacy, null, 2) : JSON.stringify(legacy));
  log(`wrote ${out}`);
  const written = [out];
  for (const lag of result.qbLag) {
    const lagOut = opts.legacyOut ? `${out.replace(/\.json$/, "")}-qb-lag.json` : join(w.repoRoot, "src", "data", "study-qb-lag.json");
    const { schemaVersion: _schema, inputs: _inputs, resultSha256: _hash, ...file } = lag.artifact;
    writeFileSync(lagOut, JSON.stringify(file));
    log(`wrote ${lagOut}`);
    written.push(lagOut);
  }
  return written;
}

export async function runLegacyWrapper(w: LegacyWrapper): Promise<void> {
  try {
    await legacyWrapperMain(w);
  } catch (e) {
    console.error(describeFailure(e));
    process.exitCode = 1;
  }
}
