// Adapters from a versioned run artifact to the legacy study-*.json shapes the study page reads
// today. Numbers come from the run's common weeks and stored records, rounded to the old precision.

import type {
  BacktestFile,
  EwmaFile,
  EwmaPoint,
  ProjectionFile,
  StudyModelSummary,
  StudyRunArtifact,
  StudyWeekRecord,
} from "../../../src/data/types.ts";
import { StudyConfigError } from "./errors.ts";
import { mean, median, round } from "./stats.ts";

function modelSummary(a: StudyRunArtifact, id: string): StudyModelSummary {
  const m = a.summary.models.find((x) => x.model === id);
  if (!m) throw new StudyConfigError(`${a.runId} has no model ${id}`);
  if (!m.weeks || m.playerError.mae == null || m.playerError.rmse == null || m.lineupActualMean == null || m.lineupActualMedian == null) {
    throw new StudyConfigError(`${a.runId}: model ${id} has no common weeks to summarize`);
  }
  return m;
}

function provenanceNote(a: StudyRunArtifact): string {
  const u = a.run.universe;
  return (
    `Run ${a.runId} (${a.run.pipeline}, ${a.run.role}), scoring ${a.run.scoring.ref}, universe ${u.id} ` +
    `(${u.players} players${u.lookAhead ? ", selected and priced with look-ahead" : ""}), solver ${a.run.solver.ref} strict.`
  );
}

function exclusionNote(a: StudyRunArtifact): string {
  const ex = a.summary.excludedWeeks;
  if (!ex.length) return `All ${a.summary.commonWeeks.length} weeks in ${a.run.weeks.from}-${a.run.weeks.to} are compared.`;
  const parts = ex.map((w) => `week ${w.week} (${[...new Set(w.exclusions.map((e) => e.reason))].join(", ")})`);
  return `Compared on ${a.summary.commonWeeks.length} common weeks; excluded for every method: ${parts.join("; ")}.`;
}

export function toBacktestFile(a: StudyRunArtifact): BacktestFile {
  const ids = { exact: "trail", greedyProj: "trail-greedy-proj", greedyValue: "trail-greedy-value" } as const;
  for (const id of Object.values(ids)) modelSummary(a, id);
  const pack = (w: StudyWeekRecord, id: string) => {
    const lineup = w.models.find((m) => m.model === id)!.lineup!;
    return { proj: round(lineup.proj, 1), actual: round(lineup.actual!, 1), salary: lineup.salary };
  };
  const weeks = a.weeks
    .filter((w) => w.comparable)
    .map((w) => ({
      week: w.week,
      players: w.slate.length,
      exact: pack(w, ids.exact),
      greedyProj: pack(w, ids.greedyProj),
      greedyValue: pack(w, ids.greedyValue),
    }));
  const actual = (key: "exact" | "greedyProj" | "greedyValue") => weeks.map((w) => w[key].actual);
  return {
    source: `nflverse player week + team week ${a.run.season} REG`,
    season: a.run.season,
    cap: a.run.solver.cap,
    notes: [
      "Salaries are synthetic DraftKings-style prices, frozen all year, not live DK prices.",
      "Projection is the trailing mean over the weeks before each week's cutoff.",
      exclusionNote(a),
      provenanceNote(a),
    ],
    weeks,
    summary: {
      weeks: weeks.length,
      exactMean: round(mean(actual("exact"))!, 1),
      exactMedian: round(median(actual("exact"))!, 1),
      greedyProjMean: round(mean(actual("greedyProj"))!, 1),
      greedyValueMean: round(mean(actual("greedyValue"))!, 1),
      exactBeatsProj: weeks.filter((w) => w.exact.actual > w.greedyProj.actual).length,
      exactBeatsValue: weeks.filter((w) => w.exact.actual > w.greedyValue.actual).length,
    },
  };
}

function point(m: StudyModelSummary): Omit<EwmaPoint, "alpha"> {
  return {
    mae: round(m.playerError.mae!, 2),
    rmse: round(m.playerError.rmse!, 2),
    n: m.playerError.n,
    lineupMean: round(m.lineupActualMean!, 1),
    lineupMedian: round(m.lineupActualMedian!, 1),
    weeks: m.weeks,
  };
}

export function toProjectionFile(a: StudyRunArtifact): ProjectionFile {
  const models = a.run.models
    .filter((m) => m.solver === "exact-dp")
    .map((m) => ({ id: m.id, label: m.label, ...point(modelSummary(a, m.id)) }));
  return {
    source: `nflverse ${a.run.season} REG, universe ${a.run.universe.id}`,
    season: a.run.season,
    notes: [
      "Each model only uses weeks before the cutoff. Opponent for week w is the scheduled opponent from the schedule.",
      "MAE is per slate player-week with a stat row, over the common weeks. Lineup mean is the strict exact-DP lineup's actual points.",
      exclusionNote(a),
      provenanceNote(a),
    ],
    models,
  };
}

export function toEwmaFile(a: StudyRunArtifact): EwmaFile {
  const points: EwmaPoint[] = a.run.models
    .filter((m) => m.method === "ewma" && m.solver === "exact-dp")
    .map((m) => ({ alpha: m.params.alpha!, ...point(modelSummary(a, m.id)) }))
    .sort((x, y) => x.alpha - y.alpha);
  if (!points.length) throw new StudyConfigError(`${a.runId} has no exact-dp EWMA models`);
  const bestLineup = points.reduce((best, p) => (p.lineupMean > best.lineupMean ? p : best));
  const bestMae = points.reduce((best, p) => (p.mae < best.mae ? p : best));
  return {
    source: `nflverse ${a.run.season} REG, EWMA on trailing points, universe ${a.run.universe.id}`,
    season: a.run.season,
    note:
      "α=1 is last week only. Trailing mean is not α=0: small α sticks to week 1. This sweep is exploratory on the season it " +
      `was run on; the best α is not a preselected result. ${exclusionNote(a)}`,
    trail: point(modelSummary(a, "trail")),
    points,
    bestLineup: { alpha: bestLineup.alpha, lineupMean: bestLineup.lineupMean, mae: bestLineup.mae },
    bestMae: { alpha: bestMae.alpha, mae: bestMae.mae, lineupMean: bestMae.lineupMean },
  };
}
