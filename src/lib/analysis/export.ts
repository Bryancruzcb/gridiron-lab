// Lineup exports. JSON is the full snapshot for reproducing and inspecting one result; CSV is for
// reading it in a spreadsheet. Pure: the page passes in exactly what it shows.
//
// CSV layout, one file: a two-column metadata table (header "metadata,value"), one empty line, then
// a header and one row per roster slot. The metadata carries the input versions and totals, and the
// totals are sums of the slot rows below them. Lines end in CRLF and fields are quoted per RFC 4180.
// A text cell that starts with =, +, -, @, a tab or a carriage return gets a leading apostrophe so a
// spreadsheet shows it as text instead of running it as a formula. Numeric cells are never changed.

import { z } from "zod";
import { RULESET_REF } from "../football/scoring.ts";
import type { LineupMode, LineupSelection } from "../lineup/selection.ts";
import { PROTOCOL_VERSION } from "../lineup/worker-protocol.ts";
import type { SolveOk } from "../optimizer.ts";
import { optimizerAnalysisStateSchema } from "./state.ts";

export const LINEUP_EXPORT_SCHEMA = "gridiron-lab.lineup-export";
export const LINEUP_EXPORT_VERSION = 1;
export const APP_REF = "gridiron-lab";
export const SOLVER_API = "optimizeLineup";

export const ACTUAL_STATUSES = ["complete", "partial", "not-final", "missing"] as const;
export type ActualStatus = (typeof ACTUAL_STATUSES)[number];

export const SNAPSHOT_NOTE =
  "A snapshot of the lineup as shown when it was exported, with the inputs it was built on. " +
  "Opening reopen.path recomputes the same setup on whatever data is loaded then, so its scores can differ.";

export type LineupExportInput = {
  exportedAt: Date;
  slate: string;
  slateSeason: number;
  cap: number;
  selection: LineupSelection;
  /** The mode the shown result was solved in. */
  mode: LineupMode;
  result: Pick<SolveOk, "method" | "optimality" | "fallbackReason" | "lineup">;
  fingerprint: string;
  /** Slate projections by player id. Hindsight lineups carry actual points in `proj`, so this is the source. */
  projections: ReadonlyMap<string, number>;
  actuals: ReadonlyMap<string, number> | null;
  actualsVersion: string | null;
  partialIds: ReadonlySet<string>;
  notFinalIds: ReadonlySet<string>;
  week: { season: number; seasonType: string | null; week: number } | null;
  weekFeed: { source: string; fetchedAt: string | null; partial: string[]; error: string | null } | null;
  reopenPath: string;
  savedName: string | null;
};

const round2 = (x: number) => Math.round(x * 100) / 100;

const slotRowSchema = z.object({
  slot: z.string(),
  id: z.string(),
  name: z.string(),
  position: z.string(),
  team: z.string(),
  salary: z.number(),
  projection: z.number(),
  actual: z.number().nullable(),
  actualStatus: z.enum(ACTUAL_STATUSES),
});
export type ExportSlotRow = z.infer<typeof slotRowSchema>;

const totalsSchema = z.object({
  players: z.number().int(),
  salary: z.number(),
  projection: z.number(),
  /** Sum over rows with an actual; null when none has one. Missing actuals are not zeros. */
  actual: z.number().nullable(),
  scored: z.number().int(),
  missing: z.number().int(),
  partial: z.number().int(),
  notFinal: z.number().int(),
});
export type LineupTotals = z.infer<typeof totalsSchema>;

export const lineupExportSchema = z.object({
  schema: z.literal(LINEUP_EXPORT_SCHEMA),
  schemaVersion: z.literal(LINEUP_EXPORT_VERSION),
  exportedAt: z.string(),
  note: z.string(),
  refs: z.object({ app: z.string(), ruleset: z.string(), solverApi: z.string(), workerProtocol: z.number() }),
  dataVersion: z.object({
    slate: z.string(),
    slateSeason: z.number(),
    actualsVersion: z.string().nullable(),
    week: z.object({ season: z.number(), seasonType: z.string().nullable(), week: z.number() }).nullable(),
    weekFeed: z
      .object({ source: z.string(), fetchedAt: z.string().nullable(), partial: z.array(z.string()), error: z.string().nullable() })
      .nullable(),
  }),
  configuration: z.object({
    selection: optimizerAnalysisStateSchema,
    cap: z.number(),
    mode: z.enum(["proj", "actual"]),
    savedName: z.string().nullable(),
  }),
  solver: z.object({
    method: z.enum(["exact-dp", "hill-climb", "greedy-proj", "greedy-value"]),
    optimality: z.enum(["proven", "heuristic"]),
    fallbackReason: z.string().nullable(),
    requestFingerprint: z.string(),
  }),
  slots: z.array(slotRowSchema),
  totals: totalsSchema,
  reopen: z.object({ path: z.string() }),
});
export type LineupExport = z.infer<typeof lineupExportSchema>;

export function actualStatusOf(id: string, input: Pick<LineupExportInput, "actuals" | "partialIds" | "notFinalIds">): ActualStatus {
  if (input.actuals?.get(id) == null) return "missing";
  if (input.partialIds.has(id)) return "partial";
  if (input.notFinalIds.has(id)) return "not-final";
  return "complete";
}

export function lineupTotals(rows: readonly ExportSlotRow[]): LineupTotals {
  let salary = 0;
  let projection = 0;
  let actual = 0;
  let scored = 0;
  const count: Record<ActualStatus, number> = { complete: 0, partial: 0, "not-final": 0, missing: 0 };
  for (const row of rows) {
    salary += row.salary;
    projection += row.projection;
    if (row.actual !== null) {
      actual += row.actual;
      scored++;
    }
    count[row.actualStatus]++;
  }
  return {
    players: rows.length,
    salary,
    projection: round2(projection),
    actual: scored ? round2(actual) : null,
    scored,
    missing: count.missing,
    partial: count.partial,
    notFinal: count["not-final"],
  };
}

export function buildLineupExport(input: LineupExportInput): LineupExport {
  const slots: ExportSlotRow[] = input.result.lineup.slots.map(({ slot, player }) => ({
    slot,
    id: player.id,
    name: player.name,
    position: player.pos,
    team: player.team,
    salary: player.salary,
    projection: input.projections.get(player.id) ?? player.proj,
    actual: input.actuals?.get(player.id) ?? null,
    actualStatus: actualStatusOf(player.id, input),
  }));
  return {
    schema: LINEUP_EXPORT_SCHEMA,
    schemaVersion: LINEUP_EXPORT_VERSION,
    exportedAt: input.exportedAt.toISOString(),
    note: SNAPSHOT_NOTE,
    refs: { app: APP_REF, ruleset: RULESET_REF, solverApi: SOLVER_API, workerProtocol: PROTOCOL_VERSION },
    dataVersion: {
      slate: input.slate,
      slateSeason: input.slateSeason,
      actualsVersion: input.actualsVersion,
      week: input.week,
      weekFeed: input.weekFeed,
    },
    configuration: { selection: input.selection, cap: input.cap, mode: input.mode, savedName: input.savedName },
    solver: {
      method: input.result.method,
      optimality: input.result.optimality,
      fallbackReason: input.result.fallbackReason ?? null,
      requestFingerprint: input.fingerprint,
    },
    slots,
    totals: lineupTotals(slots),
    reopen: { path: input.reopenPath },
  };
}

export function lineupJson(exp: LineupExport): string {
  return `${JSON.stringify(exp, null, 2)}\n`;
}

export type LineupExportParse = { ok: true; value: LineupExport } | { ok: false; message: string };

/** Validates an exported JSON document, including that its totals are the sums of its rows. */
export function parseLineupExport(raw: unknown): LineupExportParse {
  const parsed = lineupExportSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const recomputed = lineupTotals(parsed.data.slots);
  const t = parsed.data.totals;
  const same = (Object.keys(recomputed) as (keyof LineupTotals)[]).every((k) => recomputed[k] === t[k]);
  return same ? { ok: true, value: parsed.data } : { ok: false, message: "The totals are not the sums of the exported rows." };
}

// ---- CSV -----------------------------------------------------------------------------

export type CsvValue = string | number | boolean | null;

const FORMULA_START = /^[=+\-@\t\r]/;

/** Leading apostrophe on text a spreadsheet would treat as a formula. */
export function guardFormula(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

export function quoteCsv(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Numbers and booleans are written as they are; only text is guarded. */
export function csvCell(value: CsvValue): string {
  if (value === null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return quoteCsv(guardFormula(value));
}

export function csvRow(cells: readonly CsvValue[]): string {
  return cells.map(csvCell).join(",");
}

export const CSV_COLUMNS = ["slot", "player_id", "name", "position", "team", "salary", "projection", "actual", "actual_status"] as const;

export function csvMetadata(exp: LineupExport): [string, CsvValue][] {
  const { dataVersion: data, configuration: config, solver, totals } = exp;
  return [
    ["schema", `${LINEUP_EXPORT_SCHEMA}.csv`],
    ["schema_version", exp.schemaVersion],
    ["exported_at", exp.exportedAt],
    ["note", exp.note],
    ["saved_view_name", config.savedName],
    ["app", exp.refs.app],
    ["ruleset", exp.refs.ruleset],
    ["solver_api", exp.refs.solverApi],
    ["worker_protocol", exp.refs.workerProtocol],
    ["slate", data.slate],
    ["slate_season", data.slateSeason],
    ["actuals_version", data.actualsVersion],
    ["week_season", data.week?.season ?? null],
    ["week_season_type", data.week?.seasonType ?? null],
    ["week", data.week?.week ?? null],
    ["week_source", data.weekFeed?.source ?? null],
    ["week_fetched_at", data.weekFeed?.fetchedAt ?? null],
    ["week_incomplete", data.weekFeed?.partial.join("; ") || null],
    ["week_error", data.weekFeed?.error ?? null],
    ["cap", config.cap],
    ["mode", config.mode],
    ["locked", config.selection.locked.join(" ") || null],
    ["excluded", config.selection.excluded.join(" ") || null],
    ["stack", config.selection.stack],
    ["solver_method", solver.method],
    ["optimality", solver.optimality],
    ["fallback_reason", solver.fallbackReason],
    ["request_fingerprint", solver.requestFingerprint],
    ["total_players", totals.players],
    ["total_salary", totals.salary],
    ["total_projection", totals.projection],
    ["total_actual", totals.actual],
    ["actual_scored", totals.scored],
    ["actual_missing", totals.missing],
    ["actual_partial", totals.partial],
    ["actual_not_final", totals.notFinal],
    ["reopen_path", exp.reopen.path],
  ];
}

export function lineupCsv(exp: LineupExport): string {
  const lines = [
    csvRow(["metadata", "value"]),
    ...csvMetadata(exp).map(([k, v]) => csvRow([k, v])),
    "",
    csvRow(CSV_COLUMNS),
    ...exp.slots.map((r) => csvRow([r.slot, r.id, r.name, r.position, r.team, r.salary, r.projection, r.actual, r.actualStatus])),
  ];
  return `${lines.join("\r\n")}\r\n`;
}

/** RFC 4180 records, for reading an export back. A trailing line break does not add a record. */
export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (ch === '"') quoted = false;
      else field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      i++;
    } else field += ch;
    i++;
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

export function exportFilename(exp: LineupExport, ext: "json" | "csv"): string {
  const stamp = exp.exportedAt.replace(/\.\d+Z$/, "Z").replace(/[:]/g, "");
  return `gridiron-lineup-${exp.configuration.mode}-${stamp}.${ext}`;
}
