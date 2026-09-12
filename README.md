# Gridiron Lab

[![CI](https://github.com/Bryancruzcb/gridiron-lab/actions/workflows/ci.yml/badge.svg)](https://github.com/Bryancruzcb/gridiron-lab/actions/workflows/ci.yml)

NFL stats lab with a 2023–2025 lineup study. The labs are the app. **`/study` is the result.**

TanStack Start (React 19), Tailwind, Recharts. nflverse + ESPN. Salaries are synthetic DraftKings-style, frozen — not live DK prices.

## Result (2023–2025, weeks 2–18)

Each season gets its own 114-player pool and synthetic salaries built only from the season before (`synthetic-prior-season@1`). Projection = trailing mean of that season's earlier weeks. The exact solver must prove the best $50k lineup for those projections, or the week is dropped for every method. Score it on that week's actual points (`gridiron-lab-ppr-dst@1`, a simplified DraftKings-style ruleset). 2023 and 2024 ran first and nothing was tuned on them. 2025 is **retrospective**, not a holdout: it had been studied before. No week was dropped.

| Season | Weeks | Exact DP | Greedy by proj | Pts/$ greedy | Exact − greedy (95% range) | Exact W-L-T |
|---|---|---|---|---|---|---|
| 2023 (development) | 17 | 131.9 | 128.5 | 112.5 | +3.5 (−10.2 to +17.6) | 10-6-1 |
| 2024 (development) | 17 | 129.0 | 128.4 | 102.7 | +0.6 (0.0 to +1.7) | 1-0-16 |
| 2025 (retrospective) | 17 | 139.7 | 139.7 | 120.7 | 0.0 (−5.3 to +5.5) | 4-5-8 |
| **Pooled 2023–2025** | **51** | **133.5** | **132.2** | **112.0** | **+1.4 (−3.4 to +6.6)** | **15-11-25** |
| 2025 shipped slate (look-ahead) | 17 | 126.7 | 124.1 | 85.4 | +2.6 (−5.6 to +11.3) | 8-9-0 |

The solver beats “stars and scrubs” by 21.6 points a week pooled (range +14.1 to +28.7; 41 of 51 weeks). Against ordinary greedy it gains **+1.4 a week, and the range includes zero**: 51 weeks cannot tell them apart. A tie means both built the same lineup. Cap-optimal on a weak projection is still a weak lineup.

The exact lineup's pregame projection averaged 188.1 and it scored 133.5. The projection was too high in 51 of 51 weeks (17 of 17 on the shipped slate). Player by player the trailing mean is unbiased (−0.02 points over 4,517 player-weeks), so the gap is selection: the solver picks the players whose averages ran hottest.

QB, ≥15 attempts, consecutive weeks: last week’s EPA/attempt vs this week **r = 0.165** (2025, 409 pairs), 0.152 (2024, 425), 0.141 (2023, 433). CPOE **r = 0.143**, 0.121, 0.109. The QB lab describes the past.

Eight causal projections, same pools, pooled 2023–2025 (51 weeks, 4,517 player-weeks):

| Projection | Player MAE | Lineup mean | vs trailing mean (95% range) |
|---|---|---|---|
| EWMA α=0.35 | 6.30 | 144.0 | +10.5 (+4.2 to +16.8) |
| Opponent-adjusted trail | 6.39 | 137.3 | +3.7 (−2.0 to +9.4) |
| Usage × rate | 6.38 | 136.7 | +3.2 (−2.6 to +9.0) |
| Shrink to position | **5.99** | 136.3 | +2.7 (−1.3 to +7.2) |
| Last 3 | 6.51 | 136.0 | +2.5 (−4.4 to +9.3) |
| 60/40 season + last 3 | 6.23 | 134.7 | +1.1 (−4.1 to +6.3) |
| Trailing mean | 6.19 | 133.5 | — |
| Last week | 7.78 | 131.5 | −2.1 (−10.3 to +6.6) |

- **Shrinkage** to position has the best player MAE in every season and on the shipped slate (6.29 there). Trailing mean is second everywhere. Shrinkage lineups score about the same as trailing-mean lineups.
- **EWMA α=0.35** beat the trailing mean in all three seasons (+13.4, +8.9, +9.1 a week). Its α is a default carried over from the first 2025 scripts, not tuned on 2023–2024. On the shipped 2025 slate it lost (121.2 vs 126.7). The best α in a sweep moves around: 0.40 in 2023, 0.30 in 2024, 0.20 in 2025, 0.90 on the shipped slate. Do not fit α on 17 weeks.
- **Opponent-adjust**: 137.3 pooled, 129.8 on the shipped slate. The old 67.8 came from reading the opponent off the postgame box score. Players who did not play got no adjustment, looked relatively better, and the solver kept picking them.

MAE = average |projected − actual| per played slate player-week over the compared weeks. 95% range = percentile bootstrap of the mean weekly difference, resampling weeks (2,000 resamples, seed 20260912). It is descriptive, not a significance test.

These numbers replace the first publication (116.5 / 115.8 / 80.1, an EWMA peak of 121.5 at α=0.30, opponent-adjust 67.8). [`docs/study/REGENERATION_REPORT.md`](docs/study/REGENERATION_REPORT.md) attributes each change to the solver repair, the scoring repair, the slate and week policy, and the per-season universes.

## What failed

- **Synthetic salaries**, frozen per season. The pools miss rookies and offseason moves.
- **The shipped 114-player 2025 slate is look-ahead.** Every offensive player's games, PPG and season points in `src/data/fantasy.json` match the full 2025 regular season. Its projection is 60% season PPG + 40% weeks 14–18, and salary is a straight line of that projection within each position. Among players with enough games, the RB and WR pools are exactly the top players by that projection. Only 66 of its players are in the clean 2025 pool. It stays as a comparison, never as a clean historical slate.
- **The first exact DP was broken.** It returned nothing on 178 of 510 study solves, and hill-climb stood in while the results were still grouped as exact. The old study page said the overshoot was “not a bug in the picker”; the picker did have a bug, even though the repaired solver overshoots too. The repaired solver proves every study lineup or the week is dropped.
- **The old study scripts** kept players on a bye on the slate (0 points when picked), estimated DST points allowed as TD × 7 + FG × 3 + PAT (every PAT counted twice; the estimate missed the final score in 487 of 544 2025 team-games), and read opponents from postgame rows. All fixed.
- **Inactive means zero.** A player with no stat row in a final game counts 0. nflverse also omits active players who recorded nothing, so the two can't be told apart. Trailing-mean lineups used 49 such slots over the 51 weeks.
- Trailing mean is a weak forecast. Three seasons is still a small sample, and 2025 was examined before. Week 1 2026 is a thin sample.

## Labs

| Route | What |
|---|---|
| `/study` | Lineup study, 2023–2025. Read this first. |
| `/qb` | EPA / CPOE scatter, down filters, week strip |
| `/optimizer` | $50k exact DP, lock / bench, this-week backtest |
| `/play-calling` | 4th-down go, 2nd-and-short, heatmap |
| `/live` | In-game box → final whistle → next morning |
| `/guide` | Definitions |

## Run it

Node **22.12+**. CI runs Node 22. `npm test` runs TypeScript tests with Node's built-in type stripping, which Node 20 does not have.

```bash
git clone https://github.com/Bryancruzcb/gridiron-lab.git
cd gridiron-lab
npm install
npm run dev
```

Open [http://localhost:8080](http://localhost:8080).

| Command | |
|---|---|
| `npm run typecheck` | TypeScript |
| `npm test` | Every supported unit suite: scripts, auth and app-data, plus `test:domain` and `test:ui` when they exist |
| `npm run build` | Production (the database migrator skips without `DATABASE_URL`) |
| `npm run study:build -- --help` | Reproducible study runs: versioned inputs, strict solver, per-week records |
| `node --experimental-strip-types scripts/build-study.ts` | Shipped-slate 2025 backtest and QB lag JSON |
| `node --experimental-strip-types scripts/compare-proj.ts` | Shipped-slate projection bake-off |
| `node --experimental-strip-types scripts/compare-ewma.ts` | Shipped-slate EWMA α sweep (exploratory) |

### Rebuild the study

The first run downloads nflverse `stats_player_week`, `stats_team_week` and nfldata `games.csv` into `.study-cache/` (gitignored, content-addressed). Run artifacts go to `artifacts/study/`. Only the page files and the input manifest are committed.

```bash
npm run study:build -- --seasons 2023,2024 --role development --models core --qb-lag --out-dir artifacts/study/dev
npm run study:build -- --seasons 2025 --role retrospective --models core --qb-lag --out-dir artifacts/study/eval2025
npm run study:build -- --seasons 2025 --role retrospective --universe legacy-fantasy-json --models core --out-dir artifacts/study/legacy2025
npm run study:build -- publish \
  --runs artifacts/study/dev/study-run-2023-core.json,artifacts/study/dev/study-run-2024-core.json,artifacts/study/eval2025/study-run-2025-core.json \
  --shipped-slate artifacts/study/legacy2025/study-run-2025-core.json \
  --qb-lag artifacts/study/dev/study-qb-lag-2023.json,artifacts/study/dev/study-qb-lag-2024.json,artifacts/study/eval2025/study-qb-lag-2025.json \
  --out src/data/study-seasons.json --manifest docs/study/input-manifest.json
node --experimental-strip-types scripts/build-study.ts
node --experimental-strip-types scripts/compare-proj.ts
node --experimental-strip-types scripts/compare-ewma.ts
```

Add `--offline --pin-inputs docs/study/input-manifest.json` to any `study:build` or wrapper command to rerun from the exact cached bytes; it fails if a hash is missing. `--scoring legacy-study-dst@ce5d6b1` reproduces the old DST formula for attribution only and is never published.

## CI

GitHub Actions on `main` and PRs:

1. Restore `~/.npm` from the lockfile hash (save even if a later step fails).
2. `npm ci` — fails if `package-lock.json` is out of date. After `npm install`, commit the lockfile.
3. `npm run routes:generate` — rebuilds `src/routeTree.gen.ts` from `src/routes/` so a new page cannot typecheck-fail because Vite never ran.
4. `npm run typecheck`
5. `npm test` — the full supported unit suite. The few tests that pin gitignored Grok workspace docs (`.grok/skills/`, `AGENTS.md`) report as skipped in a plain checkout.
6. `npm run build` — production build with no `DATABASE_URL`, so the migrator skips.
7. `npm run lint` — errors fail the job; warnings do not.
