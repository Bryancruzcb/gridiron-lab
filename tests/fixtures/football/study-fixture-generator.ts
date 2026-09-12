// Writes the synthetic study fixtures next to this file: four teams (AAA-DDD), a prior season
// (2040, weeks 1-2) and an evaluated season (2041, weeks 1-5 with week 5 not final), in the column
// layout of the nflverse stats files and nfldata games.csv. Deterministic. After editing, re-run
// and commit the outputs together with study-fixtures.sha256.json:
//   node --experimental-strip-types tests/fixtures/football/study-fixture-generator.ts

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const TEAMS = ["AAA", "BBB", "CCC", "DDD"] as const;
type Team = (typeof TEAMS)[number];
const SLOTS = [
  ["QB", "QB"],
  ["RB1", "RB"],
  ["RB2", "RB"],
  ["WR1", "WR"],
  ["WR2", "WR"],
  ["TE", "TE"],
] as const;

type Game = { season: number; week: number; away: Team; home: Team; final: boolean };

const GAMES: Game[] = [
  { season: 2040, week: 1, away: "AAA", home: "BBB", final: true },
  { season: 2040, week: 1, away: "CCC", home: "DDD", final: true },
  { season: 2040, week: 2, away: "AAA", home: "CCC", final: true },
  { season: 2040, week: 2, away: "BBB", home: "DDD", final: true },
  { season: 2041, week: 1, away: "AAA", home: "BBB", final: true },
  { season: 2041, week: 1, away: "CCC", home: "DDD", final: true },
  { season: 2041, week: 2, away: "AAA", home: "CCC", final: true },
  { season: 2041, week: 2, away: "BBB", home: "DDD", final: true },
  // AAA and BBB are on bye in week 3.
  { season: 2041, week: 3, away: "CCC", home: "DDD", final: true },
  { season: 2041, week: 4, away: "AAA", home: "DDD", final: true },
  { season: 2041, week: 4, away: "BBB", home: "CCC", final: true },
  // Not final: no stat rows and no scores yet; CCC and DDD are on bye.
  { season: 2041, week: 5, away: "AAA", home: "BBB", final: false },
];

type TeamGame = { passTd: number; rushTd: number; fg: number; defTd: number; ints: number; sacks: number; fumblesLost: number };

const OVERRIDES: Record<string, Partial<TeamGame>> = {
  // AAA scores 17 on 2 TDs, 2 PATs and 1 FG: BBB allows 17; the legacy formula says 19.
  "2041-1-AAA": { passTd: 1, rushTd: 1, fg: 1 },
  // BBB scores 13 on 1 TD, 1 PAT and 2 FG: DDD's tier is 7-13 (+4); legacy 14 lands in 14-20 (+1).
  "2041-2-BBB": { passTd: 1, rushTd: 0, fg: 2 },
  "2041-2-CCC": { sacks: 3 },
  // DDD returns AAA's interception for a touchdown.
  "2041-4-AAA": { ints: 1 },
  "2041-4-DDD": { defTd: 1 },
};
/** The team's own def_sacks miss one sack (the legacy DST input). */
const UNDERCOUNT = new Set(["2041-2-AAA"]);
/** No stat row: inactive in a final game. */
const ABSENT = new Set(["2041-2-AAA-WR2", "2041-4-CCC-TE"]);
/** A row with every count zero: played and scored 0. */
const ZERO = new Set(["2041-3-DDD-WR2"]);

const PLAYER_COLUMNS = [
  "player_id", "player_name", "player_display_name", "position", "headshot_url", "season", "week", "season_type",
  "game_id", "team", "opponent_team", "completions", "attempts", "passing_yards", "passing_tds",
  "passing_interceptions", "sacks_suffered", "sack_fumbles_lost", "passing_2pt_conversions", "passing_epa",
  "passing_cpoe", "carries", "rushing_yards", "rushing_tds", "rushing_fumbles_lost", "rushing_2pt_conversions",
  "receptions", "targets", "receiving_yards", "receiving_tds", "receiving_fumbles_lost",
  "receiving_2pt_conversions", "special_teams_tds",
];

const TEAM_COLUMNS = [
  "season", "week", "team", "season_type", "game_id", "opponent_team", "passing_interceptions", "sacks_suffered",
  "fumbles_lost_total", "passing_tds", "rushing_tds", "special_teams_tds", "def_tds", "fumble_recovery_tds",
  "def_safeties", "def_2pt_made", "def_punt_blocks", "def_fg_blocks", "def_pat_blocks", "pat_made", "fg_made",
  "passing_2pt_conversions", "rushing_2pt_conversions", "def_sacks", "def_interceptions", "fumble_recovery_opp",
];

type Row = Record<string, string | number>;

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const n = (key: string, mod: number) => fnv(key) % mod;
const gameId = (g: Game) => `${g.season}_${String(g.week).padStart(2, "0")}_${g.away}_${g.home}`;

function teamGame(g: Game, team: Team): TeamGame {
  const k = `${g.season}-${g.week}-${team}`;
  return {
    passTd: n(`${k}p`, 3),
    rushTd: n(`${k}r`, 2),
    fg: n(`${k}f`, 3),
    defTd: 0,
    ints: n(`${k}i`, 2),
    sacks: n(`${k}s`, 4),
    fumblesLost: n(`${k}l`, 4) === 0 ? 1 : 0,
    ...OVERRIDES[k],
  };
}

const points = (tg: TeamGame) => 6 * (tg.passTd + tg.rushTd + tg.defTd) + (tg.passTd + tg.rushTd + tg.defTd) + 3 * tg.fg;

function playerRow(g: Game, team: Team, opp: Team, slot: string, pos: string, tg: TeamGame): Row {
  const k = `${g.season}-${g.week}-${team}-${slot}`;
  const row: Row = Object.fromEntries(PLAYER_COLUMNS.map((c) => [c, 0]));
  Object.assign(row, {
    player_id: `${team}-${slot}`,
    player_name: `${team}.${slot}`,
    player_display_name: `${team} ${slot}`,
    position: pos,
    headshot_url: "NA",
    season: g.season,
    week: g.week,
    season_type: "REG",
    game_id: gameId(g),
    team,
    opponent_team: opp,
    passing_epa: "NA",
    passing_cpoe: "NA",
  });
  if (ZERO.has(k)) return row;
  const targets = (base: number, spread: number) => base + n(`${k}t`, spread);
  switch (slot) {
    case "QB": {
      const attempts = 22 + n(`${k}a`, 14);
      const yards = 140 + n(`${k}y`, 160);
      Object.assign(row, {
        completions: Math.round(attempts * 0.62),
        attempts,
        passing_yards: yards,
        passing_tds: tg.passTd,
        passing_interceptions: tg.ints,
        sacks_suffered: tg.sacks,
        passing_epa: ((yards - 220) / 12 + tg.passTd * 1.5 - tg.ints * 2.5).toFixed(2),
        passing_cpoe: ((n(`${k}c`, 200) - 100) / 10).toFixed(1),
        carries: 1 + n(`${k}qc`, 4),
        rushing_yards: n(`${k}qr`, 20),
      });
      break;
    }
    case "RB1": {
      const t = targets(2, 4);
      Object.assign(row, {
        carries: 10 + n(`${k}c`, 10),
        rushing_yards: 35 + n(`${k}y`, 70),
        rushing_tds: tg.rushTd,
        rushing_fumbles_lost: tg.fumblesLost,
        targets: t,
        receptions: t - 1,
        receiving_yards: 4 + n(`${k}ry`, 30),
      });
      break;
    }
    case "RB2": {
      const t = targets(1, 3);
      Object.assign(row, {
        carries: 4 + n(`${k}c`, 6),
        rushing_yards: 12 + n(`${k}y`, 35),
        targets: t,
        receptions: t - 1,
        receiving_yards: n(`${k}ry`, 20),
      });
      break;
    }
    case "WR1": {
      const t = targets(6, 6);
      Object.assign(row, { targets: t, receptions: t - 2, receiving_yards: 35 + n(`${k}ry`, 80), receiving_tds: Math.ceil(tg.passTd / 2) });
      break;
    }
    case "WR2": {
      const t = targets(3, 5);
      Object.assign(row, { targets: t, receptions: t - 1, receiving_yards: 15 + n(`${k}ry`, 50) });
      break;
    }
    case "TE": {
      const t = targets(2, 5);
      Object.assign(row, { targets: t, receptions: t - 1, receiving_yards: 10 + n(`${k}ry`, 45), receiving_tds: Math.floor(tg.passTd / 2) });
      break;
    }
  }
  return row;
}

function teamRow(g: Game, team: Team, opp: Team, tg: TeamGame, otg: TeamGame): Row {
  const k = `${g.season}-${g.week}-${team}`;
  return {
    season: g.season,
    week: g.week,
    team,
    season_type: "REG",
    game_id: gameId(g),
    opponent_team: opp,
    passing_interceptions: tg.ints,
    sacks_suffered: tg.sacks,
    fumbles_lost_total: tg.fumblesLost,
    passing_tds: tg.passTd,
    rushing_tds: tg.rushTd,
    special_teams_tds: 0,
    def_tds: tg.defTd,
    fumble_recovery_tds: 0,
    def_safeties: 0,
    def_2pt_made: 0,
    def_punt_blocks: 0,
    def_fg_blocks: 0,
    def_pat_blocks: 0,
    pat_made: tg.passTd + tg.rushTd + tg.defTd,
    fg_made: tg.fg,
    passing_2pt_conversions: 0,
    rushing_2pt_conversions: 0,
    def_sacks: Math.max(0, otg.sacks - (UNDERCOUNT.has(k) ? 1 : 0)),
    def_interceptions: otg.ints,
    fumble_recovery_opp: otg.fumblesLost,
  };
}

function csv(columns: readonly string[], rows: readonly Row[]): string {
  const cell = (v: string | number) => String(v);
  return [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c] ?? "")).join(","))].join("\n") + "\n";
}

const outputs: Record<string, string> = {};
const schedule: Row[] = [];
for (const season of [2040, 2041]) {
  const players: Row[] = [];
  const teams: Row[] = [];
  for (const g of GAMES.filter((x) => x.season === season)) {
    const away = teamGame(g, g.away);
    const home = teamGame(g, g.home);
    schedule.push({
      game_id: gameId(g),
      season: g.season,
      game_type: "REG",
      week: g.week,
      away_team: g.away,
      away_score: g.final ? points(away) : "",
      home_team: g.home,
      home_score: g.final ? points(home) : "",
    });
    if (!g.final) continue;
    for (const [team, opp, tg, otg] of [
      [g.away, g.home, away, home],
      [g.home, g.away, home, away],
    ] as const) {
      teams.push(teamRow(g, team, opp, tg, otg));
      for (const [slot, pos] of SLOTS) {
        if (ABSENT.has(`${g.season}-${g.week}-${team}-${slot}`)) continue;
        players.push(playerRow(g, team, opp, slot, pos, tg));
      }
    }
  }
  outputs[`study-stats_player_week_${season}.csv`] = csv(PLAYER_COLUMNS, players);
  outputs[`study-stats_team_week_${season}.csv`] = csv(TEAM_COLUMNS, teams);
}
outputs["study-games.csv"] = csv(["game_id", "season", "game_type", "week", "away_team", "away_score", "home_team", "home_score"], schedule);

const SALARY: Record<string, (t: number) => number> = {
  QB: (t) => 5400 + 300 * t,
  RB1: (t) => 5200 + 200 * t,
  RB2: (t) => 3800 + 100 * t,
  WR1: (t) => 5600 - 200 * t,
  WR2: (t) => 3600 + 100 * t,
  TE: (t) => 3000 + 200 * t,
};
type FantasyRow = { id: string; name: string; pos: string; team: string; salary: number } & Record<string, unknown>;
const fantasyPlayers: FantasyRow[] = TEAMS.flatMap((team, t): FantasyRow[] => [
  ...SLOTS.map(([slot, pos]) => ({
    id: `${team}-${slot}`,
    name: `${team} ${slot}`,
    pos,
    // A stale universe team: weekly slates must use the team from the latest row before the cutoff.
    team: `${team}-${slot}` === "BBB-WR2" ? "AAA" : team,
    headshot: null,
    games: 0,
    ppr: null,
    ppg: 0,
    proj: 0,
    recencyPpg: 0,
    salary: SALARY[slot]!(t),
  })),
  { id: `DST-${team}`, name: `${team} D/ST`, pos: "DST", team, headshot: null, games: 0, ppr: null, ppg: 0, proj: 0, recencyPpg: 0, salary: 2400 + 200 * t },
]);
// An id no source knows.
fantasyPlayers.push({ id: "ZZZ-WR9", name: "ZZZ WR9", pos: "WR", team: "ZZZ", headshot: null, games: 0, ppr: null, ppg: 0, proj: 0, recencyPpg: 0, salary: 3000 });
outputs["study-fantasy.json"] = `${JSON.stringify(
  {
    source: "Synthetic test slate for tests/domain/study-*.test.ts, not real players or salaries",
    season: 2041,
    scoring: "PPR",
    cap: 40000,
    roster: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, DST: 1 },
    players: fantasyPlayers,
  },
  null,
  2,
)}\n`;

const hashes: Record<string, string> = {};
for (const [name, text] of Object.entries(outputs)) {
  writeFileSync(new URL(name, import.meta.url), text);
  hashes[name] = createHash("sha256").update(text).digest("hex");
}
writeFileSync(
  new URL("study-fixtures.sha256.json", import.meta.url),
  `${JSON.stringify({ note: "sha256 of each fixture with CRLF folded to LF; regenerate with study-fixture-generator.ts", files: hashes }, null, 2)}\n`,
);
console.log(hashes);
