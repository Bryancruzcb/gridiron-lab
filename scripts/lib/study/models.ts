// Projection model configuration: the eight methods, their parameters, presets and validation.

import type { StudyModelSpec, StudyProjectionMethod, StudySolverMethod } from "../../../src/data/types.ts";
import type { SolverMethod } from "../../../src/lib/optimizer.ts";
import { isRecord, StudyConfigError } from "./errors.ts";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** Stops compiling if the artifact's solver names drift from the optimizer's. */
export const SOLVER_NAMES_MATCH: Same<StudySolverMethod, SolverMethod> = true;

export const PROJECTION_METHODS: readonly StudyProjectionMethod[] = [
  "trail",
  "last1",
  "last3",
  "blend",
  "ewma",
  "shrink",
  "usage",
  "opp",
];

export const SOLVER_METHODS: readonly StudySolverMethod[] = ["exact-dp", "hill-climb", "greedy-proj", "greedy-value"];

type ParamRule = { min: number; max: number; integer: boolean; default: number };

const windowWeeks: ParamRule = { min: 1, max: 18, integer: true, default: 3 };

/**
 * trail: mean of prior weeks. last1: latest week. last3: mean of the last windowWeeks.
 * blend: seasonWeight x trail + rest x last windowWeeks. ewma: exponentially weighted, seeded by
 * the first week. shrink: n/(n+k) x trail + k/(n+k) x the pool's position mean. usage: mean volume
 * of the last windowWeeks x mean points per volume (QB attempts; others carries + targets; DST
 * trail). opp: trail x (opponent's allowed mean at the position / every opponent's allowed mean
 * over the same source rows), clamped.
 */
export const METHOD_PARAMS: Record<StudyProjectionMethod, Record<string, ParamRule>> = {
  trail: {},
  last1: {},
  last3: { windowWeeks },
  blend: { seasonWeight: { min: 0, max: 1, integer: false, default: 0.6 }, windowWeeks },
  ewma: { alpha: { min: 0.01, max: 1, integer: false, default: 0.35 } },
  shrink: { k: { min: 0, max: 100, integer: false, default: 4 } },
  usage: { windowWeeks },
  opp: {
    clampLow: { min: 0, max: 10, integer: false, default: 0.7 },
    clampHigh: { min: 0, max: 10, integer: false, default: 1.3 },
  },
};

/**
 * The versioned definition behind each method name, stored on every model spec so it enters the
 * run id. Bump a method's version whenever the same parameters can give a different projection.
 * opp@1 divided by the pool's position mean (a different population, so the factor sat far below 1).
 */
export const METHOD_DEFINITIONS: Record<StudyProjectionMethod, string> = {
  trail: "trail@1",
  last1: "last1@1",
  last3: "last3@1",
  blend: "blend@1",
  ewma: "ewma@1",
  shrink: "shrink@1",
  usage: "usage@1",
  opp: "opp@2",
};

export function defaultLabel(method: StudyProjectionMethod, params: Record<string, number>): string {
  switch (method) {
    case "trail":
      return "Trailing mean";
    case "last1":
      return "Last week";
    case "last3":
      return `Last ${params.windowWeeks}`;
    case "blend": {
      const pct = Math.round(params.seasonWeight! * 100);
      return `${pct}/${100 - pct} season + last ${params.windowWeeks}`;
    }
    case "ewma":
      return `EWMA α=${params.alpha}`;
    case "shrink":
      return "Shrink to position";
    case "usage":
      return "Usage × rate";
    case "opp":
      return "Opponent-adjusted trail";
  }
}

export function makeModel(
  method: StudyProjectionMethod,
  opts: { id?: string; label?: string; params?: Record<string, number>; solver?: StudySolverMethod } = {},
): StudyModelSpec {
  const params: Record<string, number> = {};
  for (const [name, rule] of Object.entries(METHOD_PARAMS[method])) params[name] = rule.default;
  Object.assign(params, opts.params ?? {});
  return {
    id: opts.id ?? method,
    label: opts.label ?? defaultLabel(method, params),
    method,
    definition: METHOD_DEFINITIONS[method],
    params,
    solver: opts.solver ?? "exact-dp",
  };
}

export type ModelConfig = { models: StudyModelSpec[]; baseline: string };

/** Exploratory on any season it is tuned on; never relabel the best alpha as preselected. */
export const EWMA_SWEEP_ALPHAS: readonly number[] = Array.from({ length: 20 }, (_, i) => (5 * (i + 1)) / 100);

const projections = () => PROJECTION_METHODS.map((m) => makeModel(m));
const greedyBaselines = () => [
  makeModel("trail", { id: "trail-greedy-proj", label: "Trailing mean, greedy by projection", solver: "greedy-proj" }),
];

export const MODEL_PRESETS: Record<string, () => ModelConfig> = {
  core: () => ({ models: [...projections(), ...greedyBaselines()], baseline: "trail" }),
  projections: () => ({ models: projections(), baseline: "trail" }),
  backtest: () => ({ models: [makeModel("trail"), ...greedyBaselines()], baseline: "trail" }),
  "ewma-sweep": () => ({
    models: [
      makeModel("trail"),
      ...EWMA_SWEEP_ALPHAS.map((alpha) => makeModel("ewma", { id: `ewma-${alpha.toFixed(2)}`, params: { alpha } })),
    ],
    baseline: "trail",
  }),
};

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function validateModel(value: unknown, where: string): StudyModelSpec {
  if (!isRecord(value)) throw new StudyConfigError(`${where}: expected an object`);
  const { id, label, method, definition, params, solver } = value;
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    throw new StudyConfigError(`${where}: id must match ${ID_PATTERN}, got ${JSON.stringify(id)}`);
  }
  if (typeof method !== "string" || !PROJECTION_METHODS.includes(method as StudyProjectionMethod)) {
    throw new StudyConfigError(`${where} (${id}): unknown method ${JSON.stringify(method)}; expected ${PROJECTION_METHODS.join(", ")}`);
  }
  const m = method as StudyProjectionMethod;
  if (definition !== undefined && definition !== METHOD_DEFINITIONS[m]) {
    throw new StudyConfigError(
      `${where} (${id}): definition ${JSON.stringify(definition)} is no longer implemented; ${m} is ${METHOD_DEFINITIONS[m]}`,
    );
  }
  if (typeof solver !== "string" || !SOLVER_METHODS.includes(solver as StudySolverMethod)) {
    throw new StudyConfigError(`${where} (${id}): unknown solver ${JSON.stringify(solver)}; expected ${SOLVER_METHODS.join(", ")}`);
  }
  if (params !== undefined && !isRecord(params)) throw new StudyConfigError(`${where} (${id}): params must be an object`);
  const rules = METHOD_PARAMS[m];
  const given = (params ?? {}) as Record<string, unknown>;
  for (const name of Object.keys(given)) {
    if (!(name in rules)) {
      throw new StudyConfigError(`${where} (${id}): ${m} has no parameter ${name}; accepted: ${Object.keys(rules).join(", ") || "none"}`);
    }
  }
  const out: Record<string, number> = {};
  for (const [name, rule] of Object.entries(rules)) {
    const v = given[name] ?? rule.default;
    if (typeof v !== "number" || !Number.isFinite(v) || v < rule.min || v > rule.max || (rule.integer && !Number.isInteger(v))) {
      throw new StudyConfigError(
        `${where} (${id}): ${name} must be ${rule.integer ? "a whole number" : "a number"} in [${rule.min}, ${rule.max}], got ${JSON.stringify(v)}`,
      );
    }
    out[name] = v;
  }
  if (m === "opp" && out.clampLow! > out.clampHigh!) {
    throw new StudyConfigError(`${where} (${id}): clampLow ${out.clampLow} exceeds clampHigh ${out.clampHigh}`);
  }
  if (label !== undefined && typeof label !== "string") throw new StudyConfigError(`${where} (${id}): label must be a string`);
  return {
    id,
    label: typeof label === "string" ? label : defaultLabel(m, out),
    method: m,
    definition: METHOD_DEFINITIONS[m],
    params: out,
    solver: solver as StudySolverMethod,
  };
}

/** Validates a model list and baseline; used for presets and JSON config files alike. */
export function validateModelConfig(value: unknown, source: string): ModelConfig {
  if (!isRecord(value) || !Array.isArray(value.models) || typeof value.baseline !== "string") {
    throw new StudyConfigError(`${source}: expected {"models": [...], "baseline": "<model id>"}`);
  }
  const models = value.models.map((m, i) => validateModel(m, `${source} models[${i}]`));
  if (!models.length) throw new StudyConfigError(`${source}: no models`);
  const ids = new Set<string>();
  for (const m of models) {
    if (ids.has(m.id)) throw new StudyConfigError(`${source}: model id ${m.id} appears twice`);
    ids.add(m.id);
  }
  if (!ids.has(value.baseline)) throw new StudyConfigError(`${source}: baseline ${value.baseline} is not one of the models`);
  return { models, baseline: value.baseline };
}
