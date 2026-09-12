import type { TeamMeta } from "@/data/types";
import playcalling from "@/data/playcalling.json";

export const TEAM_META = playcalling.teamMeta as Record<string, TeamMeta>;

export function teamName(abbr: string) {
  const t = TEAM_META[abbr];
  return t ? `${t.city} ${t.name}` : abbr;
}

export function teamNick(abbr: string) {
  return TEAM_META[abbr]?.name ?? abbr;
}

export function teamColor(abbr: string) {
  return TEAM_META[abbr]?.color ?? "#6B6D68";
}

/** ESPN CDN. nflverse uses LA / WAS; ESPN uses LAR / WSH. */
const NFL_TO_ESPN: Record<string, string> = { LA: "LAR", WAS: "WSH" };

export function teamLogo(abbr: string) {
  const espn = NFL_TO_ESPN[abbr] ?? abbr;
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${espn}.png`;
}

export const CHART = {
  grid: "rgba(241,240,234,0.08)",
  axis: "#93958F",
  tick: "#93958F",
  tooltipBg: "#1A1D24",
  tooltipBorder: "rgba(241,240,234,0.12)",
  paper: "#C5CCD6",
  sage: "#7A9A7A",
  rust: "#C47868",
  fg: "#F1F0EA",
  muted: "#93958F",
  series: ["#C5CCD6", "#7A9A7A", "#E8E4D9", "#8A9BB0", "#C47868", "#A3B18A", "#D4C4A8", "#6E7F91"],
};

export function initials(name: string) {
  const parts = name.split(" ").filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}
