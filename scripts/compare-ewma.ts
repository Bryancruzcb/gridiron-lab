/** EWMA α sweep on the same 2025 holdout as compare-proj.ts */
import { readFileSync, writeFileSync } from "node:fs";
import { solveLineup } from "../src/lib/optimizer.ts";
import { fnum, parseCsvLine, round, UA } from "../src/lib/live/csv.ts";
import type { FantasyFile, FantasyPlayer } from "../src/data/types.ts";

const PLAYER_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2025.csv";
const TEAM_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_2025.csv";

const ALPHAS = Array.from({ length: 20 }, (_, i) => round(0.05 * (i + 1), 2));

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

function ewma(xs: number[], alpha: number) {
  if (!xs.length) return 0;
  let v = xs[0]!;
  for (let i = 1; i < xs.length; i++) v = alpha * xs[i]! + (1 - alpha) * v;
  return v;
}

function maeOf(pairs: { y: number; yhat: number }[]) {
  if (!pairs.length) return 0;
  return round(pairs.reduce((s, p) => s + Math.abs(p.y - p.yhat), 0) / pairs.length, 2);
}

function rmseOf(pairs: { y: number; yhat: number }[]) {
  if (!pairs.length) return 0;
  return round(Math.sqrt(pairs.reduce((s, p) => s + (p.y - p.yhat) ** 2, 0) / pairs.length), 2);
}

async function main() {
  const fantasy = JSON.parse(readFileSync(new URL("../src/data/fantasy.json", import.meta.url), "utf8")) as FantasyFile;
  const [playerText, teamText] = await Promise.all([fetchText(PLAYER_URL), fetchText(TEAM_URL)]);
  const pcsv = rows(playerText);
  const tcsv = rows(teamText);

  const byId = new Map<string, { week: number; ppr: number }[]>();
  for (const line of pcsv.body) {
    const cells = parseCsvLine(line);
    if (pcsv.get(cells, "season_type") && pcsv.get(cells, "season_type") !== "REG") continue;
    const id = pcsv.get(cells, "player_id");
    const week = fnum(pcsv.get(cells, "week"));
    if (!id || week == null) continue;
    const arr = byId.get(id) ?? [];
    arr.push({ week, ppr: fnum(pcsv.get(cells, "fantasy_points_ppr")) ?? 0 });
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
    teamAt.set(`${week}|${team}`, {
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
    });
  }

  const dstByTeam = new Map<string, { week: number; ppr: number }[]>();
  for (const t of teamAt.values()) {
    const opp = teamAt.get(`${t.week}|${t.opp}`);
    const pa = opp ? opp.passTd * 7 + opp.rushTd * 7 + opp.fg * 3 + opp.pat : 24;
    const ppr = dstPpr({ pa, sacks: t.sacks, ints: t.ints, turnovers: t.ints + t.recov, defTd: t.defTd });
    const arr = dstByTeam.get(t.team) ?? [];
    arr.push({ week: t.week, ppr });
    dstByTeam.set(t.team, arr);
  }
  for (const arr of dstByTeam.values()) arr.sort((a, b) => a.week - b.week);

  function prior(p: FantasyFile["players"][number], before: number) {
    if (p.pos === "DST") return (dstByTeam.get(p.team) ?? []).filter((r) => r.week < before).map((r) => r.ppr);
    return (byId.get(p.id) ?? []).filter((r) => r.week < before).map((r) => r.ppr);
  }
  function actual(p: FantasyFile["players"][number], week: number) {
    if (p.pos === "DST") return (dstByTeam.get(p.team) ?? []).find((r) => r.week === week)?.ppr ?? null;
    const row = byId.get(p.id)?.find((r) => r.week === week);
    return row ? row.ppr : null;
  }

  function scoreMethod(yhatOf: (prior: number[]) => number) {
    const err: { y: number; yhat: number }[] = [];
    const luPts: number[] = [];
    for (let w = 2; w <= 18; w++) {
      const slate: FantasyPlayer[] = [];
      const act = new Map<string, number>();
      for (const p of fantasy.players) {
        const hist = prior(p, w);
        if (!hist.length) continue;
        const yhat = yhatOf(hist);
        const y = actual(p, w);
        slate.push({
          id: p.id,
          name: p.name,
          pos: p.pos,
          team: p.team,
          headshot: p.headshot,
          games: hist.length,
          ppr: null,
          ppg: yhat,
          proj: round(yhat, 2),
          recencyPpg: yhat,
          salary: p.salary,
        });
        act.set(p.id, y ?? 0);
        if (y != null) err.push({ y, yhat });
      }
      const solved = solveLineup({ players: slate, cap: fantasy.cap, method: "exact-dp" });
      if (solved.status !== "ok") {
        // Strict exact study: the week is invalid, never filled by a heuristic.
        console.log(`w${w}: exact-dp ${solved.status}/${solved.code}, week invalid`);
        continue;
      }
      luPts.push(solved.lineup.players.reduce((s, p) => s + (act.get(p.id) ?? 0), 0));
    }
    const sorted = [...luPts].sort((a, b) => a - b);
    return {
      mae: maeOf(err),
      rmse: rmseOf(err),
      n: err.length,
      lineupMean: round(mean(luPts), 1),
      lineupMedian: round(sorted[Math.floor((sorted.length - 1) / 2)] ?? 0, 1),
      weeks: luPts.length,
    };
  }

  const trail = scoreMethod((hist) => mean(hist));
  const points = ALPHAS.map((alpha) => {
    const s = scoreMethod((hist) => ewma(hist, alpha));
    console.log(`α=${alpha.toFixed(2)} mae=${s.mae} lineup=${s.lineupMean}`);
    return { alpha, ...s };
  });

  const bestLineup = points.reduce((a, b) => (b.lineupMean > a.lineupMean ? b : a));
  const bestMae = points.reduce((a, b) => (b.mae < a.mae ? b : a));

  const out = {
    source: "nflverse 2025 REG, EWMA on trailing PPR, frozen 114-player salaries",
    season: 2025,
    note: "α=1 is last week only. Trailing mean is not α=0 — small α sticks to week 1.",
    trail,
    points,
    bestLineup: { alpha: bestLineup.alpha, lineupMean: bestLineup.lineupMean, mae: bestLineup.mae },
    bestMae: { alpha: bestMae.alpha, mae: bestMae.mae, lineupMean: bestMae.lineupMean },
  };
  writeFileSync(new URL("../src/data/study-ewma.json", import.meta.url), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ trail, bestLineup: out.bestLineup, bestMae: out.bestMae }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
