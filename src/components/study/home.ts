// The homepage's view model: one pure calculation from the committed study files to everything the
// first screen states (the finding, the season-by-season miss chart, the ranked methods). A missing
// model or comparison becomes an error value instead of a thrown exception, so the page can say so.
import type { StudyRunSummary, StudySeasonsFile } from "@/data/types";
import { COMPUTER, EWMA, ROLE_WORDS, TOP_NAMES, computerOver, countWord, model, overComputer, type Gap } from "./calc.ts";

export type MethodRow = {
  id: string;
  label: string;
  /** Player MAE: the average |guess − real points| per played player-week. */
  mae: number;
  /** Mean weekly lineup score under the retired synthetic-salary cap (archive only). */
  team: number;
  /** Weekly team-score gap to the trailing mean, with its 95% range; null for the trailing mean itself. */
  gap: Gap | null;
};

export type MissView = {
  key: string;
  /** Short label for the season pill. */
  pill: string;
  /** Longer label for the caption. */
  title: string;
  note: string;
  weeks: number;
  playerWeeks: number;
  /** Player MAE by model id. */
  mae: Record<string, number>;
  bestId: string;
};

export type StudyHome = {
  /** "2023–2025" (the pooled seasons). */
  label: string;
  seasonCount: number;
  weeks: number;
  playerWeeks: number;
  /** Every method, best (lowest player MAE) first. */
  methods: MethodRow[];
  best: MethodRow;
  /** Bias of the trailing mean's player guesses (mean of guess minus real). */
  trailBias: number;
  /** True when the pooled winner also has the lowest MAE in every season and on the shipped slate. */
  bestEverywhere: boolean;
  /** Pooled view first, then each season, then the shipped slate. */
  views: MissView[];
  /** Axis for the miss chart: half-point steps around every value shown. */
  scale: { lo: number; hi: number; ticks: number[] };
};

export type StudyHomeState =
  | { kind: "ready"; home: StudyHome }
  | { kind: "empty" }
  | { kind: "error"; message: string };

const byMae = <T extends { mae: number }>(rows: readonly T[]): T[] => [...rows].sort((a, b) => a.mae - b.mae);

/** Player MAE for each exact-solver model in one summary. */
function maeById(summary: StudyRunSummary, ids: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ids) {
    const mae = model(summary, id).playerError.mae;
    if (mae == null) throw new Error(`study-seasons.json has no player error for ${id}`);
    out[id] = mae;
  }
  return out;
}

function lowest(mae: Record<string, number>): string {
  return Object.entries(mae).sort((a, b) => a[1] - b[1])[0]![0];
}

function halfSteps(values: readonly number[]): StudyHome["scale"] {
  const lo = Math.floor(Math.min(...values) * 2) / 2;
  const hi = Math.ceil(Math.max(...values) * 2) / 2;
  const ticks: number[] = [];
  for (let v = lo + 0.5; v < hi - 1e-9; v += 0.5) ticks.push(Math.round(v * 10) / 10);
  return { lo, hi, ticks };
}

function build(study: StudySeasonsFile): StudyHome {
  const pool = study.pools.find((p) => p.seasons.length === study.seasons.length) ?? null;
  const last = study.seasons[study.seasons.length - 1]!;
  const summary = pool?.summary ?? last.summary;
  const label = pool ? `${pool.seasons[0]}–${pool.seasons[pool.seasons.length - 1]}` : String(last.season);
  const specs = study.models.filter((m) => m.solver === "exact-dp");
  if (specs.length === 0) throw new Error("study-seasons.json lists no projection methods");
  const ids = specs.map((s) => s.id);

  const methods = byMae(
    specs.map((spec): MethodRow => {
      const m = model(summary, spec.id);
      if (m.playerError.mae == null || m.lineupActualMean == null) throw new Error(`study-seasons.json has no summary numbers for ${spec.id}`);
      return { id: spec.id, label: spec.label, mae: m.playerError.mae, team: m.lineupActualMean, gap: spec.id === COMPUTER ? null : overComputer(summary, spec.id) };
    }),
  );
  const best = methods[0]!;
  const trail = model(summary, COMPUTER);

  const views: MissView[] = [
    {
      key: "pool",
      pill: pool ? `${pool.seasons[0]}–${String(pool.seasons[pool.seasons.length - 1]).slice(2)}` : label,
      title: label,
      note: pool ? `all ${countWord(pool.seasons.length)} seasons` : ROLE_WORDS[last.role],
      weeks: trail.weeks,
      playerWeeks: trail.playerError.n,
      mae: maeById(summary, ids),
      bestId: "",
    },
    ...study.seasons.map((s) => ({
      key: String(s.season),
      pill: String(s.season),
      title: String(s.season),
      note: ROLE_WORDS[s.role],
      weeks: model(s.summary, COMPUTER).weeks,
      playerWeeks: model(s.summary, COMPUTER).playerError.n,
      mae: maeById(s.summary, ids),
      bestId: "",
    })),
    ...(study.shippedSlate
      ? [
          {
            key: "shipped",
            pill: `${study.shippedSlate.season} shipped`,
            title: `${study.shippedSlate.season} shipped slate`,
            note: "look-ahead pool, comparison only",
            weeks: model(study.shippedSlate.summary, COMPUTER).weeks,
            playerWeeks: model(study.shippedSlate.summary, COMPUTER).playerError.n,
            mae: maeById(study.shippedSlate.summary, ids),
            bestId: "",
          },
        ]
      : []),
  ].map((v) => ({ ...v, bestId: lowest(v.mae) }));

  // The archive sections read these too; checking them here turns a gap into the error state.
  for (const s of [...study.seasons, ...(study.shippedSlate ? [study.shippedSlate] : [])]) {
    computerOver(s.summary, TOP_NAMES);
    overComputer(s.summary, EWMA);
  }
  computerOver(summary, TOP_NAMES);

  return {
    label,
    seasonCount: study.seasons.length,
    weeks: trail.weeks,
    playerWeeks: trail.playerError.n,
    methods,
    best,
    trailBias: trail.playerError.bias ?? Number.NaN,
    bestEverywhere: views.every((v) => v.bestId === best.id),
    views,
    scale: halfSteps(views.flatMap((v) => Object.values(v.mae))),
  };
}

export function buildStudyHome(study: StudySeasonsFile | null | undefined): StudyHomeState {
  if (!study || !Array.isArray(study.seasons) || study.seasons.length === 0) return { kind: "empty" };
  try {
    return { kind: "ready", home: build(study) };
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

/** Where a value sits on the miss chart's axis, in percent. */
export function axisPercent(value: number, scale: { lo: number; hi: number }): number {
  return ((value - scale.lo) / (scale.hi - scale.lo)) * 100;
}
