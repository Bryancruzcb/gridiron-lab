import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatEpa(n: number | null | undefined, digits = 3) {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}`;
}

export function formatPct(n: number | null | undefined, digits = 1) {
  if (n == null || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function formatNum(n: number | null | undefined, digits = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function formatCpoe(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}`;
}

/** NFL passer rating, 0–158.3. Box only. Null if no attempts. */
export function passerRating(box: { cmp: number; att: number; yds: number; td: number; int: number } | null | undefined) {
  if (!box || box.att <= 0) return null;
  const clamp = (x: number) => Math.min(2.375, Math.max(0, x));
  const a = clamp((box.cmp / box.att - 0.3) * 5);
  const b = clamp((box.yds / box.att - 3) * 0.25);
  const c = clamp((box.td / box.att) * 20);
  const d = clamp(2.375 - (box.int / box.att) * 25);
  return ((a + b + c + d) / 6) * 100;
}

export function formatPasser(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(1);
}
