# Gridiron Lab

[![CI](https://github.com/Bryancruzcb/gridiron-lab/actions/workflows/ci.yml/badge.svg)](https://github.com/Bryancruzcb/gridiron-lab/actions/workflows/ci.yml)

NFL stats lab with a 2025 holdout. The labs are the app. **`/study` is the result.**

TanStack Start (React 19), Tailwind, Recharts. nflverse + ESPN. Salaries are synthetic DraftKings-style, frozen — not live DK prices.

## Result (2025, weeks 2–18)

114-player pool. Projection = trailing mean PPR from weeks before `w`. Build a $50k lineup. Score it on that week’s actual PPR.

| | Mean actual | Beat greedy-proj |
|---|---|---|
| Exact DP | 116.5 | 7 / 17 weeks |
| Greedy by proj | 115.8 | — |
| Pts/$ greedy | 80.1 | 0 / 17 |

The solver beats “stars and scrubs.” It barely beats ordinary greedy. **+0.7 actual points.** Cap-optimal on a weak projection is still a weak lineup.

QB, 409 consecutive weeks, ≥15 attempts: last week’s EPA/attempt vs this week **r = 0.165**. CPOE **r = 0.143**. The QB lab describes the past.

Eight causal projections, same slate:

- **Shrinkage** to position: best player MAE (6.23), worse lineup (112.9) — it flattens stars.
- **EWMA**: only model that moved lineup actuals (118.9 at α=0.35; peak **121.5 at α=0.30**). Neighbors drop. Do not fit α on 17 weeks.
- **Trailing mean** still wins player MAE (6.58).
- **Opponent-adjust**: 67.8. Thin splits.

MAE = average |projected PPR − actual PPR| per player-week. 6.58 means off by about 6.6 points.

## What failed

Synthetic salaries. Estimated DST points-allowed. Exact DP missed a legal roster some weeks (hill-climb fallback). Trailing mean is a weak forecast. Week 1 2026 is a thin sample.

## Labs

| Route | What |
|---|---|
| `/study` | Holdout. Read this first. |
| `/qb` | EPA / CPOE scatter, down filters, week strip |
| `/optimizer` | $50k exact DP, lock / bench, this-week backtest |
| `/play-calling` | 4th-down go, 2nd-and-short, heatmap |
| `/live` | In-game box → final whistle → next morning |
| `/guide` | Definitions |

## Run it

Node **20.19+ or 22.12+**.

```bash
git clone https://github.com/Bryancruzcb/gridiron-lab.git
cd gridiron-lab
npm install
npm run dev
```

Open [http://localhost:8080](http://localhost:8080).

| Command | |
|---|---|
| `npm run typecheck` | TypeScript (what CI runs) |
| `npm run build` | Production |
| `node --experimental-strip-types scripts/build-study.ts` | Rebuild 2025 holdout JSON |
| `node --experimental-strip-types scripts/compare-proj.ts` | Projection bake-off |
| `node --experimental-strip-types scripts/compare-ewma.ts` | EWMA α sweep |

## CI

GitHub Actions on `main` and PRs: `npm ci` → `npm run typecheck`.

`npm test` is **not** in CI. It still runs 8 failing Grok og-image scaffold tests. Don’t gate the holdout on those.
