// Summaries computed only from stored per-week records, run identity, sealing and a short text
// report. Anything here can be recomputed from a written artifact.

import type {
  StudyModelSpec,
  StudyModelWeek,
  StudyMultiSeasonArtifact,
  StudyPairedComparison,
  StudyRun,
  StudyRunArtifact,
  StudyRunSummary,
  StudyWeekRecord,
} from "../../../src/data/types.ts";
import { StudyConfigError } from "./errors.ts";
import { canonicalJson, hashJson } from "./hash.ts";
import { bootstrapMeanInterval, mean, median, ROUNDING, round } from "./stats.ts";

/** The run id: a prefix of the hash of everything that determines results. Timestamps are never part of it. */
export function runIdOf(run: StudyRun): string {
  return `run-${hashJson(run).slice(0, 16)}`;
}

export function sealRun(body: Omit<StudyRunArtifact, "resultSha256">): StudyRunArtifact {
  return { ...body, resultSha256: hashJson(body) };
}

/** Canonical JSON plus a newline: identical semantic content gives identical bytes. */
export function serializeArtifact(value: unknown): string {
  return `${canonicalJson(value)}\n`;
}

function comparableModelWeek(week: StudyWeekRecord, id: string): StudyModelWeek & { lineup: { actual: number } } {
  const mw = week.models.find((m) => m.model === id);
  if (!mw?.lineup || mw.lineup.actual == null) {
    throw new Error(`${week.season} week ${week.week} is marked comparable but ${id} has no complete lineup`);
  }
  return mw as StudyModelWeek & { lineup: { actual: number } };
}

const summaryRound = (x: number | null) => (x == null ? null : round(x, ROUNDING.summary));

/** Weekly lineup actual of model minus baseline, rounded to points precision, in week order. */
export function pairedDiffs(common: readonly StudyWeekRecord[], model: string, baseline: string): number[] {
  return common.map((w) =>
    round(comparableModelWeek(w, model).lineup.actual - comparableModelWeek(w, baseline).lineup.actual, ROUNDING.points),
  );
}

export function summarizeWeeks(
  weeks: readonly StudyWeekRecord[],
  models: readonly StudyModelSpec[],
  baseline: string,
  uncertainty: StudyRun["uncertainty"],
): StudyRunSummary {
  const common = weeks.filter((w) => w.comparable);
  const summaries = models.map((m) => {
    let validWeeks = 0;
    for (const w of weeks) {
      const mw = w.models.find((x) => x.model === m.id);
      if (mw?.solver.status === "ok" && mw.lineup?.actual != null) validWeeks += 1;
    }
    const actuals: number[] = [];
    const projs: number[] = [];
    const abs: number[] = [];
    const squared: number[] = [];
    const signed: number[] = [];
    for (const w of common) {
      const mw = comparableModelWeek(w, m.id);
      actuals.push(mw.lineup.actual);
      projs.push(mw.lineup.proj);
      w.slate.forEach((p, i) => {
        if (p.status !== "played" || p.points == null) return;
        const e = mw.projections[i]! - p.points;
        abs.push(Math.abs(e));
        squared.push(e * e);
        signed.push(e);
      });
    }
    const meanSquared = mean(squared);
    return {
      model: m.id,
      label: m.label,
      solver: m.solver,
      validWeeks,
      weeks: common.length,
      lineupActualMean: summaryRound(mean(actuals)),
      lineupActualMedian: summaryRound(median(actuals)),
      lineupProjMean: summaryRound(mean(projs)),
      playerError: {
        n: abs.length,
        mae: summaryRound(mean(abs)),
        rmse: summaryRound(meanSquared == null ? null : Math.sqrt(meanSquared)),
        bias: summaryRound(mean(signed)),
      },
    };
  });
  const paired: StudyPairedComparison[] = models
    .filter((m) => m.id !== baseline)
    .map((m) => {
      const diffs = pairedDiffs(common, m.id, baseline);
      const interval = bootstrapMeanInterval(diffs, uncertainty);
      return {
        model: m.id,
        baseline,
        n: diffs.length,
        meanDiff: summaryRound(mean(diffs)),
        medianDiff: summaryRound(median(diffs)),
        wins: diffs.filter((d) => d > 0).length,
        losses: diffs.filter((d) => d < 0).length,
        ties: diffs.filter((d) => d === 0).length,
        interval: interval && {
          level: interval.level,
          low: round(interval.low, ROUNDING.summary),
          high: round(interval.high, ROUNDING.summary),
        },
      };
    });
  return {
    commonWeeks: common.map((w) => ({ season: w.season, week: w.week })),
    excludedWeeks: weeks.filter((w) => !w.comparable).map((w) => ({ season: w.season, week: w.week, exclusions: w.exclusions })),
    rounding: { ...ROUNDING },
    models: summaries,
    paired,
  };
}

/** Throws when an artifact's id, result hash or summary does not match its own records. */
export function verifyRunArtifact(artifact: StudyRunArtifact): void {
  const { resultSha256, ...body } = artifact;
  if (runIdOf(artifact.run) !== artifact.runId) throw new Error(`${artifact.runId}: run id does not match the run configuration`);
  if (hashJson(body) !== resultSha256) throw new Error(`${artifact.runId}: resultSha256 does not match the content`);
  const recomputed = summarizeWeeks(artifact.weeks, artifact.run.models, artifact.run.baselineModel, artifact.run.uncertainty);
  if (canonicalJson(recomputed) !== canonicalJson(artifact.summary)) {
    throw new Error(`${artifact.runId}: summary does not recompute from the per-week records`);
  }
}

/** Pools several seasons run with one locked model list, baseline, scoring and uncertainty setting. */
export function buildMultiSeason(runs: readonly StudyRunArtifact[]): StudyMultiSeasonArtifact {
  if (runs.length < 2) throw new StudyConfigError("a multi-season summary needs at least two runs");
  const sorted = [...runs].sort((a, b) => a.run.season - b.run.season);
  const first = sorted[0]!;
  const modelsSha256 = hashJson(first.run.models);
  const seasons = new Set<number>();
  for (const a of sorted) {
    if (seasons.has(a.run.season)) throw new StudyConfigError(`season ${a.run.season} appears in two runs`);
    seasons.add(a.run.season);
    const same =
      hashJson(a.run.models) === modelsSha256 &&
      a.run.baselineModel === first.run.baselineModel &&
      a.run.scoring.ref === first.run.scoring.ref &&
      canonicalJson(a.run.uncertainty) === canonicalJson(first.run.uncertainty);
    if (!same) {
      throw new StudyConfigError(
        `${a.runId} (${a.run.season}) differs from ${first.runId} in models, baseline, scoring or uncertainty; pooling needs one locked configuration`,
      );
    }
  }
  const body = {
    schemaVersion: "gridiron-lab-study-multi@1" as const,
    runs: sorted.map((a) => ({
      season: a.run.season,
      runId: a.runId,
      resultSha256: a.resultSha256,
      role: a.run.role,
      commonWeeks: a.summary.commonWeeks.length,
    })),
    modelsSha256,
    baselineModel: first.run.baselineModel,
    uncertainty: first.run.uncertainty,
    pooled: summarizeWeeks(
      sorted.flatMap((a) => a.weeks),
      first.run.models,
      first.run.baselineModel,
      first.run.uncertainty,
    ),
  };
  return { ...body, resultSha256: hashJson(body) };
}

const fmt = (x: number | null, width: number) => (x == null ? "-" : String(x)).padStart(width);

/** A short plain-text table for the terminal. */
export function formatSummary(title: string, summary: StudyRunSummary, uncertainty: StudyRun["uncertainty"]): string {
  const lines = [title];
  lines.push(`common weeks: ${summary.commonWeeks.map((w) => `${w.season}/${w.week}`).join(" ") || "none"}`);
  for (const ex of summary.excludedWeeks) {
    const reasons = ex.exclusions.map((e) => `${e.reason}${e.model ? ` ${e.model}` : ""}`);
    lines.push(`excluded ${ex.season}/${ex.week}: ${[...new Set(reasons)].join("; ")}`);
  }
  lines.push(`${"model".padEnd(22)}${"solver".padEnd(14)}${"weeks".padStart(6)}${"mean".padStart(9)}${"median".padStart(9)}${"MAE".padStart(8)}${"n".padStart(7)}`);
  for (const m of summary.models) {
    lines.push(
      `${m.model.padEnd(22)}${m.solver.padEnd(14)}${fmt(m.weeks, 6)}${fmt(m.lineupActualMean, 9)}${fmt(m.lineupActualMedian, 9)}${fmt(m.playerError.mae, 8)}${fmt(m.playerError.n, 7)}`,
    );
  }
  if (summary.paired.length) {
    lines.push(`paired weekly lineup differences (${Math.round(uncertainty.level * 100)}% week bootstrap, ${uncertainty.resamples} resamples, seed ${uncertainty.seed}):`);
    for (const p of summary.paired) {
      const ci = p.interval ? `[${p.interval.low}, ${p.interval.high}]` : "n/a";
      lines.push(`  ${p.model} - ${p.baseline}: n=${p.n} mean=${p.meanDiff ?? "-"} median=${p.medianDiff ?? "-"} ${ci} W-L-T ${p.wins}-${p.losses}-${p.ties}`);
    }
  }
  return lines.join("\n");
}
