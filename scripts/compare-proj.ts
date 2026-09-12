/**
 * Causal projection bake-off on 2025 weeks 2–18.
 * No future weeks, no 2026 peek. Writes src/data/study-projections.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { solveLineup } from "../src/lib/optimizer.ts";
import { fnum, parseCsvLine, round, UA } from "../src/lib/live/csv.ts";
import type { FantasyFile, FantasyPlayer } from "../src/data/types.ts";

const PLAYER_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2025.csv";
const TEAM_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_2025.csv";

type SkillW = {
  week: number;
  ppr: number;
  att: number;
  carries: number;
  targets: number;
  team: string;
  opp: string;
  pos: string;
};

async function fetchText(url: string) {
  const res = await fetch(url, { headers: UA, redirect: "follow" });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.text();
}

function rows(text: string) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0] ?? "");
  const idx: Record<string, number> = {};
  for (let i = 0; i < header.length; i++) idx[header[i]!] = i;
  const get = (cells: string[], c: string) => {
    const i = idx[c];
    return i == null ? "" : (cells[i] ?? "");
  };
  return { get, body: lines.slice(1) };
}

function dstPpr(opts: { pa: number; sacks: number; ints: number; turnovers: number; defTd: number }) {
  const fum = Math.max(0, opts.turnovers - opts.ints);
  let pts = opts.sacks * 1 + opts.ints * 2 + fum * 2 + opts.defTd * 6;
  if (opts.pa <= 0) pts += 10;
  else if (opts.pa <= 6) pts += 7;
  else if (opts.pa <= 13) pts += 4;
  else if (opts.pa <= 20) pts += 1;
  else if (opts.pa <= 27) pts += 0;
  else if (opts.pa <= 34) pts -= 1;
  else pts -= 4;
  return round(pts, 1);
}

function mean(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function lastN(xs: number[], n: number) {
  return xs.slice(-n);
}

function ewma(xs: number[], alpha: number) {
  if (!xs.length) return 0;
  let v = xs[0]!;
  for (let i = 1; i < xs.length; i++) v = alpha * xs[i]! + (1 - alpha) * v;
  return v;
}

function mae(pairs: { y: number; yhat: number }[]) {
  if (!pairs.length) return 0;
  return round(pairs.reduce((s, p) => s + Math.abs(p.y - p.yhat), 0) / pairs.length, 2);
}

function rmse(pairs: { y: number; yhat: number }[]) {
  if (!pairs.length) return 0;
  return round(Math.sqrt(pairs.reduce((s, p) => s + (p.y - p.yhat) ** 2, 0) / pairs.length), 2);
}

const METHODS = ["trail", "last1", "last3", "blend", "ewma", "shrink", "usage", "opp"] as const;
type Method = (typeof METHODS)[number];

async function main() {
  const fantasy = JSON.parse(readFileSync(new URL("../src/data/fantasy.json", import.meta.url), "utf8")) as FantasyFile;
  const [playerText, teamText] = await Promise.all([fetchText(PLAYER_URL), fetchText(TEAM_URL)]);
  const pcsv = rows(playerText);
  const tcsv = rows(teamText);

  const byId = new Map<string, SkillW[]>();
  for (const line of pcsv.body) {
    const cells = parseCsvLine(line);
    if (pcsv.get(cells, "season_type") && pcsv.get(cells, "season_type") !== "REG") continue;
    const id = pcsv.get(cells, "player_id");
    const week = fnum(pcsv.get(cells, "week"));
    if (!id || week == null) continue;
    const row: SkillW = {
      week,
      ppr: fnum(pcsv.get(cells, "fantasy_points_ppr")) ?? 0,
      att: fnum(pcsv.get(cells, "attempts")) ?? 0,
      carries: fnum(pcsv.get(cells, "carries")) ?? 0,
      targets: fnum(pcsv.get(cells, "targets")) ?? 0,
      team: pcsv.get(cells, "team"),
      opp: pcsv.get(cells, "opponent_team"),
      pos: pcsv.get(cells, "position"),
    };
    const arr = byId.get(id) ?? [];
    arr.push(row);
    byId.set(id, arr);
  }
  for (const arr of byId.values()) arr.sort((a, b) => a.week - b.week);

  type TeamW = {
    week: number;
    team: string;
    opp: string;
    sacks: number;
    ints: number;
    recov: number;
    defTd: number;
    passTd: number;
    rushTd: number;
    fg: number;
    pat: number;
  };
  const teamAt = new Map<string, TeamW>();
  for (const line of tcsv.body) {
    const cells = parseCsvLine(line);
    if (tcsv.get(cells, "season_type") && tcsv.get(cells, "season_type") !== "REG") continue;
    const week = fnum(tcsv.get(cells, "week"));
    const team = tcsv.get(cells, "team");
    if (week == null || !team) continue;
    const tw: TeamW = {
      week,
      team,
      opp: tcsv.get(cells, "opponent_team"),
      sacks: fnum(tcsv.get(cells, "def_sacks")) ?? 0,
      ints: fnum(tcsv.get(cells, "def_interceptions")) ?? 0,
      recov: fnum(tcsv.get(cells, "fumble_recovery_opp")) ?? 0,
      defTd: fnum(tcsv.get(cells, "def_tds")) ?? 0,
      passTd: fnum(tcsv.get(cells, "passing_tds")) ?? 0,
      rushTd: fnum(tcsv.get(cells, "rushing_tds")) ?? 0,
      fg: fnum(tcsv.get(cells, "fg_made")) ?? 0,
      pat: fnum(tcsv.get(cells, "pat_made")) ?? 0,
    };
    teamAt.set(`${week}|${team}`, tw);
  }

  const dstByTeam = new Map<string, { week: number; ppr: number; opp: string }[]>();
  for (const t of teamAt.values()) {
    const opp = teamAt.get(`${t.week}|${t.opp}`);
    const pa = opp ? opp.passTd * 7 + opp.rushTd * 7 + opp.fg * 3 + opp.pat : 24;
    const ppr = dstPpr({ pa, sacks: t.sacks, ints: t.ints, turnovers: t.ints + t.recov, defTd: t.defTd });
    const arr = dstByTeam.get(t.team) ?? [];
    arr.push({ week: t.week, ppr, opp: t.opp });
    dstByTeam.set(t.team, arr);
  }
  for (const arr of dstByTeam.values()) arr.sort((a, b) => a.week - b.week);

  const errors: Record<Method, { y: number; yhat: number }[]> = {
    trail: [],
    last1: [],
    last3: [],
    blend: [],
    ewma: [],
    shrink: [],
    usage: [],
    opp: [],
  };
  const lineupActual: Record<Method, number[]> = {
    trail: [],
    last1: [],
    last3: [],
    blend: [],
    ewma: [],
    shrink: [],
    usage: [],
    opp: [],
  };

  function posMean(pos: string, before: number) {
    const xs: number[] = [];
    for (const p of fantasy.players) {
      if (p.pos !== pos) continue;
      if (pos === "DST") {
        for (const r of dstByTeam.get(p.team) ?? []) if (r.week < before) xs.push(r.ppr);
      } else {
        for (const r of byId.get(p.id) ?? []) if (r.week < before) xs.push(r.ppr);
      }
    }
    return mean(xs) || 8;
  }

  function oppAllowed(pos: string, opp: string, before: number) {
    const xs: number[] = [];
    if (pos === "DST") {
      for (const arr of dstByTeam.values()) {
        for (const r of arr) if (r.week < before && r.opp === opp) xs.push(r.ppr);
      }
    } else {
      for (const arr of byId.values()) {
        for (const r of arr) if (r.week < before && r.pos === pos && r.opp === opp) xs.push(r.ppr);
      }
    }
    return xs.length ? mean(xs) : posMean(pos, before);
  }

  function thisOpp(p: FantasyFile["players"][number], week: number) {
    if (p.pos === "DST") return dstByTeam.get(p.team)?.find((r) => r.week === week)?.opp ?? "";
    return byId.get(p.id)?.find((r) => r.week === week)?.opp ?? "";
  }

  function priorPpr(p: FantasyFile["players"][number], before: number) {
    if (p.pos === "DST") return (dstByTeam.get(p.team) ?? []).filter((r) => r.week < before).map((r) => r.ppr);
    return (byId.get(p.id) ?? []).filter((r) => r.week < before).map((r) => r.ppr);
  }

  function actual(p: FantasyFile["players"][number], week: number) {
    if (p.pos === "DST") return (dstByTeam.get(p.team) ?? []).find((r) => r.week === week)?.ppr ?? null;
    const row = byId.get(p.id)?.find((r) => r.week === week);
    return row ? row.ppr : null;
  }

  function usageProj(p: FantasyFile["players"][number], before: number) {
    if (p.pos === "DST") return mean(priorPpr(p, before));
    const rows = (byId.get(p.id) ?? []).filter((r) => r.week < before);
    if (!rows.length) return 0;
    const vol = rows.map((r) => {
      if (p.pos === "QB") return Math.max(r.att, 1);
      return Math.max(r.carries + r.targets, 1);
    });
    const rate = rows.map((r, i) => r.ppr / vol[i]!);
    const expVol = mean(lastN(vol, 3));
    const expRate = mean(rate);
    return expVol * expRate;
  }

  function predict(method: Method, p: FantasyFile["players"][number], week: number, prior: number[]) {
    const trail = mean(prior);
    const l3 = mean(lastN(prior, 3));
    const l1 = prior[prior.length - 1] ?? trail;
    const pm = posMean(p.pos, week);
    if (method === "trail") return trail;
    if (method === "last1") return l1;
    if (method === "last3") return l3;
    if (method === "blend") return 0.6 * trail + 0.4 * l3;
    if (method === "ewma") return ewma(prior, 0.35);
    if (method === "shrink") {
      const n = prior.length;
      const k = 4;
      return (n / (n + k)) * trail + (k / (n + k)) * pm;
    }
    if (method === "usage") return usageProj(p, week);
    const opp = thisOpp(p, week);
    const factor = opp ? oppAllowed(p.pos, opp, week) / pm : 1;
    return trail * Math.min(1.3, Math.max(0.7, factor));
  }

  for (let w = 2; w <= 18; w++) {
    const eligible = fantasy.players.filter((p) => priorPpr(p, w).length > 0);
    const posAv: Record<string, number> = {};
    for (const pos of ["QB", "RB", "WR", "TE", "DST"]) posAv[pos] = posMean(pos, w);

    for (const method of METHODS) {
      const slate: FantasyPlayer[] = [];
      const act = new Map<string, number>();
      for (const p of eligible) {
        const prior = priorPpr(p, w);
        const yhat = predict(method, p, w, prior);
        const y = actual(p, w);
        slate.push({
          id: p.id,
          name: p.name,
          pos: p.pos,
          team: p.team,
          headshot: p.headshot,
          games: prior.length,
          ppr: null,
          ppg: yhat,
          proj: round(yhat, 2),
          recencyPpg: yhat,
          salary: p.salary,
        });
        act.set(p.id, y ?? 0);
        if (y != null) errors[method].push({ y, yhat });
      }
      const solved = solveLineup({ players: slate, cap: fantasy.cap, method: "exact-dp" });
      if (solved.status !== "ok") {
        // Strict exact study: the week is invalid for this model, never filled by a heuristic.
        console.log(`\nw${w} ${method}: exact-dp ${solved.status}/${solved.code}, week invalid`);
        continue;
      }
      let pts = 0;
      for (const p of solved.lineup.players) pts += act.get(p.id) ?? 0;
      lineupActual[method].push(pts);
    }
    process.stdout.write(`w${w} `);
  }

  const models = METHODS.map((id) => {
    const lu = lineupActual[id];
    return {
      id,
      label:
        id === "trail"
          ? "Trailing mean"
          : id === "last1"
            ? "Last week"
            : id === "last3"
              ? "Last 3"
              : id === "blend"
                ? "60/40 season + last 3"
                : id === "ewma"
                  ? "EWMA α=0.35"
                  : id === "shrink"
                    ? "Shrink to position"
                    : id === "usage"
                      ? "Usage × rate"
                      : "Opponent-adjusted trail",
      mae: mae(errors[id]),
      rmse: rmse(errors[id]),
      n: errors[id].length,
      lineupMean: round(mean(lineupActual[id]), 1),
      lineupMedian: round(
        [...lineupActual[id]].sort((a, b) => a - b)[Math.floor((lineupActual[id].length - 1) / 2)] ?? 0,
        1,
      ),
      weeks: lu.length,
    };
  });

  const out = {
    source: "nflverse 2025 REG, same frozen salaries and 114-player pool as Study",
    season: 2025,
    notes: [
      "Each model only uses weeks 1..w-1. Opponent for week w is the scheduled opponent (allowed).",
      "MAE is per player-week among those who played. Lineup mean is exact-DP actual PPR.",
    ],
    models,
  };
  writeFileSync(new URL("../src/data/study-projections.json", import.meta.url), JSON.stringify(out, null, 2));
  console.log("\n" + JSON.stringify(models, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
