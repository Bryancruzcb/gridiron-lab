export const METRICS = {
  epa: {
    label: "EPA",
    def: "Expected points added per play versus a league-average outcome in that down, distance, and field position. Above zero means the offense gained ground.",
  },
  cpoe: {
    label: "CPOE",
    def: "Completion percentage over expected, from nflfastR’s completion-probability model. +5 means five percentage points above a typical throw of that difficulty.",
  },
  proe: {
    label: "PROE",
    def: "Pass rate over expected: called pass rate minus xpass (the model’s pass probability given down, distance, score, and clock), in percentage points.",
  },
  press: {
    label: "Press",
    def: "Sacks plus QB hits as a share of dropbacks. A public-data stand-in for true pressure rate.",
  },
  success: {
    label: "Success",
    def: "Share of plays with positive EPA — roughly, the down got easier.",
  },
  fourthGo: {
    label: "4th-down go",
    def: "Share of 4th downs where the offense passed or ran instead of punting or kicking a field goal.",
  },
  secondShort: {
    label: "2nd & short",
    def: "2nd down with 1–3 yards to go. Pass rate here is a staff tell: take the easy run, or throw.",
  },
  ppr: {
    label: "PPR",
    def: "DraftKings-style points: 1 per reception, 0.1 per rush/rec yard, 0.04 per pass yard, 4 per pass TD, 6 per rush/rec TD, −2 per INT.",
  },
  proj: {
    label: "Proj",
    def: "2025 PPR pace used as the salary-cap objective: 60% season PPG plus 40% weeks 14–18. Not a vendor projection sheet.",
  },
  actual: {
    label: "Actual",
    def: "This week’s PPR from the live box (ESPN) while the game is on, then nflverse when the official week file posts.",
  },
  salary: {
    label: "Salary",
    def: "DraftKings-style cost. The solver must keep the 9-man roster at or under $50,000.",
  },
  val: {
    label: "Pts / $1k",
    def: "Projected points per $1,000 of salary. Higher means more production for the cap hit.",
  },
} as const;

export type MetricId = keyof typeof METRICS;
