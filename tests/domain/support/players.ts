import { readFileSync } from "node:fs";
import type { FantasyFile, FantasyPlayer, FantasyPos } from "../../../src/data/types.ts";

export function player(id: string, pos: FantasyPos, salary: number, proj: number, team = "T"): FantasyPlayer {
  return { id, name: id, pos, team, headshot: null, games: 1, ppr: null, ppg: proj, proj, recencyPpg: proj, salary };
}

function readRepoJson(path: string): unknown {
  return JSON.parse(readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8"));
}

/** The 13-player slate reproduced in the implementation handoff (every player on team T). */
export function handoffSlate(): FantasyPlayer[] {
  return readRepoJson("tests/fixtures/football/optimizer-handoff-slate.json") as FantasyPlayer[];
}

/** The frozen synthetic 114-player salary slate the app ships. */
export function realSlate(): FantasyFile {
  return readRepoJson("src/data/fantasy.json") as FantasyFile;
}
