// Shared body of the legacy script names (build-study, compare-proj, compare-ewma): one season on
// a fixed preset through the study library, then the old-shape file the study page reads.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StudyRunArtifact } from "../../../src/data/types.ts";
import { describeFailure, parseStudyArgs, STUDY_USAGE } from "./cli.ts";
import { runStudyCommand } from "./command.ts";

export type LegacyWrapper = {
  repoRoot: string;
  argv: string[];
  models: string;
  qbLag: boolean;
  /** Repo-relative default for --legacy-out. */
  defaultOut: string;
  toLegacy: (artifact: StudyRunArtifact) => unknown;
  pretty: boolean;
};

export async function runLegacyWrapper(w: LegacyWrapper): Promise<void> {
  try {
    const opts = parseStudyArgs(w.argv, { repoRoot: w.repoRoot, wrapper: { models: w.models, qbLag: w.qbLag, season: 2025 } });
    if (opts.help) {
      console.log(`${STUDY_USAGE}\n\nWrapper defaults: --season 2025 --role retrospective --universe legacy-fantasy-json --models ${w.models}` +
        `\n  --legacy-out <file>                   old-shape output (default ${w.defaultOut})`);
      return;
    }
    const result = await runStudyCommand(opts, { repoRoot: w.repoRoot, command: w.argv, log: (m) => console.log(m) });
    const out = opts.legacyOut ?? join(w.repoRoot, w.defaultOut);
    const legacy = w.toLegacy(result.runs[0]!.artifact);
    writeFileSync(out, w.pretty ? JSON.stringify(legacy, null, 2) : JSON.stringify(legacy));
    console.log(`wrote ${out}`);
    for (const lag of result.qbLag) {
      const lagOut = opts.legacyOut ? `${out.replace(/\.json$/, "")}-qb-lag.json` : join(w.repoRoot, "src", "data", "study-qb-lag.json");
      const { schemaVersion: _schema, inputs: _inputs, resultSha256: _hash, ...file } = lag.artifact;
      writeFileSync(lagOut, JSON.stringify(file));
      console.log(`wrote ${lagOut}`);
    }
  } catch (e) {
    console.error(describeFailure(e));
    process.exitCode = 1;
  }
}
