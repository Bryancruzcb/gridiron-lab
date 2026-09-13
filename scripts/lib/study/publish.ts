// Publication adapters: the compact multi-season file the study page reads and the committed input
// manifest. Both are built only from verified run artifacts (and their meta files), never by hand.

import type {
  StudyInputManifestFile,
  StudyQbLagArtifact,
  StudyRunArtifact,
  StudyRunMeta,
  StudySeasonPool,
  StudySeasonRow,
  StudySeasonsFile,
} from "../../../src/data/types.ts";
import { StudyConfigError } from "./errors.ts";
import { canonicalJson, hashJson } from "./hash.ts";
import { buildMultiSeason, verifyRunArtifact } from "./report.ts";

export const SEASONS_SCHEMA = "gridiron-lab-study-seasons@1";
export const MANIFEST_SCHEMA = "gridiron-lab-study-input-manifest@1";

/** Throws when a QB lag artifact's hash does not match its content. */
export function verifyQbLagArtifact(lag: StudyQbLagArtifact): void {
  const { resultSha256, ...body } = lag;
  if (hashJson(body) !== resultSha256) throw new StudyConfigError(`QB lag ${lag.season}: resultSha256 does not match the content`);
}

function seasonRow(a: StudyRunArtifact, lag: StudyQbLagArtifact | null): StudySeasonRow {
  if (lag) {
    const player = a.run.inputs.find((i) => i.role === "player-week" && i.season === a.run.season);
    const lagInput = lag.inputs.find((i) => i.role === "player-week");
    if (!player || !lagInput || player.sha256 !== lagInput.sha256) {
      throw new StudyConfigError(`QB lag ${lag.season} was built from different player-week bytes than ${a.runId}`);
    }
  }
  return {
    season: a.run.season,
    role: a.run.role,
    runId: a.runId,
    resultSha256: a.resultSha256,
    universe: a.run.universe,
    cap: a.run.solver.cap,
    weeks: a.run.weeks,
    summary: a.summary,
    weekly: a.weeks
      .filter((w) => w.comparable)
      .map((w) => ({
        week: w.week,
        slate: w.slate.length,
        lineups: Object.fromEntries(w.models.map((m) => [m.model, { proj: m.lineup!.proj, actual: m.lineup!.actual! }])),
      })),
    qbLag: lag && { n: lag.n, minAttempts: lag.minAttempts, corrEpa: lag.corrEpa, corrCpoe: lag.corrCpoe, resultSha256: lag.resultSha256 },
  };
}

function sameConfig(a: StudyRunArtifact, b: StudyRunArtifact): boolean {
  return (
    canonicalJson(a.run.models) === canonicalJson(b.run.models) &&
    a.run.baselineModel === b.run.baselineModel &&
    a.run.scoring.ref === b.run.scoring.ref &&
    a.run.pipeline === b.run.pipeline &&
    a.run.solver.ref === b.run.solver.ref &&
    canonicalJson(a.run.uncertainty) === canonicalJson(b.run.uncertainty)
  );
}

function pool(runs: readonly StudyRunArtifact[]): StudySeasonPool {
  const multi = buildMultiSeason(runs);
  return {
    seasons: multi.runs.map((r) => r.season),
    roles: multi.runs.map((r) => r.role),
    runIds: multi.runs.map((r) => r.runId),
    resultSha256: multi.resultSha256,
    summary: multi.pooled,
  };
}

/**
 * One row per season run (one locked configuration), pooled summaries over every run and over the
 * development runs, and optionally the shipped-slate comparison run. Every run is verified first.
 */
export function buildSeasonsFile(input: {
  runs: readonly StudyRunArtifact[];
  shippedSlate?: StudyRunArtifact | null;
  qbLags?: readonly StudyQbLagArtifact[];
}): StudySeasonsFile {
  const runs = [...input.runs].sort((a, b) => a.run.season - b.run.season);
  if (!runs.length) throw new StudyConfigError("publish needs at least one run");
  const all = input.shippedSlate ? [...runs, input.shippedSlate] : runs;
  for (const a of all) {
    verifyRunArtifact(a);
    if (a.run.scoring.legacyAttributionOnly) throw new StudyConfigError(`${a.runId} uses attribution-only scoring and cannot be published`);
    if (!sameConfig(a, runs[0]!)) {
      throw new StudyConfigError(`${a.runId} (${a.run.season}) differs from ${runs[0]!.runId} in models, baseline, scoring, pipeline, solver or uncertainty`);
    }
  }
  if (new Set(runs.map((a) => a.run.universe.rule)).size > 1) {
    throw new StudyConfigError("season runs use different universe rules; publish one rule per file and pass the other as --shipped-slate");
  }
  const lags = new Map<number, StudyQbLagArtifact>();
  for (const lag of input.qbLags ?? []) {
    verifyQbLagArtifact(lag);
    if (lags.has(lag.season)) throw new StudyConfigError(`QB lag ${lag.season} is given twice`);
    if (!runs.some((a) => a.run.season === lag.season)) throw new StudyConfigError(`QB lag ${lag.season} has no season run`);
    lags.set(lag.season, lag);
  }

  const pools: StudySeasonPool[] = [];
  const development = runs.filter((a) => a.run.role === "development");
  if (development.length >= 2 && development.length < runs.length) pools.push(pool(development));
  if (runs.length >= 2) pools.push(pool(runs));

  const first = runs[0]!;
  const body: Omit<StudySeasonsFile, "resultSha256"> = {
    schemaVersion: SEASONS_SCHEMA,
    pipeline: first.run.pipeline,
    scoring: first.run.scoring.ref,
    solver: first.run.solver.ref,
    models: first.run.models,
    baselineModel: first.run.baselineModel,
    uncertainty: first.run.uncertainty,
    minHistoryGames: first.run.minHistoryGames,
    policies: first.run.policies,
    seasons: runs.map((a) => seasonRow(a, lags.get(a.run.season) ?? null)),
    pools,
    shippedSlate: input.shippedSlate ? seasonRow(input.shippedSlate, null) : null,
  };
  return { ...body, resultSha256: hashJson(body) };
}

/**
 * Merges the input entries of run meta files: one entry per (id, sha256) with the earliest
 * retrieval and the run ids that read it. A meta must describe the artifact it is paired with.
 * A previous manifest keeps the first recorded retrieval of identical bytes, so republishing from
 * rerun meta files is idempotent; its entries that no current run reads are dropped.
 */
export function buildInputManifest(
  pairs: readonly { artifact: StudyRunArtifact; meta: StudyRunMeta }[],
  previous: StudyInputManifestFile | null = null,
): StudyInputManifestFile {
  const merged = new Map<string, StudyInputManifestFile["inputs"][number]>();
  for (const { artifact, meta } of pairs) {
    if (meta.runId !== artifact.runId || meta.resultSha256 !== artifact.resultSha256) {
      throw new StudyConfigError(`meta for ${meta.runId} does not describe ${artifact.runId}`);
    }
    const expected = new Map(artifact.run.inputs.map((i) => [`${i.id}|${i.sha256}`, canonicalJson(i)]));
    for (const entry of meta.inputs) {
      const key = `${entry.id}|${entry.sha256}`;
      const { localPath, retrievedAt, http, ...identity } = entry;
      if (expected.has(key) && expected.get(key) !== canonicalJson(identity)) {
        throw new StudyConfigError(`${meta.runId}: meta entry ${entry.id} disagrees with the run's input identity`);
      }
      const known = merged.get(key);
      if (!known) {
        merged.set(key, { ...identity, localPath, retrievedAt, http, usedBy: [artifact.runId] });
        continue;
      }
      const { localPath: _l, retrievedAt: _r, http: _h, usedBy, ...knownIdentity } = known;
      if (canonicalJson(knownIdentity) !== canonicalJson(identity) || known.localPath !== localPath) {
        throw new StudyConfigError(`input ${entry.id} ${entry.sha256} is described two different ways`);
      }
      const earlier = retrievedAt < known.retrievedAt;
      merged.set(key, {
        ...known,
        retrievedAt: earlier ? retrievedAt : known.retrievedAt,
        http: earlier ? http : known.http,
        usedBy: [...new Set([...usedBy, artifact.runId])].sort(),
      });
    }
  }
  for (const old of previous?.inputs ?? []) {
    const key = `${old.id}|${old.sha256}`;
    const current = merged.get(key);
    if (current && current.localPath === old.localPath && old.retrievedAt < current.retrievedAt) {
      merged.set(key, { ...current, retrievedAt: old.retrievedAt, http: old.http });
    }
  }
  const inputs = [...merged.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : 0));
  return {
    schemaVersion: MANIFEST_SCHEMA,
    cache:
      "Raw bytes are not committed. Fetched inputs live in the gitignored study cache at snapshots/<sha256>/<file>; " +
      "a run with --offline --pin-inputs <this file> reads exactly these hashes.",
    inputs,
  };
}
