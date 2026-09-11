export type GameStatus = "pre" | "in" | "post";
export type GameStage = "pregame" | "live" | "final" | "advanced";

export type TeamSide = {
  abbr: string;
  espnAbbr: string;
  name: string;
  nick: string;
  score: number;
  record: string | null;
  logo: string | null;
  winner: boolean;
};

export type LiveGame = {
  id: string;
  start: string;
  status: GameStatus;
  statusText: string;
  clock: string | null;
  period: number | null;
  week: number;
  season: number;
  broadcast: string | null;
  venue: string | null;
  lastPlay: string | null;
  situation: string | null;
  away: TeamSide;
  home: TeamSide;
  stage: GameStage;
  nflverseKey: string;
};

export type Scoreboard = {
  season: number;
  week: number;
  fetchedAt: string;
  anyLive: boolean;
  games: LiveGame[];
};

export type BoxPlayer = {
  id: string;
  name: string;
  team: string;
  headshot: string | null;
  pos: "QB" | "RB" | "WR" | "TE" | "FLEX";
  passCmp: number | null;
  passAtt: number | null;
  passYds: number;
  passTd: number;
  ints: number;
  rushAtt: number;
  rushYds: number;
  rushTd: number;
  rec: number;
  recYds: number;
  recTd: number;
  ppr: number;
};

export type TeamBox = {
  abbr: string;
  plays: number | null;
  yards: number | null;
  passYds: number | null;
  rushYds: number | null;
  compAtt: string | null;
  thirdDown: string | null;
  fourthDown: string | null;
  turnovers: number | null;
  possession: string | null;
  sacks: number | null;
  defTd: number | null;
  ints: number | null;
};

export type ScoringPlay = {
  q: number;
  clock: string;
  team: string;
  text: string;
  away: number;
  home: number;
};

export type CallSplit = {
  team: string;
  plays: number;
  passRate: number | null;
  secondAndShortPass: number | null;
  secondAndShortN: number;
  fourthGoRate: number | null;
  fourthOpps: number;
};

export type AdvQb = {
  name: string;
  team: string;
  plays: number;
  epa: number | null;
  cpoe: number | null;
  comp: number | null;
};

export type AdvTeam = {
  team: string;
  plays: number;
  epa: number | null;
  passRate: number | null;
  proe: number | null;
  fourthGo: number | null;
};

export type AdvancedBlock = {
  source: string;
  gameId: string;
  qbs: AdvQb[];
  teams: AdvTeam[];
};

export type GameDetail = {
  game: LiveGame;
  teamBox: TeamBox[];
  players: BoxPlayer[];
  scoring: ScoringPlay[];
  calling: CallSplit[];
  advanced: AdvancedBlock | null;
};

export type SeasonLabs = {
  season: number;
  throughWeek: number;
  fetchedAt: string;
  source: string;
  qbs: import("@/data/types").QbSeason[];
  teams: import("@/data/types").TeamSeason[];
};

export type WeekSkill = {
  gsisId: string | null;
  espnId: string;
  name: string;
  team: string;
  pos: "QB" | "RB" | "WR" | "TE" | "DST" | "FLEX";
  ppr: number;
  headshot: string | null;
  status: GameStatus;
};

export type WeekPpr = {
  season: number;
  week: number;
  fetchedAt: string;
  gamesFinal: number;
  gamesLive: number;
  games: number;
  players: WeekSkill[];
};
