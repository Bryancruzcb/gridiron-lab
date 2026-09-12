// The study command: acquire inputs, prepare seasons, resolve the universe, run, and write the
// semantic artifacts plus separate operational metadata. The only module here that does file I/O
// beyond the input cache.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, sep } from "node:path";
import type {
  StudyInputIdentity,
  StudyInputManifestEntry,
  StudyMultiSeasonArtifact,
  StudyQbLagArtifact,
  StudyRunArtifact,
  StudyRunMeta,
  StudyUniverse,
} from "../../../src/data/types.ts";
import { RULESET_REF } from "../../../src/lib/football/scoring.ts";
import type { StudyCliOptions } from "./cli.ts";
import { isRecord, StudyConfigError } from "./errors.ts";
import { hashJson, sha256OfText } from "./hash.ts";
import { acquireInputs, describeInput, type AcquireOptions, type AcquiredInput, type FetchLike } from "./inputs.ts";
import { LEGACY_SCORING_REF } from "./legacy-scoring.ts";
import { MODEL_PRESETS, validateModelConfig, type ModelConfig } from "./models.ts";
import { prepareSeason } from "./prepare.ts";
import { qbLag } from "./qb-lag.ts";
import { buildMultiSeason, formatSummary, serializeArtifact } from "./report.ts";
import { DEFAULT_RUN_SETTINGS, runStudy } from "./runner.ts";
import { playerWeekSpec, SCHEDULE_SPEC, seasonSpecs, teamWeekSpec, universeFileSpec } from "./sources.ts";
import {
  defaultSyntheticParams,
  LEGACY_UNIVERSE_ID,
  legacyUniverse,
  parseFrozenUniverse,
  SYNTHETIC_RULE,
  syntheticUniverse,
} from "./universe.ts";

/** Synthetic universes use the legacy slate's cap. */
export const SYNTHETIC_CAP = 50_000;

export type StudyCommandContext = {
  repoRoot: string;
  command: string[];
  log: (message: string) => void;
  fetchImpl?: FetchLike;
  now?: () => Date;
  /** Defaults to asking git; tests pass a fixed value. */
  sourceState?: () => { commit: string | null; dirty: boolean | null };
};

export type WrittenRun = { artifact: StudyRunArtifact; meta: StudyRunMeta; path: string; metaPath: string };

export type StudyCommandResult = {
  runs: WrittenRun[];
  multi: { artifact: StudyMultiSeasonArtifact; path: string } | null;
  qbLag: { artifact: StudyQbLagArtifact; path: string }[];
};

export function resolveModels(spec: string): { name: string; config: ModelConfig } {
  const preset = MODEL_PRESETS[spec];
  if (preset) return { name: spec, config: validateModelConfig(preset(), `preset ${spec}`) };
  if (!existsSync(spec)) {
    throw new StudyConfigError(`--models ${spec} is neither a preset (${Object.keys(MODEL_PRESETS).join(", ")}) nor a file`);
  }
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(spec, "utf8"));
  } catch (e) {
    throw new StudyConfigError(`${spec}: not valid JSON (${(e as Error).message})`);
  }
  return { name: basename(spec, extname(spec)), config: validateModelConfig(value, spec) };
}

/** Input id to sha256 from run artifacts (run.inputs) or meta files (inputs). */
export function readPins(paths: readonly string[]): Map<string, string> {
  const pins = new Map<string, string>();
  for (const path of paths) {
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(path, "utf8"));
    } catch (e) {
      throw new StudyConfigError(`--pin-inputs ${path}: ${(e as Error).message}`);
    }
    const list = isRecord(value) && Array.isArray(value.inputs)
      ? value.inputs
      : isRecord(value) && isRecord(value.run) && Array.isArray(value.run.inputs)
        ? value.run.inputs
        : null;
    if (!list) throw new StudyConfigError(`--pin-inputs ${path}: expected a study run or meta file with inputs`);
    for (const item of list) {
      if (!isRecord(item) || typeof item.id !== "string" || typeof item.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(item.sha256)) {
        throw new StudyConfigError(`--pin-inputs ${path}: malformed input entry`);
      }
      const known = pins.get(item.id);
      if (known && known !== item.sha256) throw new StudyConfigError(`--pin-inputs: ${item.id} is pinned to two different hashes`);
      pins.set(item.id, item.sha256);
    }
  }
  return pins;
}

// Code that determines results; hashed into the meta file (not the run id) so a reader can tell
// which implementation produced an artifact.
const CODE_FILES = [
  "src/lib/optimizer.ts",
  "src/lib/football/lineup-validation.ts",
  "src/lib/football/scoring.ts",
  "src/lib/football/nflverse.ts",
  "src/lib/football/csv.ts",
  "src/lib/football/player-weeks.ts",
  "src/lib/live/csv.ts",
  "scripts/study.ts",
];

function codeHashes(repoRoot: string): Record<string, string> {
  const libDir = join(repoRoot, "scripts", "lib", "study");
  const lib = existsSync(libDir)
    ? readdirSync(libDir).filter((f) => f.endsWith(".ts")).map((f) => `scripts/lib/study/${f}`)
    : [];
  const out: Record<string, string> = {};
  for (const file of [...CODE_FILES, ...lib].sort()) {
    const abs = join(repoRoot, file);
    if (existsSync(abs)) out[file] = sha256OfText(readFileSync(abs, "utf8"));
  }
  return out;
}

function gitState(repoRoot: string): { commit: string | null; dirty: boolean | null } {
  try {
    const run = (args: string[]) =>
      execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return { commit: run(["rev-parse", "HEAD"]), dirty: run(["status", "--porcelain"]).length > 0 };
  } catch {
    return { commit: null, dirty: null };
  }
}

type ResolvedUniverse = { universe: StudyUniverse; identities: StudyInputIdentity[]; entries: StudyInputManifestEntry[] };

/** Local text files are hashed with CRLF folded to LF so Windows and Linux checkouts agree. */
function readLocalText(path: string): Uint8Array {
  if (!existsSync(path)) throw new StudyConfigError(`universe file ${path} does not exist`);
  return new TextEncoder().encode(readFileSync(path, "utf8").replace(/\r\n/g, "\n"));
}

function localIdentity(repoRoot: string, path: string, bytes: Uint8Array, readAt: string) {
  const rel = relative(repoRoot, path).split(sep).join("/");
  const inRepo = !rel.startsWith("..") && !rel.includes(":");
  const name = basename(path);
  const spec = universeFileSpec(name, inRepo ? `repo:${rel}` : `file:${name}`, name);
  const { identity } = describeInput(spec, bytes);
  const entry: StudyInputManifestEntry = { ...identity, localPath: inRepo ? rel : path, retrievedAt: readAt, http: null };
  return { identity, entry };
}

function textOf(acquired: ReadonlyMap<string, AcquiredInput>, id: string): string {
  const input = acquired.get(id);
  if (!input) throw new Error(`input ${id} was not acquired`);
  return input.text;
}

async function resolveUniverse(
  opts: StudyCliOptions,
  ctx: StudyCommandContext,
  season: number,
  acquireOpts: AcquireOptions,
  readAt: string,
): Promise<ResolvedUniverse> {
  const u = opts.universe;
  if (u === LEGACY_UNIVERSE_ID || u.startsWith(`${LEGACY_UNIVERSE_ID}:`)) {
    const path = u === LEGACY_UNIVERSE_ID ? join(ctx.repoRoot, "src", "data", "fantasy.json") : u.slice(LEGACY_UNIVERSE_ID.length + 1);
    const bytes = readLocalText(path);
    const { identity, entry } = localIdentity(ctx.repoRoot, path, bytes, readAt);
    return { universe: legacyUniverse(bytes, identity.id), identities: [identity], entries: [entry] };
  }
  if (u.startsWith("frozen:")) {
    const path = u.slice("frozen:".length);
    const bytes = readLocalText(path);
    const { identity, entry } = localIdentity(ctx.repoRoot, path, bytes, readAt);
    return { universe: parseFrozenUniverse(new TextDecoder().decode(bytes), path), identities: [identity], entries: [entry] };
  }
  if (u === SYNTHETIC_RULE) {
    const prior = season - 1;
    const acquired = await acquireInputs([playerWeekSpec(prior), teamWeekSpec(prior), SCHEDULE_SPEC], acquireOpts);
    const data = prepareSeason(
      prior,
      {
        playerWeek: textOf(acquired, playerWeekSpec(prior).id),
        teamWeek: textOf(acquired, teamWeekSpec(prior).id),
        schedule: textOf(acquired, SCHEDULE_SPEC.id),
      },
      { scoring: RULESET_REF },
    );
    const inputs = [...acquired.values()];
    const universe = syntheticUniverse(data, defaultSyntheticParams(prior), {
      cap: SYNTHETIC_CAP,
      sourceInputs: inputs.map((i) => ({ id: i.identity.id, sha256: i.identity.sha256 })),
    });
    return { universe, identities: inputs.map((i) => i.identity), entries: inputs.map((i) => i.entry) };
  }
  throw new StudyConfigError(
    `--universe ${u}: expected ${SYNTHETIC_RULE}, ${LEGACY_UNIVERSE_ID}, ${LEGACY_UNIVERSE_ID}:<fantasy.json> or frozen:<universe.json>`,
  );
}

function uniqueById<T extends { id: string }>(items: readonly T[]): T[] {
  const out = new Map<string, T>();
  for (const item of items) if (!out.has(item.id)) out.set(item.id, item);
  return [...out.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export async function runStudyCommand(opts: StudyCliOptions, ctx: StudyCommandContext): Promise<StudyCommandResult> {
  const now = ctx.now ?? (() => new Date());
  const models = resolveModels(opts.models);
  const acquireOpts: AcquireOptions = {
    cacheDir: opts.inputDir,
    offline: opts.offline,
    refresh: opts.refresh,
    pins: opts.pinInputs.length ? readPins(opts.pinInputs) : undefined,
    fetchImpl: ctx.fetchImpl,
    now,
    log: ctx.log,
  };
  const legacyScoring = opts.scoring === LEGACY_SCORING_REF;
  if (legacyScoring) {
    ctx.log(`warning: ${LEGACY_SCORING_REF} reproduces the old DST formula for attribution only; never publish these numbers`);
  }
  const suffix = legacyScoring ? "-legacy-scoring" : "";
  mkdirSync(opts.outDir, { recursive: true });
  const code = codeHashes(ctx.repoRoot);
  const source = (ctx.sourceState ?? (() => gitState(ctx.repoRoot)))();

  const runs: WrittenRun[] = [];
  const lags: StudyCommandResult["qbLag"] = [];
  for (const season of opts.seasons) {
    const started = performance.now();
    const generatedAt = now().toISOString();
    const acquired = await acquireInputs(seasonSpecs(season), acquireOpts);
    const data = prepareSeason(
      season,
      {
        playerWeek: textOf(acquired, playerWeekSpec(season).id),
        teamWeek: textOf(acquired, teamWeekSpec(season).id),
        schedule: textOf(acquired, SCHEDULE_SPEC.id),
      },
      { scoring: opts.scoring },
    );
    const resolved = await resolveUniverse(opts, ctx, season, acquireOpts, generatedAt);
    const warnings: string[] = [];
    if (legacyScoring) warnings.push(`${LEGACY_SCORING_REF}: attribution only, not a result`);
    if (resolved.universe.lookAhead) warnings.push(`universe ${resolved.universe.id} was selected and priced with look-ahead`);
    for (const src of ["schedule", "player-week", "team-week"]) {
      const n = data.skipped.filter((s) => s.source === src).length;
      if (n) warnings.push(`${src}: ${n} source rows skipped (missing ids, teams, season or week)`);
    }

    const artifact = runStudy({
      config: {
        season,
        weeks: opts.weeks,
        role: opts.role,
        scoring: opts.scoring,
        models: models.config,
        minHistoryGames: opts.minHistoryGames,
        positionPriorFallback: DEFAULT_RUN_SETTINGS.positionPriorFallback,
        uncertainty: { resamples: opts.resamples, seed: opts.seed, level: DEFAULT_RUN_SETTINGS.uncertainty.level },
        allowUniverseSeasonMismatch: opts.universe !== SYNTHETIC_RULE,
      },
      data,
      universe: resolved.universe,
      inputs: uniqueById([...[...acquired.values()].map((a) => a.identity), ...resolved.identities]),
    });
    if (resolved.universe.season !== season) {
      warnings.push(`universe ${resolved.universe.id} was frozen for ${resolved.universe.season}: common-pool experiment`);
    }

    const name = `study-run-${season}-${models.name}${suffix}`;
    const path = join(opts.outDir, `${name}.json`);
    const metaPath = join(opts.outDir, `${name}.meta.json`);
    writeFileSync(path, serializeArtifact(artifact));
    writeFileSync(
      join(opts.outDir, `universe-${season}-${resolved.universe.rule.replace(/[^A-Za-z0-9._-]/g, "-")}.json`),
      serializeArtifact(resolved.universe),
    );
    const meta: StudyRunMeta = {
      schemaVersion: "gridiron-lab-study-run-meta@1",
      runId: artifact.runId,
      resultSha256: artifact.resultSha256,
      generatedAt,
      elapsedMs: Math.round(performance.now() - started),
      sourceCommit: source.commit,
      sourceDirty: source.dirty,
      node: process.version,
      command: ctx.command,
      codeSha256: code,
      cacheDir: opts.inputDir,
      inputs: uniqueById([...[...acquired.values()].map((a) => a.entry), ...resolved.entries]),
      warnings,
    };
    writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
    const u = artifact.run.universe;
    ctx.log(
      formatSummary(
        `${artifact.runId}  ${season} REG weeks ${opts.weeks.from}-${opts.weeks.to}  role ${opts.role}  scoring ${opts.scoring}  universe ${u.id}${u.lookAhead ? " (look-ahead)" : ""}`,
        artifact.summary,
        artifact.run.uncertainty,
      ),
    );
    ctx.log(`wrote ${path}`);
    runs.push({ artifact, meta, path, metaPath });

    if (opts.qbLag) {
      const body = {
        ...qbLag(data),
        schemaVersion: "gridiron-lab-study-qb-lag@1" as const,
        inputs: [acquired.get(playerWeekSpec(season).id)!.identity],
      };
      const lag: StudyQbLagArtifact = { ...body, resultSha256: hashJson(body) };
      const lagPath = join(opts.outDir, `study-qb-lag-${season}.json`);
      writeFileSync(lagPath, serializeArtifact(lag));
      lags.push({ artifact: lag, path: lagPath });
    }
  }

  let multi: StudyCommandResult["multi"] = null;
  if (runs.length > 1) {
    const artifact = buildMultiSeason(runs.map((r) => r.artifact));
    const path = join(opts.outDir, `study-multi-${models.name}${suffix}.json`);
    writeFileSync(path, serializeArtifact(artifact));
    ctx.log(formatSummary(`pooled ${opts.seasons.join(", ")}`, artifact.pooled, artifact.uncertainty));
    ctx.log(`wrote ${path}`);
    multi = { artifact, path };
  }
  return { runs, multi, qbLag: lags };
}
