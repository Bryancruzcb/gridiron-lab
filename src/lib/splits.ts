import type { QbSeason, SplitStats } from "@/data/types";

export type DownFilter = "all" | "1" | "2" | "3" | "4";
export type DistFilter = "all" | "short" | "medium" | "long";
export type SitFilter =
  | "all"
  | "redzone"
  | "twominute"
  | "trailing"
  | "leading"
  | "neutral"
  | "pressured"
  | "clean";

export function splitKey(down: DownFilter, dist: DistFilter, sit: SitFilter): string {
  if (sit !== "all") return sit;
  if (down !== "all" && dist !== "all") return `d${down}_${dist}`;
  if (down !== "all") return `down${down}`;
  if (dist !== "all") return `dist_${dist}`;
  return "all";
}

export function statsFor(qb: QbSeason, key: string): SplitStats | null {
  if (key === "all") return qb.overall;
  return qb.splits[key] ?? null;
}

export function splitLabel(down: DownFilter, dist: DistFilter, sit: SitFilter): string {
  if (sit !== "all") {
    const map: Record<SitFilter, string> = {
      all: "Overall",
      redzone: "Red zone",
      twominute: "Two-minute",
      trailing: "Trailing",
      leading: "Leading",
      neutral: "Neutral score",
      pressured: "Pressured",
      clean: "Clean pocket",
    };
    return map[sit];
  }
  const downs: Record<DownFilter, string> = {
    all: "",
    "1": "1st",
    "2": "2nd",
    "3": "3rd",
    "4": "4th",
  };
  const dists: Record<DistFilter, string> = {
    all: "",
    short: "short (1–3)",
    medium: "medium (4–6)",
    long: "long (7+)",
  };
  const d = downs[down];
  const y = dists[dist];
  if (d && y) return `${d} & ${y}`;
  if (d) return `${d} down`;
  if (y) return y;
  return "Overall";
}
