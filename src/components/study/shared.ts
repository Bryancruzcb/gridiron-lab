import backtestFile from "@/data/study-backtest.json";
import ewmaFile from "@/data/study-ewma.json";
import lagFile from "@/data/study-qb-lag.json";
import projFile from "@/data/study-projections.json";
import seasonsFile from "@/data/study-seasons.json";
import { axisProps, CHART } from "@/components/charts/theme";
import type {
  BacktestFile,
  EwmaFile,
  ProjectionFile,
  QbLagFile,
  StudySeasonRow,
  StudySeasonsFile,
} from "@/data/types";
import { cn } from "@/lib/utils";
import { COMPUTER, ROLE_WORDS } from "./calc.ts";

export const study = seasonsFile as unknown as StudySeasonsFile;
export const backtest = backtestFile as BacktestFile;
export const lag = lagFile as QbLagFile;
export const projections = projFile as ProjectionFile;
export const ewma = ewmaFile as EwmaFile;

export {
  CHEAP,
  COMPUTER,
  EWMA,
  ROLE_WORDS,
  TOP_NAMES,
  computerOver,
  countWord,
  fix,
  mean,
  model,
  overComputer,
  range,
  signed,
  thousands,
  ticks,
  verdict,
  type Gap,
} from "./calc.ts";

export type View = { key: string; label: string; note: string; row: StudySeasonRow };

export const views: View[] = [
  ...study.seasons.map((s) => ({ key: String(s.season), label: String(s.season), note: ROLE_WORDS[s.role], row: s })),
  ...(study.shippedSlate
    ? [{ key: "shipped", label: `${study.shippedSlate.season} shipped slate`, note: "look-ahead pool", row: study.shippedSlate }]
    : []),
];

export const pool = study.pools.find((p) => p.seasons.length === study.seasons.length) ?? null;
export const lastSeason = study.seasons[study.seasons.length - 1];
export const main = pool?.summary ?? lastSeason?.summary ?? null;
export const mainLabel = pool
  ? `${pool.seasons[0]}–${pool.seasons[pool.seasons.length - 1]}`
  : String(lastSeason?.season ?? "");
export const seasonList = study.seasons.map((s) => s.season).join(", ");
export const firstSeason = study.seasons[0]?.season;
export const lastSeasonYear = lastSeason?.season;
export const developmentSeasons = study.seasons.filter((s) => s.role === "development").map((s) => s.season);
export const lookBackSeasons = study.seasons.filter((s) => s.role === "retrospective").map((s) => s.season);

export const computerWeeks = study.seasons.flatMap((s) => s.weekly.map((w) => w.lineups[COMPUTER]!));
export const guessHigh = computerWeeks.filter((l) => l.proj > l.actual).length;

export const exactModels = study.models.filter((m) => m.solver === "exact-dp");

export { axisProps, CHART, cn };
