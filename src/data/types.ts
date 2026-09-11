export type SplitStats = {
  plays: number;
  epa: number | null;
  success: number | null;
  cpoe: number | null;
  comp: number | null;
  press: number | null;
  sack: number | null;
  td: number;
  int: number;
  ypa: number | null;
  att: number;
  air: number | null;
};

export type QbBox = {
  games: number;
  cmp: number;
  att: number;
  yds: number;
  td: number;
  int: number;
  sk: number;
  rushYds: number;
  rushTd: number;
  ppr: number | null;
};

export type QbWeekPoint = {
  week: number;
  plays: number;
  epa: number | null;
  cpoe: number | null;
};

export type QbSeason = {
  id: string;
  name: string;
  team: string;
  season: number;
  games: number;
  headshot: string | null;
  box: QbBox | null;
  overall: SplitStats;
  splits: Record<string, SplitStats>;
  weeks?: QbWeekPoint[];
};

export type QbFile = {
  source: string;
  seasons: number[];
  qbs: QbSeason[];
};

export type TeamMeta = {
  city: string;
  name: string;
  color: string;
};

export type PlaySplit = {
  plays: number;
  passRate: number | null;
  epa: number | null;
  success: number | null;
  xpass: number | null;
  proe: number | null;
};

export type TeamSeason = {
  season: number;
  team: string;
  coach: string | null;
  plays: number;
  passRate: number | null;
  epa: number | null;
  success: number | null;
  shotgun: number | null;
  noHuddle: number | null;
  proe: number | null;
  secondAndShort: {
    plays: number;
    passRate: number | null;
    epaPass: number | null;
    epaRush: number | null;
    successPass: number | null;
    successRush: number | null;
  };
  fourthDown: {
    opps: number;
    goRate: number | null;
    puntRate: number | null;
    fgRate: number | null;
    convertRate: number | null;
    goEpa: number | null;
    neutralGoRate: number | null;
  };
  splits: Record<string, PlaySplit>;
};

export type PlaycallingFile = {
  source: string;
  seasons: number[];
  teams: TeamSeason[];
  teamMeta: Record<string, TeamMeta>;
};

export type FantasyPos = "QB" | "RB" | "WR" | "TE" | "DST";

export type FantasyPlayer = {
  id: string;
  name: string;
  pos: FantasyPos;
  team: string;
  headshot: string | null;
  games: number;
  ppr: number | null;
  ppg: number;
  proj: number;
  recencyPpg: number;
  salary: number;
  passYds?: number;
  passTd?: number;
  rushYds?: number;
  rushTd?: number;
  rec?: number;
  recYds?: number;
  recTd?: number;
  sacks?: number;
  ints?: number;
  tds?: number;
};

export type FantasyFile = {
  source: string;
  season: number;
  scoring: string;
  cap: number;
  roster: Record<string, number>;
  players: FantasyPlayer[];
};

export type StudyLineupScore = {
  proj: number;
  actual: number;
  salary: number;
};

export type StudyWeek = {
  week: number;
  players: number;
  exact: StudyLineupScore;
  greedyProj: StudyLineupScore;
  greedyValue: StudyLineupScore;
};

export type StudySummary = {
  weeks: number;
  exactMean: number;
  exactMedian: number;
  greedyProjMean: number;
  greedyValueMean: number;
  exactBeatsProj: number;
  exactBeatsValue: number;
};

export type BacktestFile = {
  source: string;
  season: number;
  cap: number;
  notes: string[];
  weeks: StudyWeek[];
  summary: StudySummary;
};

export type QbLagPoint = {
  id: string;
  name: string;
  team: string;
  week: number;
  epaPrev: number;
  epaNext: number;
  cpoePrev: number | null;
  cpoeNext: number | null;
  attPrev: number;
  attNext: number;
};

export type QbLagFile = {
  source: string;
  season: number;
  minAttempts: number;
  n: number;
  corrEpa: number | null;
  corrCpoe: number | null;
  pairs: QbLagPoint[];
};

export type ProjectionModel = {
  id: string;
  label: string;
  mae: number;
  rmse: number;
  n: number;
  lineupMean: number;
  lineupMedian: number;
  weeks: number;
};

export type ProjectionFile = {
  source: string;
  season: number;
  notes: string[];
  models: ProjectionModel[];
};


