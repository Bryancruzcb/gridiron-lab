import { readFileSync, writeFileSync } from "node:fs";
import { solveLineup } from "../src/lib/optimizer.ts";
import type { SolveResult, SolverMethod } from "../src/lib/optimizer.ts";
import { fnum, parseCsvLine, round, UA } from "../src/lib/live/csv.ts";
import type { BacktestFile, FantasyFile, FantasyPlayer, QbLagFile, QbLagPoint, StudyWeek } from "../src/data/types.ts";

const PLAYER_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2025.csv";
const TEAM_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_2025.csv";

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

function pearson(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 3) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i]!;
    my += ys[i]!;
  }
  mx /= n;
  my /= n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i]! - mx;
    const y = ys[i]! - my;
    num += x * y;
    dx += x * x;
    dy += y * y;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? null : round(num / den, 3);
}

function median(vals: number[]) {
  if (!vals.length) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const m = (s.length - 1) / 2;
  const lo = s[Math.floor(m)]!;
  const hi = s[Math.ceil(m)]!;
  return round((lo + hi) / 2, 1);
}

function mean(vals: number[]) {
  if (!vals.length) return 0;
  return round(vals.reduce((a, b) => a + b, 0) / vals.length, 1);
}

function scoreOf(players: FantasyPlayer[], actuals: Map<string, number>) {
  let pts = 0;
  for (const p of players) pts += actuals.get(p.id) ?? 0;
  return round(pts, 1);
}

async function main() {
  const fantasy = JSON.parse(readFileSync(new URL("../src/data/fantasy.json", import.meta.url), "utf8")) as FantasyFile;
  const [playerText, teamText] = await Promise.all([fetchText(PLAYER_URL), fetchText(TEAM_URL)]);

  const pcsv = rows(playerText);
  const tcsv = rows(teamText);

  type SkillW = { week: number; ppr: number; att: number; epa: number | null; cpoe: number | null; name: string; team: string };
  const byId = new Map<string, SkillW[]>();
  const qbWeeks = new Map<string, SkillW[]>();

  for (const line of pcsv.body) {
    const cells = parseCsvLine(line);
    if (pcsv.get(cells, "season_type") && pcsv.get(cells, "season_type") !== "REG") continue;
    const id = pcsv.get(cells, "player_id");
    const week = fnum(pcsv.get(cells, "week"));
    if (!id || week == null) continue;
    const att = fnum(pcsv.get(cells, "attempts")) ?? 0;
    const epaTot = fnum(pcsv.get(cells, "passing_epa"));
    const row: SkillW = {
      week,
      ppr: fnum(pcsv.get(cells, "fantasy_points_ppr")) ?? 0,
      att,
      epa: epaTot != null && att > 0 ? epaTot / att : null,
      cpoe: fnum(pcsv.get(cells, "passing_cpoe")),
      name: pcsv.get(cells, "player_display_name") || pcsv.get(cells, "player_name"),
      team: pcsv.get(cells, "team"),
    };
    const arr = byId.get(id) ?? [];
    arr.push(row);
    byId.set(id, arr);
    if (pcsv.get(cells, "position") === "QB") {
      const q = qbWeeks.get(id) ?? [];
      q.push(row);
      qbWeeks.set(id, q);
    }
  }

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
  const teams: TeamW[] = [];
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
    teams.push(tw);
    teamAt.set(`${week}|${team}`, tw);
  }

  const dstByTeam = new Map<string, { week: number; ppr: number }[]>();
  for (const t of teams) {
    const opp = teamAt.get(`${t.week}|${t.opp}`);
    const pa = opp ? opp.passTd * 7 + opp.rushTd * 7 + opp.fg * 3 + opp.pat : 24;
    const ppr = dstPpr({
      pa,
      sacks: t.sacks,
      ints: t.ints,
      turnovers: t.ints + t.recov,
      defTd: t.defTd,
    });
    const arr = dstByTeam.get(t.team) ?? [];
    arr.push({ week: t.week, ppr });
    dstByTeam.set(t.team, arr);
  }

  function history(p: FantasyFile["players"][number], before: number): number[] {
    if (p.pos === "DST") {
      return (dstByTeam.get(p.team) ?? []).filter((r) => r.week < before).map((r) => r.ppr);
    }
    return (byId.get(p.id) ?? []).filter((r) => r.week < before).map((r) => r.ppr);
  }

  function actual(p: FantasyFile["players"][number], week: number): number {
    if (p.pos === "DST") {
      return (dstByTeam.get(p.team) ?? []).find((r) => r.week === week)?.ppr ?? 0;
    }
    return (byId.get(p.id) ?? []).find((r) => r.week === week)?.ppr ?? 0;
  }

  const weeks: StudyWeek[] = [];

  for (let w = 2; w <= 18; w++) {
    const slate: FantasyPlayer[] = [];
    const act = new Map<string, number>();
    for (const p of fantasy.players) {
      const prior = history(p, w);
      if (!prior.length) continue;
      const proj = prior.reduce((a, b) => a + b, 0) / prior.length;
      slate.push({
        id: p.id,
        name: p.name,
        pos: p.pos,
        team: p.team,
        headshot: p.headshot,
        games: prior.length,
        ppr: null,
        ppg: proj,
        proj: round(proj, 2),
        recencyPpg: proj,
        salary: p.salary,
      });
      act.set(p.id, round(actual(p, w), 1));
    }
    const solve = (method: SolverMethod) => solveLineup({ players: slate, cap: fantasy.cap, method });
    const pack = (r: SolveResult) =>
      r.status === "ok"
        ? { proj: round(r.lineup.proj, 1), actual: scoreOf(r.lineup.players, act), salary: r.lineup.salary }
        : null;
    // Strict exact study: a failed exact solve makes the week invalid; it is never back-filled by hill-climb.
    const results = { exact: solve("exact-dp"), greedyProj: solve("greedy-proj"), greedyValue: solve("greedy-value") };
    const exact = pack(results.exact);
    const greedyProj = pack(results.greedyProj);
    const greedyValue = pack(results.greedyValue);
    if (!exact || !greedyProj || !greedyValue) {
      const failures = Object.entries(results).flatMap(([name, r]) => (r.status === "ok" ? [] : [`${name} ${r.status}/${r.code}`]));
      console.log("invalid week", w, { n: slate.length, failures });
      continue;
    }
    weeks.push({ week: w, players: slate.length, exact, greedyProj, greedyValue });
    console.log(`week ${w} n=${slate.length} exact=${exact.actual} projG=${greedyProj.actual} valG=${greedyValue.actual}`);
  }

  const exactA = weeks.map((w) => w.exact.actual);
  const gpA = weeks.map((w) => w.greedyProj.actual);
  const gvA = weeks.map((w) => w.greedyValue.actual);
  const backtest: BacktestFile = {
    source: "nflverse player week + team week 2025 REG",
    season: 2025,
    cap: fantasy.cap,
    notes: [
      "Salaries are synthetic DraftKings-style prices from the 114-player slate, frozen all year — not live DK prices.",
      "Projection is trailing mean PPR over weeks 1..w-1. Week 1 is dropped.",
      "Weeks where exact DP does not return a proven lineup are logged as invalid and left out; there is no hill-climb fallback.",
    ],
    weeks,
    summary: {
      weeks: weeks.length,
      exactMean: mean(exactA),
      exactMedian: median(exactA),
      greedyProjMean: mean(gpA),
      greedyValueMean: mean(gvA),
      exactBeatsProj: weeks.filter((w) => w.exact.actual > w.greedyProj.actual).length,
      exactBeatsValue: weeks.filter((w) => w.exact.actual > w.greedyValue.actual).length,
    },
  };

  const pairs: QbLagPoint[] = [];
  for (const [id, list] of qbWeeks) {
    const sorted = [...list].sort((a, b) => a.week - b.week);
    const atWeek = new Map(sorted.map((r) => [r.week, r]));
    for (const prev of sorted) {
      if (prev.att < 15 || prev.epa == null) continue;
      const next = atWeek.get(prev.week + 1);
      if (!next || next.att < 15 || next.epa == null) continue;
      pairs.push({
        id,
        name: next.name,
        team: next.team,
        week: next.week,
        epaPrev: round(prev.epa, 3),
        epaNext: round(next.epa, 3),
        cpoePrev: prev.cpoe != null ? round(prev.cpoe, 1) : null,
        cpoeNext: next.cpoe != null ? round(next.cpoe, 1) : null,
        attPrev: prev.att,
        attNext: next.att,
      });
    }
  }

  const lag: QbLagFile = {
    source: "nflverse player week 2025 REG, passing_epa/attempts and passing_cpoe",
    season: 2025,
    minAttempts: 15,
    n: pairs.length,
    corrEpa: pearson(
      pairs.map((p) => p.epaPrev),
      pairs.map((p) => p.epaNext),
    ),
    corrCpoe: pearson(
      pairs.filter((p) => p.cpoePrev != null && p.cpoeNext != null).map((p) => p.cpoePrev!),
      pairs.filter((p) => p.cpoePrev != null && p.cpoeNext != null).map((p) => p.cpoeNext!),
    ),
    pairs,
  };

  writeFileSync(new URL("../src/data/study-backtest.json", import.meta.url), JSON.stringify(backtest));
  writeFileSync(new URL("../src/data/study-qb-lag.json", import.meta.url), JSON.stringify(lag));
  console.log(JSON.stringify({ backtest: backtest.summary, qb: { n: lag.n, corrEpa: lag.corrEpa, corrCpoe: lag.corrCpoe } }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
