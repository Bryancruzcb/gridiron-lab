# Gridiron Lab

[![CI](https://github.com/Bryancruzcb/gridiron-lab/actions/workflows/ci.yml/badge.svg)](https://github.com/Bryancruzcb/gridiron-lab/actions/workflows/ci.yml)

**What this is:** a leakage-controlled evaluation of **fantasy point projections** on NFL player-week data (2023–2025). No DraftKings salary prices in the claim — those were synthetic and are **not** part of the result. The website is secondary. **`/study` holds the published numbers; the pitch is projection quality + honesty about failures.**

Simple rules of the study:
1. Each season uses a fixed 114-player pool built only from the **previous season** (not the week you’re predicting).
2. Projections use **only games before that week** (no peeking at the future).
3. Score projections on that week’s **real** fantasy points (`gridiron-lab-ppr-dst@1`, a simplified DraftKings-**style scoring** ruleset — scoring only, not market salaries).
4. Every number in this README is rebuilt in CI from the same saved study files — not hand-edited.

Stack (secondary): TanStack Start (React 19), TypeScript, nflverse + ESPN.

**How to explain it:** [`docs/DESIGN_NOTEBOOK.md`](docs/DESIGN_NOTEBOOK.md). Prefer that over `docs/IMPLEMENTATION_PROGRESS.md`.

## Result (2023–2025, weeks 2–18)

Each season gets its own 114-player pool built only from the season before (`synthetic-prior-season@1` — prior-season games/PPG to pick the pool; **salary bands from that rule are not used in this pitch**). Projection methods read only earlier weeks. Compare methods by **player MAE** (mean |projected − actual| on played slate player-weeks). 2023 and 2024 ran first and nothing was tuned on them. 2025 is **retrospective**, not a holdout: it had been studied before. No week was dropped.

Player by player the trailing mean is unbiased (−0.02 points over 4,517 player-weeks). That does **not** mean it is a strong forecast — see MAE below.

QB, ≥15 attempts, consecutive weeks: last week’s EPA/attempt vs this week **r = 0.165** (2025, 409 pairs), 0.152 (2024, 425), 0.141 (2023, 433). CPOE **r = 0.143**, 0.121, 0.109. The QB lab describes the past.

Eight projection methods (same pools, no future data), pooled 2023–2025 (51 weeks, 4,517 player-weeks):

| Projection | Player MAE |
|---|---|
| Shrink to position | **5.99** |
| Trailing mean | 6.19 |
| 60/40 season + last 3 | 6.23 |
| EWMA α=0.35 | 6.30 |
| Opponent-adjusted trail | 6.36 |
| Usage × rate | 6.38 |
| Last 3 | 6.51 |
| Last week | 7.78 |

- **Shrinkage** to position has the best player MAE in every season and on the shipped slate (6.29 there). Trailing mean is second everywhere.
- **EWMA α=0.35** is **not** better than trailing mean on player MAE (6.30 vs 6.19 pooled). Its α is a default carried over from the first 2025 scripts, not tuned on 2023–2024. In the exploratory sweeps the best α was 0.40 in 2023, 0.30 in 2024, 0.20 in 2025 and 0.90 on the shipped slate. Do not fit α on 17 weeks.
- **Opponent-adjust** scales the trailing mean by what the opponent allowed at the position over what every opponent allowed, from the same rows, clamped to 0.7–1.3. Player MAE is 6.36 pooled (worse than trailing mean’s 6.19). The first version divided by the pool's own position mean instead, so most skill players sat at the 0.7 floor — fixed as `opp@2`.

MAE = average |projected − actual| per played slate player-week over the compared weeks. Where a 95% range appears elsewhere it is a percentile bootstrap resampling weeks (2,000 resamples, seed 20260912) — descriptive, not a significance test.

**Retired (not claimed):** an older salary-cap lineup experiment used synthetic DraftKings-like prices and an exact $50k optimizer. Those prices were not real market salaries, so that framing is out of the resume pitch. Committed study files may still contain those runs for archaeology; do not present them as the result.

[`docs/study/REGENERATION_REPORT.md`](docs/study/REGENERATION_REPORT.md) attributes earlier number moves (solver, scoring, slate policy, opponent-model fix).

## What failed

- **Synthetic DraftKings salaries in the old cap experiment.** Not real market prices — removed from the claim. Do not put a $50k cap, points-per-dollar, or “exact vs greedy under fake prices” on a resume.
- **The shipped 114-player 2025 slate is look-ahead.** Every offensive player's games, PPG and season points in `src/data/fantasy.json` match the full 2025 regular season. Its projection is 60% season PPG + 40% late-season PPG. Among players with enough games, the RB and WR pools are exactly the top players by that projection. Only 66 of its 114 players are in the clean 2025 pool. It stays as a comparison, never as a clean historical slate.
- **The old study scripts** kept players on a bye on the slate, estimated DST points allowed from touchdowns, field goals and extra points (counting every extra point twice), and read opponents from postgame rows. All fixed.
- **The first opponent adjustment compared different groups.** It divided what an opponent allowed to every player at the position, backups included, by the pool's own position mean, which covers only the top players. Most skill players got the maximum cut. Fixed as `opp@2`.
- **Inactive means zero.** A player with no stat row in a final game counts 0. nflverse also omits active players who recorded nothing, so the two can't be told apart. Trailing-mean lineups used 49 such slots over the 51 weeks (from the retired cap runs — the scoring rule still matters).
- Trailing mean is a weak forecast. Three seasons is still a small sample, and 2025 was examined before. Week 1 2026 is a thin sample.

## Labs

Interactive views. Useful for demos; the science claim lives in **Result** / **What failed** / the design notebook. **`/optimizer` is not part of the DS pitch** (it still demos a salary cap with non-market prices).

| Route | What |
|---|---|
| `/study` | Published study numbers. Read Result in the README first. |
| `/qb` | EPA / CPOE scatter, down filters, week strip, pins. Copy link, saved views |
| `/play-calling` | 4th-down go, 2nd-and-short, heatmap |
| `/players` | This week's box and PPR per player: provisional ESPN lines vs published nflverse rows |
| `/live` | In-game box → final whistle → next morning |
| `/guide` | Definitions |
| `/optimizer` | Demo only — not the resume claim |

Live numbers carry a status line: Live, Cached, Snapshot (the checked-in 2026 file) or unavailable, the time the data was retrieved, and Stale once it is older than that feed allows. A failed refresh keeps the last good rows and their original time; Retry asks again.

Share and save analyses: the QB page keeps filters and pins in the URL. Saved views live in this browser only (up to 50).

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
| `npm test` | Every supported unit suite: scripts, auth and app-data, plus `test:domain` and `test:ui` |
| `npm run test:domain` | Solver, scoring, study pipeline, live-data parsing and freshness; every number in this README's Result and What failed sections and the regeneration report's result tables, recomputed from the committed study files |
| `npm run test:ui` | Lineup controller, worker protocol, links, saved views and exports |
| `npm run build` | Production (the database migrator skips without `DATABASE_URL`) |
| `npm run test:e2e` | Browser checks against the production build. Run `npm run build` and `npx playwright install chromium` first |
| `npm run study:build -- --help` | Reproducible study runs: versioned inputs, strict solver, per-week records |
| `node --experimental-strip-types scripts/build-study.ts` | Shipped-slate 2025 backtest and QB lag JSON |
| `node --experimental-strip-types scripts/compare-proj.ts` | Shipped-slate projection bake-off |
| `node --experimental-strip-types scripts/compare-ewma.ts` | Shipped-slate EWMA α sweep (exploratory) |

### Rebuild the study

The first run downloads nflverse `stats_player_week`, `stats_team_week` and nfldata `games.csv` into `.study-cache/` (gitignored, content-addressed). Run artifacts go to `artifacts/study/`. Only the page files, the input manifest and the facts file are committed.

```bash
npm run study:build -- --seasons 2023,2024 --role development --models core --qb-lag --out-dir artifacts/study/dev
npm run study:build -- --seasons 2025 --role retrospective --models core --qb-lag --out-dir artifacts/study/eval2025
npm run study:build -- --seasons 2025 --role retrospective --universe legacy-fantasy-json --models core --out-dir artifacts/study/legacy2025
npm run study:build -- --seasons 2023-2025 --role retrospective --models ewma-sweep --out-dir artifacts/study/ewma-synth
npm run study:build -- publish \
  --runs artifacts/study/dev/study-run-2023-core.json,artifacts/study/dev/study-run-2024-core.json,artifacts/study/eval2025/study-run-2025-core.json \
  --shipped-slate artifacts/study/legacy2025/study-run-2025-core.json \
  --qb-lag artifacts/study/dev/study-qb-lag-2023.json,artifacts/study/dev/study-qb-lag-2024.json,artifacts/study/eval2025/study-qb-lag-2025.json \
  --out src/data/study-seasons.json --manifest docs/study/input-manifest.json
npm run study:build -- facts \
  --runs artifacts/study/dev/study-run-2023-core.json,artifacts/study/dev/study-run-2024-core.json,artifacts/study/eval2025/study-run-2025-core.json \
  --shipped-slate artifacts/study/legacy2025/study-run-2025-core.json \
  --sweeps artifacts/study/ewma-synth/study-run-2023-ewma-sweep.json,artifacts/study/ewma-synth/study-run-2024-ewma-sweep.json,artifacts/study/ewma-synth/study-run-2025-ewma-sweep.json \
  --out docs/study/study-facts.json
node --experimental-strip-types scripts/build-study.ts
node --experimental-strip-types scripts/compare-proj.ts
node --experimental-strip-types scripts/compare-ewma.ts
```

Add `--offline --pin-inputs docs/study/input-manifest.json` to any `study:build` or wrapper command to rerun from the exact cached bytes; it fails if a hash is missing. `--scoring legacy-study-dst@ce5d6b1` reproduces the old DST formula for attribution only: publish and facts refuse it, and the wrappers refuse it unless `--legacy-out` points outside `src/data`.

## CI

GitHub Actions on `main` and PRs:

1. Restore `~/.npm` from the lockfile hash (save even if a later step fails).
2. `npm ci` — fails if `package-lock.json` is out of date. After `npm install`, commit the lockfile.
3. `npm run routes:generate` — rebuilds `src/routeTree.gen.ts` from `src/routes/` so a new page cannot typecheck-fail because Vite never ran.
4. `npm run typecheck`
5. `npm test` — the full supported unit suite. The few tests that pin gitignored Grok workspace docs (`.grok/skills/`, `AGENTS.md`) report as skipped in a plain checkout.
6. `npm run build` — production build with no `DATABASE_URL`, so the migrator skips.
7. `npm run lint` — errors fail the job; warnings do not.
8. Chromium for the Playwright version in the lockfile, cached in `~/.cache/ms-playwright`.
9. `npm run test:e2e` — builds nothing. It starts one `vite preview` of that build with `GRIDIRON_LIVE_FIXTURE=cookie`, so every live feed answers from `tests/fixtures/football/`, and preloads a guard that fails any server request to a host other than loopback. Then it runs a page smoke over the eight routes at 1280 and 390 px (HTTP 200, no page or console errors, no sideways scroll) and the data-freshness, lineup and shared-analysis scripts in `tests/e2e/`. The browser aborts requests to other hosts, so fonts and team logos don't load there. The server is stopped even when a check fails.
