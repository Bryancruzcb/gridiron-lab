import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import readline from "node:readline";
import type { QbBox, QbSeason, SplitStats, TeamSeason } from "@/data/types";
import type { AdvancedBlock, AdvQb, AdvTeam, SeasonLabs } from "./types";
import { fnum, parseCsvLine, round, truthy, UA } from "./csv";
import { lastTeamKey, nameTeamKey, seedPosMap, type SkillPos } from "./names";

const PBP_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2026.csv.gz";
const WEEK_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2026.csv";

const TTL_MS = 20 * 60 * 1000;

type SplitAcc = {
  plays: number;
  epa: number;
  epaN: number;
  success: number;
  successN: number;
  cpoe: number;
  cpoeN: number;
  comp: number;
  att: number;
  press: number;
  sack: number;
  td: number;
  int: number;
  yds: number;
  air: number;
  airN: number;
};

type QbAcc = {
  id: string;
  name: string;
  team: string;
  games: Set<string>;
  overall: SplitAcc;
  splits: Map<string, SplitAcc>;
  weeks: Map<number, { plays: number; epa: number; epaN: number; cpoe: number; cpoeN: number }>;
};

type PlayAcc = {
  plays: number;
  pass: number;
  rush: number;
  epa: number;
  epaN: number;
  success: number;
  successN: number;
  xpass: number;
  xpassN: number;
};

type TeamAcc = {
  team: string;
  games: Set<string>;
  all: PlayAcc;
  shotgun: number;
  noHuddle: number;
  ss: { plays: number; pass: number; epaPass: number; epaPassN: number; epaRush: number; epaRushN: number; sucPass: number; sucPassN: number; sucRush: number; sucRushN: number };
  fourth: { opps: number; go: number; punt: number; fg: number; convert: number; goEpa: number; goEpaN: number; nGo: number; nOpp: number };
  splits: Map<string, PlayAcc>;
};

type GameAcc = {
  gameId: string;
  qbs: Map<string, { name: string; team: string; plays: number; epa: number; epaN: number; cpoe: number; cpoeN: number; comp: number; att: number }>;
  teams: Map<string, { team: string; plays: number; epa: number; epaN: number; pass: number; rush: number; xpass: number; xpassN: number; fourthGo: number; fourthOpp: number }>;
};

type WeekPlayer = {
  id: string;
  name: string;
  team: string;
  pos: string;
  headshot: string | null;
  week: number;
  ppr: number;
  box: QbBox;
};

type PbpBundle = {
  at: number;
  throughWeek: number;
  games: Map<string, AdvancedBlock>;
  qbs: QbSeason[];
  teams: TeamSeason[];
};

let pbpCache: PbpBundle | null = null;
let pbpInflight: Promise<PbpBundle> | null = null;
let weekCache: { at: number; rows: WeekPlayer[]; byId: Map<string, WeekPlayer>; pos: Map<string, SkillPos> } | null =
  null;
let weekInflight: ReturnType<typeof loadPlayerWeek> | null = null;

function emptySplit(): SplitAcc {
  return {
    plays: 0,
    epa: 0,
    epaN: 0,
    success: 0,
    successN: 0,
    cpoe: 0,
    cpoeN: 0,
    comp: 0,
    att: 0,
    press: 0,
    sack: 0,
    td: 0,
    int: 0,
    yds: 0,
    air: 0,
    airN: 0,
  };
}

function emptyPlay(): PlayAcc {
  return { plays: 0, pass: 0, rush: 0, epa: 0, epaN: 0, success: 0, successN: 0, xpass: 0, xpassN: 0 };
}

function bumpSplit(a: SplitAcc, row: {
  epa: number | null;
  success: number | null;
  cpoe: number | null;
  isAtt: boolean;
  complete: boolean;
  press: boolean;
  sack: boolean;
  td: boolean;
  int: boolean;
  yds: number | null;
  air: number | null;
}) {
  a.plays += 1;
  if (row.epa != null) {
    a.epa += row.epa;
    a.epaN += 1;
  }
  if (row.success != null) {
    a.success += row.success;
    a.successN += 1;
  }
  if (row.cpoe != null) {
    a.cpoe += row.cpoe;
    a.cpoeN += 1;
  }
  if (row.isAtt) {
    a.att += 1;
    if (row.complete) a.comp += 1;
    if (row.yds != null) a.yds += row.yds;
  }
  if (row.press) a.press += 1;
  if (row.sack) a.sack += 1;
  if (row.td) a.td += 1;
  if (row.int) a.int += 1;
  if (row.air != null) {
    a.air += row.air;
    a.airN += 1;
  }
}

function finishSplit(a: SplitAcc): SplitStats {
  return {
    plays: a.plays,
    epa: a.epaN ? round(a.epa / a.epaN, 3) : null,
    success: a.successN ? round(a.success / a.successN, 3) : null,
    cpoe: a.cpoeN ? round(a.cpoe / a.cpoeN, 1) : null,
    comp: a.att ? round(a.comp / a.att, 3) : null,
    press: a.plays ? round(a.press / a.plays, 3) : null,
    sack: a.plays ? round(a.sack / a.plays, 3) : null,
    td: a.td,
    int: a.int,
    ypa: a.att ? round(a.yds / a.att, 1) : null,
    att: a.att,
    air: a.airN ? round(a.air / a.airN, 1) : null,
  };
}

function bumpPlay(a: PlayAcc, isPass: boolean, isRush: boolean, epa: number | null, success: number | null, xpass: number | null) {
  a.plays += 1;
  if (isPass) a.pass += 1;
  if (isRush) a.rush += 1;
  if (epa != null) {
    a.epa += epa;
    a.epaN += 1;
  }
  if (success != null) {
    a.success += success;
    a.successN += 1;
  }
  if (xpass != null && (isPass || isRush)) {
    a.xpass += xpass;
    a.xpassN += 1;
  }
}

function finishPlay(a: PlayAcc) {
  const pr = a.pass + a.rush;
  return {
    plays: a.plays,
    passRate: pr ? round(a.pass / pr, 3) : null,
    epa: a.epaN ? round(a.epa / a.epaN, 3) : null,
    success: a.successN ? round(a.success / a.successN, 3) : null,
    xpass: a.xpassN ? round(a.xpass / a.xpassN, 3) : null,
    proe: a.xpassN && pr ? round((a.pass / pr - a.xpass / a.xpassN) * 100, 1) : null,
  };
}

function distBucket(toGo: number | null): "short" | "medium" | "long" | null {
  if (toGo == null) return null;
  if (toGo <= 3) return "short";
  if (toGo <= 6) return "medium";
  return "long";
}

function qbSplitKeys(down: number | null, dist: "short" | "medium" | "long" | null, sit: {
  redzone: boolean;
  twominute: boolean;
  trailing: boolean;
  leading: boolean;
  neutral: boolean;
  pressured: boolean;
  backed: boolean;
}): string[] {
  const keys: string[] = [];
  if (down === 1 || down === 2 || down === 3 || down === 4) keys.push(`down${down}`);
  if (dist) keys.push(`dist_${dist}`);
  if (down && dist) {
    if (down === 1 && dist === "long") keys.push("d1_long");
    if (down === 2 || down === 3) keys.push(`d${down}_${dist}`);
  }
  if (sit.redzone) keys.push("redzone");
  if (sit.twominute) keys.push("twominute");
  if (sit.trailing) keys.push("trailing");
  if (sit.leading) keys.push("leading");
  if (sit.neutral) keys.push("neutral");
  if (sit.pressured) keys.push("pressured");
  else keys.push("clean");
  if (sit.backed) keys.push("backed");
  return keys;
}

function teamSplitKeys(down: number | null, dist: "short" | "medium" | "long" | null): string[] {
  const keys = ["all"];
  if (down === 1 || down === 2 || down === 3 || down === 4) keys.push(`down${down}`);
  if (dist) keys.push(`dist_${dist}`);
  if (down && dist) {
    if (down === 1 && (dist === "long" || dist === "medium")) keys.push(`down1_${dist}`);
    if (down === 2 || down === 3) keys.push(`down${down}_${dist}`);
    if (down === 4 && dist === "short") keys.push("down4_short");
  }
  return keys;
}

function finishGame(acc: GameAcc): AdvancedBlock {
  const qbs: AdvQb[] = [...acc.qbs.values()]
    .filter((q) => q.plays >= 3)
    .sort((a, b) => b.plays - a.plays)
    .map((q) => ({
      name: q.name,
      team: q.team,
      plays: q.plays,
      epa: q.epaN ? round(q.epa / q.epaN, 3) : null,
      cpoe: q.cpoeN ? round(q.cpoe / q.cpoeN, 1) : null,
      comp: q.att ? round(q.comp / q.att, 3) : null,
    }));
  const teams: AdvTeam[] = [...acc.teams.values()].map((t) => {
    const pr = t.pass + t.rush;
    return {
      team: t.team,
      plays: t.plays,
      epa: t.epaN ? t.epa / t.epaN : null,
      passRate: pr ? t.pass / pr : null,
      proe: t.xpassN ? round((t.pass / Math.max(pr, 1) - t.xpass / t.xpassN) * 100, 1) : null,
      fourthGo: t.fourthOpp ? t.fourthGo / t.fourthOpp : null,
    };
  });
  return { source: "nflverse play-by-play 2026", gameId: acc.gameId, qbs, teams };
}

async function buildPbp(): Promise<PbpBundle> {
  const res = await fetch(PBP_URL, { headers: UA, redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`nflverse pbp ${res.status}`);

  const nodeIn = Readable.fromWeb(res.body as import("stream/web").ReadableStream);
  const rl = readline.createInterface({ input: nodeIn.pipe(createGunzip()) });

  let header: string[] | null = null;
  const idx: Record<string, number> = {};
  const games = new Map<string, GameAcc>();
  const qbs = new Map<string, QbAcc>();
  const teams = new Map<string, TeamAcc>();
  let throughWeek = 0;

  const want = [
    "game_id",
    "week",
    "season",
    "season_type",
    "home_team",
    "away_team",
    "posteam",
    "play_type",
    "down",
    "ydstogo",
    "yardline_100",
    "half_seconds_remaining",
    "score_differential",
    "epa",
    "cpoe",
    "complete_pass",
    "pass",
    "rush",
    "sack",
    "qb_hit",
    "qb_dropback",
    "success",
    "xpass",
    "shotgun",
    "no_huddle",
    "passer_player_name",
    "passer_player_id",
    "pass_touchdown",
    "interception",
    "air_yards",
    "yards_gained",
    "passing_yards",
    "fourth_down_converted",
  ];

  for await (const line of rl) {
    if (!header) {
      header = parseCsvLine(line);
      for (const col of want) {
        const i = header.indexOf(col);
        if (i >= 0) idx[col] = i;
      }
      continue;
    }
    const cells = parseCsvLine(line);
    const get = (c: string) => {
      const i = idx[c];
      return i == null ? "" : (cells[i] ?? "");
    };
    if (get("season_type") && get("season_type") !== "REG") continue;

    const gameId = get("game_id");
    const away = get("away_team");
    const home = get("home_team");
    const week = fnum(get("week")) ?? 0;
    const season = get("season") || "2026";
    if (!gameId || !away || !home) continue;
    if (week > throughWeek) throughWeek = week;
    const gkey = `${season}_${String(week).padStart(2, "0")}_${away}_${home}`;

    let gacc = games.get(gkey);
    if (!gacc) {
      gacc = { gameId, qbs: new Map(), teams: new Map() };
      games.set(gkey, gacc);
    }

    const posteam = get("posteam");
    const playType = get("play_type");
    if (!posteam || playType === "no_play" || playType === "qb_kneel" || playType === "qb_spike") continue;

    const isPass = truthy(get("pass")) || playType === "pass";
    const isRush = truthy(get("rush")) || playType === "run";
    const isSack = truthy(get("sack"));
    const epa = fnum(get("epa"));
    const down = fnum(get("down"));
    const toGo = fnum(get("ydstogo"));
    const dist = distBucket(toGo);
    const success = fnum(get("success"));
    const xpass = fnum(get("xpass"));

    let tgame = gacc.teams.get(posteam);
    if (!tgame) {
      tgame = {
        team: posteam,
        plays: 0,
        epa: 0,
        epaN: 0,
        pass: 0,
        rush: 0,
        xpass: 0,
        xpassN: 0,
        fourthGo: 0,
        fourthOpp: 0,
      };
      gacc.teams.set(posteam, tgame);
    }
    tgame.plays += 1;
    if (epa != null) {
      tgame.epa += epa;
      tgame.epaN += 1;
    }
    if (isPass) tgame.pass += 1;
    if (isRush) tgame.rush += 1;
    if (xpass != null && (isPass || isRush)) {
      tgame.xpass += xpass;
      tgame.xpassN += 1;
    }
    if (down === 4 && (isPass || isRush || playType === "punt" || playType === "field_goal")) {
      tgame.fourthOpp += 1;
      if (isPass || isRush) tgame.fourthGo += 1;
    }

    let team = teams.get(posteam);
    if (!team) {
      team = {
        team: posteam,
        games: new Set(),
        all: emptyPlay(),
        shotgun: 0,
        noHuddle: 0,
        ss: { plays: 0, pass: 0, epaPass: 0, epaPassN: 0, epaRush: 0, epaRushN: 0, sucPass: 0, sucPassN: 0, sucRush: 0, sucRushN: 0 },
        fourth: { opps: 0, go: 0, punt: 0, fg: 0, convert: 0, goEpa: 0, goEpaN: 0, nGo: 0, nOpp: 0 },
        splits: new Map(),
      };
      teams.set(posteam, team);
    }
    team.games.add(gameId);

    if (isPass || isRush) {
      if (truthy(get("shotgun"))) team.shotgun += 1;
      if (truthy(get("no_huddle"))) team.noHuddle += 1;
      for (const k of teamSplitKeys(down, dist)) {
        let sp = team.splits.get(k);
        if (!sp) {
          sp = emptyPlay();
          team.splits.set(k, sp);
        }
        bumpPlay(sp, isPass, isRush, epa, success, xpass);
      }
      bumpPlay(team.all, isPass, isRush, epa, success, xpass);
      if (down === 2 && toGo != null && toGo <= 3) {
        team.ss.plays += 1;
        if (isPass) {
          team.ss.pass += 1;
          if (epa != null) {
            team.ss.epaPass += epa;
            team.ss.epaPassN += 1;
          }
          if (success != null) {
            team.ss.sucPass += success;
            team.ss.sucPassN += 1;
          }
        } else {
          if (epa != null) {
            team.ss.epaRush += epa;
            team.ss.epaRushN += 1;
          }
          if (success != null) {
            team.ss.sucRush += success;
            team.ss.sucRushN += 1;
          }
        }
      }
    }

    if (down === 4) {
      if (playType === "punt") {
        team.fourth.opps += 1;
        team.fourth.punt += 1;
        if (Math.abs(fnum(get("score_differential")) ?? 99) <= 8) team.fourth.nOpp += 1;
      } else if (playType === "field_goal") {
        team.fourth.opps += 1;
        team.fourth.fg += 1;
        if (Math.abs(fnum(get("score_differential")) ?? 99) <= 8) team.fourth.nOpp += 1;
      } else if (isPass || isRush) {
        team.fourth.opps += 1;
        team.fourth.go += 1;
        if (truthy(get("fourth_down_converted"))) team.fourth.convert += 1;
        if (epa != null) {
          team.fourth.goEpa += epa;
          team.fourth.goEpaN += 1;
        }
        const sd = fnum(get("score_differential"));
        if (sd != null && Math.abs(sd) <= 8) {
          team.fourth.nOpp += 1;
          team.fourth.nGo += 1;
        }
      }
    }

    const dropback = truthy(get("qb_dropback")) || ((isPass || isSack) && Boolean(get("passer_player_name")));
    const passerId = get("passer_player_id") || get("passer_player_name");
    const passerName = get("passer_player_name");
    if (dropback && passerId && passerName) {
      let qbG = gacc.qbs.get(passerName);
      if (!qbG) {
        qbG = { name: passerName, team: posteam, plays: 0, epa: 0, epaN: 0, cpoe: 0, cpoeN: 0, comp: 0, att: 0 };
        gacc.qbs.set(passerName, qbG);
      }
      qbG.plays += 1;
      qbG.team = posteam;
      if (epa != null) {
        qbG.epa += epa;
        qbG.epaN += 1;
      }
      const cpoe = fnum(get("cpoe"));
      if (cpoe != null) {
        qbG.cpoe += cpoe;
        qbG.cpoeN += 1;
      }
      if (isPass && !isSack) {
        qbG.att += 1;
        if (truthy(get("complete_pass"))) qbG.comp += 1;
      }

      let qb = qbs.get(passerId);
      if (!qb) {
        qb = {
          id: passerId,
          name: passerName,
          team: posteam,
          games: new Set(),
          overall: emptySplit(),
          splits: new Map(),
          weeks: new Map(),
        };
        qbs.set(passerId, qb);
      }
      qb.team = posteam;
      qb.games.add(gameId);
      const pressured = isSack || truthy(get("qb_hit"));
      const yline = fnum(get("yardline_100"));
      const half = fnum(get("half_seconds_remaining"));
      const sd = fnum(get("score_differential"));
      const row = {
        epa,
        success,
        cpoe,
        isAtt: isPass && !isSack,
        complete: truthy(get("complete_pass")),
        press: pressured,
        sack: isSack,
        td: truthy(get("pass_touchdown")),
        int: truthy(get("interception")),
        yds: fnum(get("passing_yards")) ?? fnum(get("yards_gained")),
        air: fnum(get("air_yards")),
      };
      bumpSplit(qb.overall, row);
      let wk = qb.weeks.get(week);
      if (!wk) {
        wk = { plays: 0, epa: 0, epaN: 0, cpoe: 0, cpoeN: 0 };
        qb.weeks.set(week, wk);
      }
      wk.plays += 1;
      if (epa != null) {
        wk.epa += epa;
        wk.epaN += 1;
      }
      if (cpoe != null) {
        wk.cpoe += cpoe;
        wk.cpoeN += 1;
      }
      const sit = {
        redzone: yline != null && yline <= 20,
        twominute: half != null && half <= 120,
        trailing: sd != null && sd < 0,
        leading: sd != null && sd > 0,
        neutral: sd === 0,
        pressured,
        backed: yline != null && yline >= 80,
      };
      for (const k of qbSplitKeys(down, dist, sit)) {
        let sp = qb.splits.get(k);
        if (!sp) {
          sp = emptySplit();
          qb.splits.set(k, sp);
        }
        bumpSplit(sp, row);
      }
    }
  }

  const weekRows = weekCache?.rows ?? [];
  const byId = new Map(weekRows.map((r) => [r.id, r]));

  const qbSeasons: QbSeason[] = [...qbs.values()]
    .filter((q) => q.overall.plays >= 5)
    .sort((a, b) => b.overall.plays - a.overall.plays)
    .map((q) => {
      const w = byId.get(q.id);
      const splits: Record<string, SplitStats> = {};
      for (const [k, acc] of q.splits) {
        if (acc.plays > 0) splits[k] = finishSplit(acc);
      }
      return {
        id: q.id,
        name: w?.name ?? q.name,
        team: w?.team ?? q.team,
        season: 2026,
        games: q.games.size,
        headshot: w?.headshot ?? null,
        box: w?.box ?? null,
        overall: finishSplit(q.overall),
        splits,
        weeks: [...q.weeks.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([wk, acc]) => ({
            week: wk,
            plays: acc.plays,
            epa: acc.epaN ? round(acc.epa / acc.epaN, 3) : null,
            cpoe: acc.cpoeN ? round(acc.cpoe / acc.cpoeN, 1) : null,
          })),
      };
    });

  const teamSeasons: TeamSeason[] = [...teams.values()].map((t) => {
    const all = finishPlay(t.all);
    const splits: TeamSeason["splits"] = {};
    for (const [k, acc] of t.splits) splits[k] = finishPlay(acc);
    const n = t.all.plays || 1;
    return {
      season: 2026,
      team: t.team,
      coach: null,
      plays: t.all.plays,
      passRate: all.passRate,
      epa: all.epa,
      success: all.success,
      shotgun: round(t.shotgun / n, 3),
      noHuddle: round(t.noHuddle / n, 3),
      proe: all.proe,
      secondAndShort: {
        plays: t.ss.plays,
        passRate: t.ss.plays ? round(t.ss.pass / t.ss.plays, 3) : null,
        epaPass: t.ss.epaPassN ? round(t.ss.epaPass / t.ss.epaPassN, 3) : null,
        epaRush: t.ss.epaRushN ? round(t.ss.epaRush / t.ss.epaRushN, 3) : null,
        successPass: t.ss.sucPassN ? round(t.ss.sucPass / t.ss.sucPassN, 3) : null,
        successRush: t.ss.sucRushN ? round(t.ss.sucRush / t.ss.sucRushN, 3) : null,
      },
      fourthDown: {
        opps: t.fourth.opps,
        goRate: t.fourth.opps ? round(t.fourth.go / t.fourth.opps, 3) : null,
        puntRate: t.fourth.opps ? round(t.fourth.punt / t.fourth.opps, 3) : null,
        fgRate: t.fourth.opps ? round(t.fourth.fg / t.fourth.opps, 3) : null,
        convertRate: t.fourth.go ? round(t.fourth.convert / t.fourth.go, 3) : null,
        goEpa: t.fourth.goEpaN ? round(t.fourth.goEpa / t.fourth.goEpaN, 3) : null,
        neutralGoRate: t.fourth.nOpp ? round(t.fourth.nGo / t.fourth.nOpp, 3) : null,
      },
      splits,
    };
  });

  const byKey = new Map<string, AdvancedBlock>();
  for (const [k, acc] of games) byKey.set(k, finishGame(acc));

  return { at: Date.now(), throughWeek, games: byKey, qbs: qbSeasons, teams: teamSeasons };
}

async function loadPlayerWeek() {
  const res = await fetch(WEEK_URL, { headers: UA, redirect: "follow" });
  if (!res.ok) throw new Error(`nflverse week ${res.status}`);
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines[0]) return { at: Date.now(), rows: [] as WeekPlayer[], byId: new Map<string, WeekPlayer>(), pos: seedPosMap() };
  const header = parseCsvLine(lines[0]);
  const idx: Record<string, number> = {};
  for (const col of header) idx[col] = header.indexOf(col);
  const get = (cells: string[], c: string) => {
    const i = idx[c];
    return i == null ? "" : (cells[i] ?? "");
  };
  const rows: WeekPlayer[] = [];
  const pos = seedPosMap();
  const agg = new Map<string, WeekPlayer>();
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    if (get(cells, "season_type") && get(cells, "season_type") !== "REG") continue;
    const id = get(cells, "player_id");
    const name = get(cells, "player_display_name") || get(cells, "player_name");
    const team = get(cells, "team");
    const position = get(cells, "position");
    if (!id || !name || !team) continue;
    const skill = position === "QB" || position === "RB" || position === "WR" || position === "TE" ? position : null;
    if (skill) {
      pos.set(nameTeamKey(name, team), skill);
      pos.set(lastTeamKey(name, team), skill);
    }
    const week = fnum(get(cells, "week")) ?? 1;
    const ppr = fnum(get(cells, "fantasy_points_ppr")) ?? 0;
    const prev = agg.get(id);
    const add = {
      cmp: fnum(get(cells, "completions")) ?? 0,
      att: fnum(get(cells, "attempts")) ?? 0,
      yds: fnum(get(cells, "passing_yards")) ?? 0,
      td: fnum(get(cells, "passing_tds")) ?? 0,
      int: fnum(get(cells, "passing_interceptions")) ?? 0,
      sk: fnum(get(cells, "sacks_suffered")) ?? 0,
      rushYds: fnum(get(cells, "rushing_yards")) ?? 0,
      rushTd: fnum(get(cells, "rushing_tds")) ?? 0,
    };
    if (!prev) {
      agg.set(id, {
        id,
        name,
        team,
        pos: position,
        headshot: get(cells, "headshot_url") || null,
        week,
        ppr,
        box: { games: 1, ...add, ppr },
      });
    } else {
      prev.team = team;
      prev.week = Math.max(prev.week, week);
      prev.ppr = round(prev.ppr + ppr, 1);
      prev.box.games += 1;
      prev.box.cmp += add.cmp;
      prev.box.att += add.att;
      prev.box.yds += add.yds;
      prev.box.td += add.td;
      prev.box.int += add.int;
      prev.box.sk += add.sk;
      prev.box.rushYds += add.rushYds;
      prev.box.rushTd += add.rushTd;
      prev.box.ppr = prev.ppr;
    }
  }
  rows.push(...agg.values());
  const byId = new Map(rows.map((r) => [r.id, r]));
  return { at: Date.now(), rows, byId, pos };
}

async function playerWeek() {
  if (weekCache && Date.now() - weekCache.at < TTL_MS) return weekCache;
  if (weekInflight) return weekInflight;
  weekInflight = loadPlayerWeek()
    .then((v) => {
      weekCache = v;
      return v;
    })
    .finally(() => {
      weekInflight = null;
    });
  try {
    return await weekInflight;
  } catch {
    return weekCache ?? { at: 0, rows: [], byId: new Map(), pos: seedPosMap() };
  }
}

async function pbpBundle(): Promise<PbpBundle> {
  if (pbpCache && Date.now() - pbpCache.at < TTL_MS) return pbpCache;
  if (pbpInflight) return pbpInflight;
  pbpInflight = buildPbp()
    .then((v) => {
      pbpCache = v;
      return v;
    })
    .finally(() => {
      pbpInflight = null;
    });
  return pbpInflight;
}

export function peekAdvancedKeys(): Set<string> {
  return pbpCache ? new Set(pbpCache.games.keys()) : new Set();
}

export function peekAdvanced(key: string): AdvancedBlock | null {
  return pbpCache?.games.get(key) ?? null;
}

export function peekPosMap() {
  return weekCache?.pos ?? null;
}

export function warmNflverse() {
  void pbpBundle().catch(() => {});
  void playerWeek().catch(() => {});
}

export async function advancedIndex(): Promise<Map<string, AdvancedBlock>> {
  try {
    const b = await pbpBundle();
    return b.games;
  } catch {
    return pbpCache?.games ?? new Map();
  }
}

export async function advancedFor(key: string): Promise<AdvancedBlock | null> {
  const idx = await advancedIndex();
  return idx.get(key) ?? null;
}

export async function advancedKeys(): Promise<Set<string>> {
  const idx = await advancedIndex();
  return new Set(idx.keys());
}

export async function positionMap(): Promise<Map<string, SkillPos>> {
  const w = await playerWeek();
  return w.pos;
}

export async function weekPlayers() {
  return playerWeek();
}

export async function loadSeasonLabs(): Promise<SeasonLabs> {
  const [bundle, week] = await Promise.all([pbpBundle(), playerWeek()]);
  const qbs = bundle.qbs.map((q) => {
    const w = week.byId.get(q.id);
    if (!w) return q;
    return { ...q, name: w.name, team: w.team, headshot: w.headshot ?? q.headshot, box: w.box };
  });
  return {
    season: 2026,
    throughWeek: bundle.throughWeek || Math.max(0, ...week.rows.map((r) => r.week)),
    fetchedAt: new Date(bundle.at).toISOString(),
    source: "nflverse play-by-play + player week 2026",
    qbs,
    teams: bundle.teams,
  };
}

export function bustSeasonCache() {
  pbpCache = null;
  weekCache = null;
}
