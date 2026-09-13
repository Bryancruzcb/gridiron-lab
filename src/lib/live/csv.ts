export { parseCsvLine } from "../football/csv.ts";

export function truthy(v: string | undefined) {
  return v === "1" || v === "TRUE" || v === "true";
}

export function fnum(v: string | undefined): number | null {
  if (v == null || v === "" || v === "NA") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function round(n: number, digits: number) {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

export const UA = { "User-Agent": "GridironLab/1.0 (analytics portfolio)" };
