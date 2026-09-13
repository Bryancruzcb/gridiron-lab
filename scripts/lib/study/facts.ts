// Study facts that the README and the regeneration report quote but the page file does not carry:
// slate availability and solver records per run, inactive lineup slots, the overlap of the shipped
// slate with the clean pool, and the exploratory EWMA sweeps. Built only from verified run
// artifacts and the universe files written next to them, never by hand.

import type {
  FantasyPos,
  StudyFactsFile,
  StudyRunArtifact,
  StudyRunFacts,
  StudySweepFacts,
  StudyUniverse,
} from "../../../src/data/types.ts";
import { StudyConfigError } from "./errors.ts";
import { hashJson } from "./hash.ts";
import { buildMultiSeason, verifyRunArtifact } from "./report.ts";

export const FACTS_SCHEMA = "gridiron-lab-study-facts@1";

const POSITIONS: readonly FantasyPos[] = ["QB", "RB", "WR", "TE", "DST"];

function count(counts: Record<string, number>, key: string) {
  counts[key] = (counts[key] ?? 0) + 1;
}

/** Availability over the common weeks; solver records over every week in range. */
export function runFacts(a: StudyRunArtifact): StudyRunFacts {
  const common = a.weeks.filter((w) => w.comparable);
  const sizes = common.map((w) => w.slate.length);
  const offSlate = { bye: 0, "no-history": 0, "unknown-identity": 0 };
  const slateStatuses: Record<string, number> = {};
  let baselineInactiveSlots = 0;
  for (const w of common) {
    for (const o of w.offSlate) offSlate[o.reason] += 1;
    for (const s of w.slate) count(slateStatuses, s.status);
    const lineup = w.models.find((m) => m.model === a.run.baselineModel)?.lineup;
    baselineInactiveSlots += lineup?.slots.filter((s) => s.status === "inactive").length ?? 0;
  }
  const solverRecords: Record<string, number> = {};
  for (const w of a.weeks) {
    for (const m of w.models) count(solverRecords, `${m.solver.requested}/${m.solver.status === "ok" ? m.solver.optimality : m.solver.status}`);
  }
  return {
    season: a.run.season,
    role: a.run.role,
    runId: a.runId,
    resultSha256: a.resultSha256,
    universe: a.run.universe,
    commonWeeks: common.length,
    excludedWeeks: a.weeks.length - common.length,
    slateSize: sizes.length ? { min: Math.min(...sizes), max: Math.max(...sizes) } : null,
    offSlate,
    slateStatuses,
    baselineModel: a.run.baselineModel,
    baselineInactiveSlots,
    solverRecords,
  };
}

/** One sweep run, or several seasons pooled, with the best alpha by lineup mean (ties: the lower alpha). */
export function sweepFacts(runs: readonly StudyRunArtifact[]): StudySweepFacts {
  const sorted = [...runs].sort((a, b) => a.run.season - b.run.season);
  const first = sorted[0];
  if (!first) throw new StudyConfigError("a sweep needs at least one run");
  const summary = sorted.length === 1 ? first.summary : buildMultiSeason(sorted).pooled;
  const byId = new Map(summary.models.map((m) => [m.model, m]));
  const lineupMean = (id: string) => {
    const v = byId.get(id)?.lineupActualMean;
    if (v == null) throw new StudyConfigError(`${first.runId}: model ${id} has no lineup mean`);
    return v;
  };
  const points = first.run.models
    .filter((m) => m.method === "ewma" && m.solver === "exact-dp")
    .map((m) => ({ alpha: m.params.alpha!, lineupMean: lineupMean(m.id), mae: byId.get(m.id)!.playerError.mae }))
    .sort((x, y) => x.alpha - y.alpha);
  if (!points.length) throw new StudyConfigError(`${first.runId} has no exact-dp EWMA models`);
  const best = points.reduce((b, p) => (p.lineupMean > b.lineupMean ? p : b));
  return {
    seasons: sorted.map((a) => a.run.season),
    runIds: sorted.map((a) => a.runId),
    universeRule: first.run.universe.rule,
    lookAhead: first.run.universe.lookAhead,
    commonWeeks: summary.commonWeeks.length,
    baseline: { model: first.run.baselineModel, lineupMean: lineupMean(first.run.baselineModel) },
    points,
    best: { alpha: best.alpha, lineupMean: best.lineupMean },
  };
}

function universeOf(a: StudyRunArtifact, universes: ReadonlyMap<string, StudyUniverse>): StudyUniverse {
  const u = universes.get(a.run.universe.sha256);
  if (!u) throw new StudyConfigError(`${a.runId}: no universe file hashes to ${a.run.universe.sha256}`);
  return u;
}

export function buildFactsFile(input: {
  runs: readonly StudyRunArtifact[];
  shippedSlate: StudyRunArtifact | null;
  sweeps: readonly StudyRunArtifact[];
  /** Universe files by the sha256 of their canonical JSON. */
  universes: ReadonlyMap<string, StudyUniverse>;
}): StudyFactsFile {
  const runs = [...input.runs].sort((a, b) => a.run.season - b.run.season);
  if (!runs.length) throw new StudyConfigError("facts need at least one season run");
  for (const a of [...runs, ...(input.shippedSlate ? [input.shippedSlate] : []), ...input.sweeps]) {
    verifyRunArtifact(a);
    if (a.run.scoring.legacyAttributionOnly) throw new StudyConfigError(`${a.runId} uses attribution-only scoring`);
  }
  for (const [sha, u] of input.universes) {
    if (hashJson(u) !== sha) throw new StudyConfigError(`universe ${u.id} is keyed by a hash it does not have`);
  }

  const shipped = input.shippedSlate;
  const clean = shipped ? runs.find((a) => a.run.season === shipped.run.season && !a.run.universe.lookAhead) : undefined;
  let universeOverlap: StudyFactsFile["universeOverlap"] = null;
  if (shipped && clean) {
    const [s, c] = [universeOf(shipped, input.universes), universeOf(clean, input.universes)];
    const ids = new Set(c.players.map((p) => p.id));
    const shared = s.players.filter((p) => ids.has(p.id));
    universeOverlap = {
      season: shipped.run.season,
      shipped: shipped.run.universe,
      clean: clean.run.universe,
      shared: shared.length,
      byPosition: Object.fromEntries(POSITIONS.map((pos) => [pos, shared.filter((p) => p.pos === pos).length])) as Record<FantasyPos, number>,
    };
  }

  const sweepRuns = [...input.sweeps].sort((a, b) => a.run.season - b.run.season);
  const sweeps = sweepRuns.map((a) => sweepFacts([a]));
  if (sweepRuns.length > 1) sweeps.push(sweepFacts(sweepRuns));

  const seasonFacts = runs.map(runFacts);
  const body: Omit<StudyFactsFile, "resultSha256"> = {
    schemaVersion: FACTS_SCHEMA,
    runs: seasonFacts,
    shippedSlate: shipped ? runFacts(shipped) : null,
    pooledBaselineInactiveSlots: {
      seasons: seasonFacts.map((f) => f.season),
      commonWeeks: seasonFacts.reduce((n, f) => n + f.commonWeeks, 0),
      slots: seasonFacts.reduce((n, f) => n + f.baselineInactiveSlots, 0),
    },
    universeOverlap,
    sweeps,
  };
  return { ...body, resultSha256: hashJson(body) };
}
