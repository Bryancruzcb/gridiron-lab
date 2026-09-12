# Study regeneration report

Date: 2026-09-12. Branch `wip/task5-study-results`. Pipeline `gridiron-lab-study-pipeline@1`, solver `gridiron-lab-solveLineup@1` (strict), scoring `gridiron-lab-ppr-dst@1`. Runs made on Windows 11 with Node 26.3.0.

This report compares the study numbers published at baseline `ce5d6b1` with the numbers regenerated through the study pipeline. It attributes each change to one cause at a time: (a) the solver repair and strict exact metadata, (b) the scoring repair, (c) the slate, week and exclusion policy, and (d) the per-season universes and the multi-season extension.

## Summary

- **Old headline** (2025, the shipped 114-player slate): exact DP 116.5, greedy by projection 115.8, points-per-dollar greedy 80.1. The exact lineup beat greedy in 7 of 17 weeks.
- **The same slate, regenerated**: 126.7, 124.1 and 85.4, with the exact lineup ahead in 8 of 17 weeks. The +2.6 weekly gap has a 95% week-bootstrap range of −5.6 to +11.3.
- **Clean per-season pools** (2023–2025 pooled, 51 weeks): 133.5, 132.2 and 112.0. The gap is +1.4, range −3.4 to +6.6.
- **Still true**: the solver is clearly better than points-per-dollar greedy and not clearly better than projection greedy. Its pregame projection was higher than its actual score in every week of every run.
- **No longer true**:
  - The picker had no bug. It had one, although the overshoot does not come from it.
  - Trailing mean wins player MAE. Shrinkage wins it in every run.
  - Opponent adjustment builds terrible teams. That result came from a postgame-row lookup.
  - EWMA peaks at α=0.30 on 2025. The peak moves once the solver is fixed, and it moves again from season to season.
- **Unchanged**: the QB lag file has the same 409 pairs with the same values and correlations; only the pair order differs.

## Inputs

Every input was fetched by the pipeline's acquisition step into `.study-cache/` (gitignored). The committed manifest is [`input-manifest.json`](input-manifest.json).

| Input | sha256 | Bytes | Upstream Last-Modified | First retrieved (UTC) |
|---|---|---|---|---|
| `stats_player_week_2022` | `ad426c3fe5bf1cc3…` | 8,408,729 | 2026-08-13 16:48:13 | 2026-09-12T22:13:53Z |
| `stats_team_week_2022` | `9803875bd0b74aa4…` | 228,947 | 2026-08-13 16:48:16 | 2026-09-12T22:13:54Z |
| `stats_player_week_2023` | `f19cb71a5de0dce7…` | 8,332,874 | 2026-08-13 16:48:36 | 2026-09-12T22:13:50Z |
| `stats_team_week_2023` | `dc5a387daabe8663…` | 229,582 | 2026-08-13 16:48:38 | 2026-09-12T22:13:51Z |
| `stats_player_week_2024` | `3ddc45a84f759aa3…` | 8,470,040 | 2026-08-13 16:49:11 | 2026-09-12T22:13:59Z |
| `stats_team_week_2024` | `b207a1430c2715d0…` | 229,712 | 2026-08-13 16:49:13 | 2026-09-12T22:13:59Z |
| `stats_player_week_2025` | `e5e0615b3d96a3ea…` | 8,656,387 | 2026-08-13 16:51:22 | 2026-09-12T22:15:59Z |
| `stats_team_week_2025` | `91058a59d8948553…` | 229,660 | 2026-08-13 16:51:24 | 2026-09-12T22:15:59Z |
| `nfldata_games` (`games.csv`) | `63beda7e89774e6c…` | 2,178,389 | none (etag only) | 2026-09-12T22:13:51Z |
| `fantasy.json` (repo file, LF-normalized) | `7f401dfb3e230b7b…` | 34,840 | – | read at run time |

Notes on the inputs:

- The 2025 stats hashes match the bytes the wave 1 scoring checks used.
- `games.csv` is a single mutable file. Wave 1 recorded `e5443356…` earlier the same day, so it has changed since. Every run pins the hash it read.
- The 2022 files exist only because the 2023 universe is built from 2022.
- Each season's player-week file has 22 rows that the shared parser skips (missing id, team, season or week). The run meta files record this as a warning.

## Runs

"First" runs were made on commit `7493078` (clean tree); the development run also downloaded the 2022–2024 files and `games.csv`, and the 2025 run downloaded the 2025 files. "Rerun" is the full pinned offline rerun (`--offline --pin-inputs docs/study/input-manifest.json`) on the results commit before the manifest-retrieval fix was folded into it (meta `sourceCommit` `3c80263`; the fold changed only how the manifest keeps retrieval times), with only page and doc edits uncommitted. Elapsed times come from each run's `.meta.json`.

| Purpose | Command (all `npm run study:build --` unless noted) | Run id | resultSha256 | Elapsed first / rerun |
|---|---|---|---|---|
| 2023 development | `--seasons 2023,2024 --role development --models core --qb-lag` | `run-ccd95ce80683a5be` | `7f52eda7adb1…` | 8,886 / 3,965 ms |
| 2024 development | (same command) | `run-9bb334f25c8c50d0` | `d6140bd4c2bc…` | 5,789 / 3,948 ms |
| 2025 retrospective | `--seasons 2025 --role retrospective --models core --qb-lag` | `run-2a18ed7b1af9319f` | `e7ae6f1606ac…` | 6,600 (with download), 4,097 offline / 3,881 ms |
| 2025 shipped slate | `--seasons 2025 --role retrospective --universe legacy-fantasy-json --models core` | `run-541d16551040108e` | `e49bf5d9951b…` | 3,464 / 3,245 ms |
| Attribution only, never published | same plus `--scoring legacy-study-dst@ce5d6b1` | `run-cc4cbf7589429295` | `ce70618a65e7…` | 3,904 / 3,457 ms |
| EWMA sweep, exploratory | `--seasons 2023-2025 --role retrospective --models ewma-sweep` | `run-43a5f8c5df66e2a8`, `run-49caec44e4d49f8e`, `run-3579951cea06d2d3` | `31a0b8f3ed7c…`, `6334a8ca467a…`, `2f81c44e703d…` | 8,531, 9,493, 10,650 / 7,892, 7,797, 7,439 ms |
| `study-backtest.json`, `study-qb-lag.json` | `node --experimental-strip-types scripts/build-study.ts` | `run-4c477eee00e6c321` | `c5c1b6a62d55…` | 1,042 / 1,012 ms |
| `study-projections.json` | `node --experimental-strip-types scripts/compare-proj.ts` | `run-591884ce0be673d4` | `35d079d589a4…` | 3,383 / 3,168 ms |
| `study-ewma.json` | `node --experimental-strip-types scripts/compare-ewma.ts` | `run-7e9f57ae6af17c33` | `ca2f07ff2ab2…` | 7,408 / 7,053 ms |
| `study-seasons.json`, manifest | `publish --runs … --shipped-slate … --qb-lag … --out src/data/study-seasons.json --manifest docs/study/input-manifest.json` | file `3483f5176058…` | pools `ae7a13d47405…` (2023+2024), `0f11b3819fd6…` (all) | 1,142 ms wall (rerun) |

The locked model configuration is the `core` preset, `modelsSha256` `e07e4524674f40bf2e0cd19ddc3a368f404534c5560b0e290f8a6c2a55a1f3bb`. The universes are `synthetic-prior-season@1:2023` `f462cf7709cb…`, `:2024` `be9a19bb2ada…`, `:2025` `f1f1f4bf09c2…`, and the shipped slate `666a3b3de634…`.

## Reproducibility

- **Offline repeat.** The 2025 run was repeated offline into a second directory. The run, universe and QB lag files were byte-identical, with run id `run-2a18ed7b1af9319f` both times.
- **Pinned rerun of everything.** Every command above was rerun offline, pinned to the committed manifest. It reproduced byte for byte:
  - all eleven run and multi-season artifacts;
  - the three QB lag files;
  - `src/data/study-backtest.json`, `study-qb-lag.json`, `study-projections.json` and `study-ewma.json`;
  - `src/data/study-seasons.json`.
- **Manifest fix.** The first rerun's manifest differed in one field: the read time of the repo file `fantasy.json`. Publishing now keeps the first recorded retrieval of identical bytes. A republish from the rerun meta files then reproduced the committed manifest byte for byte. A test covers this.
- **Changed source bytes.** A source-byte change produces a different run id. The pin test in `tests/domain/study-cli.test.ts` covers this. The publish step re-verifies each run's id, result hash and summary against its week records, and refuses edited files.

## Where the shipped 114-player slate came from

`src/data/fantasy.json` arrived in the initial commit `23f0d54`. No generator script is in the history. `src/lib/metrics.ts` describes its projection as "60% season PPG plus 40% weeks 14–18". An audit against the cached 2025 bytes found the following:

- **Season stats.** For all 98 offensive players, `games`, `ppg` and season `ppr` equal the full 2025 regular season in nflverse `fantasy_points_ppr`.
- **Late-season PPG.** `recencyPpg` equals weeks 14–18 PPG for 95 of 98. The three exceptions each played one late game.
- **Projection.** `proj = 0.6 × ppg + 0.4 × recencyPpg` holds for 114 of 114.
- **Salaries.** Within each position, salary is linear in `proj`: R² 0.996–0.998, Spearman 0.986–0.994. The bands are QB $5,000–8,200, RB $4,000–9,000, WR $3,500–9,200, TE $2,500–6,800 and DST $2,000–3,200.
- **Selection.** Each pool is essentially the top N by that projection among players with a minimum number of games (4 for QB and WR, 8 for RB and TE):
  - RB 28 of 28 and WR 36 of 36 match exactly;
  - QB 16 of 18 (Mitchell Trubisky and Patrick Mahomes rank higher but are absent);
  - TE 15 of 16.
- **Defenses.** DST `ppg` does not match the old study scripts' formula (1 of 16), so defense projections came from yet another scoring path.

The pool and every salary therefore use information from after every 2025 prediction cutoff, including weeks 14–18. The pipeline labels this universe `lookAhead: true`, and the page and README call it the shipped slate, a comparison and never a clean historical slate. Only 66 of its 114 players are in the synthetic 2025 pool built from 2024.

## Before and after on the shipped 2025 slate

The table applies one change at a time, in the order shown. Attribution depends on that order.

- **Steps 0 to c1** come from a throwaway replay harness kept in the gitignored `artifacts/` directory, not committed. It runs the ce5d6b1 `build-study.ts`, `compare-proj.ts` and `compare-ewma.ts` logic line for line against the cached 2025 bytes. Its only switches are the solver (the ce5d6b1 `exactLineup ?? hillClimbLineup` and `greedyLineup`, or the repaired `solveLineup`) and, for c1, dropping pool players whose team has no team-week row that week.
- **Steps c2 to d** are the committed pipeline runs listed above.
- **To rebuild the harness**, take `git show ce5d6b1:` of the three scripts and `src/lib/optimizer.ts`, read the snapshot files named in the manifest instead of fetching, and swap the solver calls.

| Step | Computer mean | Median | Top names | Cheap picks | Computer beat top names | Trail MAE | Shrink MAE | EWMA 0.35 lineup | Shrink lineup | Opp-adjust lineup | Sweep best α |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Published (ce5d6b1 files) | 116.5 | 119.6 | 115.8 | 80.1 | 7 of 17 | 6.58 | 6.23 | 118.9 | 112.9 | 67.8 | 0.30 (121.5) |
| 0. Replay of ce5d6b1 scripts on the cached bytes | 116.5 | 119.6 | 115.8 | 80.1 | 7 of 17 | 6.58 | 6.23 | 118.9 | 112.9 | 67.8 | 0.30 (121.5) |
| a. + repaired solver (strict `solveLineup`) | 114.1 | 117.1 | 115.8 | 80.1 | 8 of 17 | 6.58 | 6.23 | 113.6 | 113.6 | 62.3 | 0.90 (120.1) |
| c1. + players on a bye removed from the slate | 122.1 | 123.4 | 123.2 | 83.8 | 8 of 17 | 6.58 | 6.23 | 120.8 | 122.1 | 79.8 | 0.90 (131.6) |
| c2. + rest of the pipeline policy, legacy DST scoring | 122.1 | 123.4 | 123.2 | 83.8 | 8 of 17 | 6.58 | 6.23 | 120.8 | 123.6 | 127.5 | not run |
| b. + scoring repair (`gridiron-lab-ppr-dst@1`) | 126.7 | 135.9 | 124.1 | 85.4 | 8 of 17 | 6.63 | 6.29 | 121.2 | 125.8 | 129.8 | 0.90 (132.5) |
| d. per-season universe instead (2025 only) | 139.7 | 142.7 | 139.7 | 120.7 | 4 of 17 | 6.17 | 5.99 | 148.9 | 140.8 | 147.4 | 0.20 (150.3) |

Step 0 reproduces every published number exactly, so the upstream 2025 files did not drift in any way that matters here.

### (a) Solver repair and strict exact metadata

- **Fallback rate.** Across the three baseline scripts, the old `exactLineup` returned `null` on 178 of 510 exact solves (35%). Those 510 are 17 backtest weeks, 8 × 17 projection weeks and 21 × 17 sweep weeks. `hillClimbLineup` stood in each time.
- **What the files claimed.** The old backtest notes admitted the fallback, but the results stayed in the exact column and fed every summary.
- **Cost of the fallback.** In 155 of the 178, the substitute's projection was below the proven optimum: by 10.7 projected points on average and up to 62.0. The other 23 fallbacks happened to reach an optimum.
- **Where the solvers agreed.** On the 332 solves where the old DP returned a lineup, and on all 34 greedy solves, the repaired solver found the same projected total. No illegal roster appeared in these lock-free runs.
- **Trailing-mean backtest.** The fallback weeks were 2, 9, 10, 11 and 16. Their actual totals moved 119.6→114.6, 140.1→106.1, 142.7→129.6, 129.0→118.1 and 101.1→123.4, and the mean moved 116.5→114.1.
- **Luck in the old numbers.** The fallback lineups were projected worse but happened to score more. Part of the old EWMA peak at α=0.30 was fallback luck too: with the repaired solver the sweep's best setting becomes 0.90.
- **Strict records now.** The pipeline calls `solveLineup` once per model and week, with no fallback. Each week stores the method requested and used, the status, the code and the optimality. In every published run all 136 exact solves are `exact-dp/proven`, and all 34 greedy solves are recorded as `heuristic`.

### (b) Scoring repair

- **Old formula.** The baseline estimated points allowed as the opponent's (passing TD + rushing TD) × 7 + FG × 3 + PAT, which counts each PAT twice. It took sacks and takeaways from the team's own `def_*` columns and fell back to 24 points allowed when the opponent row was missing.
- **New ruleset.** `gridiron-lab-ppr-dst@1` uses the opponent's final score from the schedule, takeaways from the opponent's giveaway columns, and no fill values.
- **Size of the change.** Measured with the pipeline's two scoring paths on the same bytes:

| Season | Team-games | DST points changed | Mean change (new − old) | Old points-allowed estimate ≠ final score | Mean absolute points-allowed error | 24-point fills |
|---|---|---|---|---|---|---|
| 2023 | 544 | 238 (43.8%) | +0.89 | 473 | 2.75 | 0 |
| 2024 | 544 | 245 (45.0%) | +1.01 | 488 | 2.75 | 0 |
| 2025 | 544 | 245 (45.0%) | +1.13 | 487 | 2.80 | 0 |

Offense did not change: wave 1 showed that the ruleset equals `fantasy_points_ppr` on every 2025 regular-season row. On the shipped slate, the scoring repair raised the computer's mean by 4.6 and the top-names mean by 0.9, and it moved trailing-mean MAE from 6.58 to 6.63.

### (c) Slate, week and exclusion policy

- **Byes (c1).** The old scripts put every pool player with earlier history on the week's slate, whether or not his team played. Old slates held 108–114 players; the regenerated shipped-slate weeks hold 87–114. At step 0, bye players filled 5 slots in the trailing-mean exact lineups, 11 in greedy-by-projection and 9 in points-per-dollar greedy, each scoring 0. Removing them raised the computer by 8.0, top names by 7.4 and cheap picks by 3.7.
- **Rest of the pipeline (c2).** This step adds scheduled opponents, one pre-cutoff snapshot for priors and features, 4-decimal projections and latest-team-before-cutoff eligibility.
  - Trailing mean, both greedy baselines, last week, last 3, blend, EWMA and usage are unchanged at one decimal.
  - Shrink moves +1.5 (122.1→123.6). That residual was not decomposed further; the candidates are projection rounding (4 instead of 2 decimals changes tie-breaks) and the latest-team rule.
  - Opponent adjustment jumps from 79.8 to 127.5. The old script read week w's opponent from the player's week-w stat row. A player with no row (inactive, and before c1 also on bye) got an adjustment factor of 1, while everyone else was scaled by the clamped factor, often 0.7, so non-playing players looked relatively better. At step 0 the opponent-adjusted lineups held 78 offensive players with no week-w row over 17 weeks (27 of them on bye), and still 70 at c1, against 17 and 12 for the trailing mean. With opponents taken from the schedule, that bias is gone.
- **Common weeks and exclusions.** In every regenerated run every solve succeeded and every lineup actual was complete, so no week was excluded and all 17 weeks per season are the common set. The exclusion policy is in place but changed nothing on these seasons.
- **Zero fill.** The old scripts counted a missing actual as 0. The pipeline counts only `inactive` (final game, source covers the week, no row) as 0 and would exclude the week for `not-final`, `missing-source` or `unknown-identity`. In 2023–2025 only `played` and `inactive` occur on the slates, so lineup totals match the old zero fill.
- **MAE.** The denominator is still played slate player-weeks (n = 1,552 on the shipped slate, as before). With 17 or 51 weeks, the median rule (average of the two middle values instead of the lower one) changes nothing.

### (d) Per-season universes and multi-season extension

- **The universe rule.** `synthetic-prior-season@1` builds each season's pool (QB 18, RB 28, WR 36, TE 16, DST 16) from the prior regular season only. It takes the top players by points per game with at least 4 scored games and prices them linearly within the shipped slate's per-position bands, rounded to $100. The universe is frozen and hashed before week 1.
- **Levels are not comparable across universes.** The pools share 66 of 114 players and the prices differ, so a computer mean of 139.7 on the synthetic 2025 pool against 126.7 on the shipped slate says nothing on its own. Comparisons inside a run are paired week by week.
- **What differs between pools.** The exact-vs-greedy gap is +2.6 on the shipped slate and 0.0 on the synthetic 2025 pool. EWMA α=0.35 gains +9.1 on the synthetic pool and loses 5.5 on the shipped slate.

## Per-season results

### Lineups: computer (trailing mean, exact DP) vs the greedy baselines

"Computer projected" is the exact lineup's mean pregame projection. The ranges are 95% week-bootstrap ranges. W-L-T counts weeks from the computer's side; a tie means both methods picked the same lineup.

| Run | Weeks | Computer mean (median) | Computer projected | Top names | Cheap picks | Computer − top names: mean, median [95%], W-L-T | Computer − cheap: mean [95%], W-L-T |
|---|---|---|---|---|---|---|---|
| 2023 development | 17 | 131.9 (143.4) | 189.1 | 128.5 | 112.5 | +3.5, +1.1 [−10.2, +17.6], 10-6-1 | +19.4 [+5.1, +33.0], 13-4-0 |
| 2024 development | 17 | 129.0 (130.2) | 186.4 | 128.4 | 102.7 | +0.6, 0.0 [0.0, +1.7], 1-0-16 | +26.3 [+11.1, +40.0], 14-3-0 |
| 2025 retrospective | 17 | 139.7 (142.7) | 188.9 | 139.7 | 120.7 | 0.0, 0.0 [−5.3, +5.5], 4-5-8 | +19.1 [+10.3, +27.0], 14-3-0 |
| pooled 2023+2024 | 34 | 130.4 (135.1) | 187.7 | 128.4 | 107.6 | +2.0, 0.0 [−4.9, +9.4], 11-6-17 | +22.9 [+12.9, +33.2], 27-7-0 |
| pooled 2023+2024+2025 | 51 | 133.5 (140.9) | 188.1 | 132.2 | 112.0 | +1.4, 0.0 [−3.4, +6.6], 15-11-25 | +21.6 [+14.1, +28.7], 41-10-0 |
| 2025 shipped slate (look-ahead) | 17 | 126.7 (135.9) | 179.6 | 124.1 | 85.4 | +2.6, −1.9 [−5.6, +11.3], 8-9-0 | +41.3 [+30.4, +52.4], 17-0-0 |

The projection was higher than the actual lineup score in 17 of 17 weeks in each of 2023, 2024, 2025 and the shipped slate. Player-level bias of the trailing mean is −0.02 points pooled (n = 4,517), so the lineup overshoot is selection: the solver picks the players whose earlier averages ran highest. It is not a biased projection, and it is not the solver bug, because proven-optimal lineups overshoot too.

### Models by run

MAE, RMSE and bias are per played slate player-week over the common weeks; bias is projection minus actual. The last column compares each model's weekly lineup with the trailing mean's.

#### 2023 development (`run-ccd95ce80683a5be`)

| Model | Solver | Lineup mean | Median | Projected | MAE | RMSE | Bias | n | Model − trail: mean [95%], W-L-T |
|---|---|---|---|---|---|---|---|---|---|
| Trailing mean | exact-dp | 131.9 | 143.4 | 189.1 | 6.24 | 8.17 | −0.05 | 1500 | baseline |
| Last week | exact-dp | 130.2 | 124.9 | 256.9 | 7.76 | 10.12 | −0.03 | 1500 | −1.7 [−16.5, +13.6], 9-7-1 |
| Last 3 | exact-dp | 136.6 | 130.7 | 211.1 | 6.53 | 8.56 | −0.10 | 1500 | +4.7 [−8.6, +18.4], 8-6-3 |
| 60/40 season + last 3 | exact-dp | 132.8 | 139.9 | 193.6 | 6.26 | 8.20 | −0.07 | 1500 | +0.9 [−9.5, +12.8], 7-7-3 |
| EWMA α=0.35 | exact-dp | 145.4 | 154.4 | 201.2 | 6.31 | 8.32 | −0.14 | 1500 | +13.4 [−0.2, +28.3], 11-5-1 |
| Shrink to position | exact-dp | 137.1 | 147.0 | 157.3 | 6.02 | 7.73 | −0.04 | 1500 | +5.2 [−4.7, +16.1], 3-1-13 |
| Usage × rate | exact-dp | 128.1 | 126.9 | 200.2 | 6.40 | 8.39 | +0.04 | 1500 | −3.8 [−15.4, +7.2], 6-9-2 |
| Opponent-adjusted trail | exact-dp | 137.8 | 127.7 | 144.3 | 6.42 | 8.56 | −3.12 | 1500 | +5.9 [−7.1, +19.4], 9-8-0 |
| Trailing mean, greedy by projection | greedy-proj | 128.5 | 117.6 | 176.8 | 6.24 | 8.17 | −0.05 | 1500 | −3.5 [−17.6, +10.2], 6-10-1 |
| Trailing mean, greedy by value | greedy-value | 112.5 | 109.6 | 162.6 | 6.24 | 8.17 | −0.05 | 1500 | −19.4 [−33.0, −5.1], 4-13-0 |

#### 2024 development (`run-9bb334f25c8c50d0`)

| Model | Solver | Lineup mean | Median | Projected | MAE | RMSE | Bias | n | Model − trail: mean [95%], W-L-T |
|---|---|---|---|---|---|---|---|---|---|
| Trailing mean | exact-dp | 129.0 | 130.2 | 186.4 | 6.18 | 8.04 | −0.12 | 1495 | baseline |
| Last week | exact-dp | 130.4 | 128.9 | 248.8 | 7.81 | 10.04 | +0.12 | 1495 | +1.4 [−9.7, +12.8], 7-9-1 |
| Last 3 | exact-dp | 134.9 | 134.4 | 207.5 | 6.44 | 8.37 | +0.07 | 1495 | +5.9 [−3.7, +16.4], 8-6-3 |
| 60/40 season + last 3 | exact-dp | 128.6 | 127.9 | 190.6 | 6.18 | 8.04 | −0.04 | 1495 | −0.3 [−8.6, +8.3], 6-7-4 |
| EWMA α=0.35 | exact-dp | 137.8 | 138.0 | 198.4 | 6.26 | 8.16 | −0.01 | 1495 | +8.9 [−0.6, +18.9], 10-5-2 |
| Shrink to position | exact-dp | 131.0 | 126.7 | 157.1 | 5.96 | 7.64 | −0.12 | 1495 | +2.0 [−3.3, +7.7], 6-7-4 |
| Usage × rate | exact-dp | 135.3 | 138.2 | 207.3 | 6.35 | 8.18 | +0.21 | 1495 | +6.3 [−3.8, +17.2], 9-6-2 |
| Opponent-adjusted trail | exact-dp | 126.5 | 126.0 | 140.3 | 6.47 | 8.67 | −3.31 | 1495 | −2.4 [−8.8, +5.1], 5-8-4 |
| Trailing mean, greedy by projection | greedy-proj | 128.4 | 130.2 | 186.0 | 6.18 | 8.04 | −0.12 | 1495 | −0.6 [−1.7, 0.0], 0-1-16 |
| Trailing mean, greedy by value | greedy-value | 102.7 | 97.4 | 169.9 | 6.18 | 8.04 | −0.12 | 1495 | −26.3 [−40.0, −11.1], 3-14-0 |

#### 2025 retrospective (`run-2a18ed7b1af9319f`)

| Model | Solver | Lineup mean | Median | Projected | MAE | RMSE | Bias | n | Model − trail: mean [95%], W-L-T |
|---|---|---|---|---|---|---|---|---|---|
| Trailing mean | exact-dp | 139.7 | 142.7 | 188.9 | 6.17 | 8.08 | +0.11 | 1522 | baseline |
| Last week | exact-dp | 133.8 | 119.3 | 255.4 | 7.78 | 10.42 | +0.14 | 1522 | −5.9 [−22.5, +11.7], 7-9-1 |
| Last 3 | exact-dp | 136.6 | 143.8 | 208.2 | 6.57 | 8.62 | +0.12 | 1522 | −3.1 [−14.3, +8.5], 5-9-3 |
| 60/40 season + last 3 | exact-dp | 142.6 | 145.0 | 194.4 | 6.24 | 8.17 | +0.12 | 1522 | +2.8 [−3.9, +10.4], 6-6-5 |
| EWMA α=0.35 | exact-dp | 148.9 | 153.3 | 198.7 | 6.31 | 8.30 | +0.04 | 1522 | +9.1 [−0.5, +18.9], 11-5-1 |
| Shrink to position | exact-dp | 140.8 | 142.9 | 158.6 | 5.99 | 7.74 | +0.09 | 1522 | +1.0 [−3.0, +5.0], 6-3-8 |
| Usage × rate | exact-dp | 146.7 | 143.9 | 200.6 | 6.38 | 8.36 | +0.29 | 1522 | +7.0 [+1.2, +13.6], 8-6-3 |
| Opponent-adjusted trail | exact-dp | 147.4 | 154.5 | 144.4 | 6.27 | 8.57 | −2.98 | 1522 | +7.6 [+0.5, +15.4], 11-5-1 |
| Trailing mean, greedy by projection | greedy-proj | 139.7 | 134.2 | 186.8 | 6.17 | 8.08 | +0.11 | 1522 | −0.0 [−5.5, +5.3], 5-4-8 |
| Trailing mean, greedy by value | greedy-value | 120.7 | 114.3 | 164.0 | 6.17 | 8.08 | +0.11 | 1522 | −19.1 [−27.0, −10.3], 3-14-0 |

#### Pooled 2023–2024, development only (`ae7a13d47405…`)

| Model | Solver | Lineup mean | Median | Projected | MAE | RMSE | Bias | n | Model − trail: mean [95%], W-L-T |
|---|---|---|---|---|---|---|---|---|---|
| Trailing mean | exact-dp | 130.4 | 135.1 | 187.7 | 6.21 | 8.11 | −0.08 | 2995 | baseline |
| Last week | exact-dp | 130.3 | 126.9 | 252.9 | 7.78 | 10.08 | +0.05 | 2995 | −0.1 [−8.4, +8.7], 16-16-2 |
| Last 3 | exact-dp | 135.7 | 134.2 | 209.3 | 6.48 | 8.47 | −0.01 | 2995 | +5.3 [−3.1, +13.6], 16-12-6 |
| 60/40 season + last 3 | exact-dp | 130.7 | 132.4 | 192.1 | 6.22 | 8.13 | −0.06 | 2995 | +0.3 [−6.2, +7.4], 13-14-7 |
| EWMA α=0.35 | exact-dp | 141.6 | 141.2 | 199.8 | 6.29 | 8.24 | −0.07 | 2995 | +11.1 [+3.0, +19.8], 21-10-3 |
| Shrink to position | exact-dp | 134.0 | 138.5 | 157.2 | 5.99 | 7.69 | −0.08 | 2995 | +3.6 [−2.2, +9.9], 9-8-17 |
| Usage × rate | exact-dp | 131.7 | 130.8 | 203.7 | 6.37 | 8.29 | +0.12 | 2995 | +1.2 [−6.5, +9.0], 15-15-4 |
| Opponent-adjusted trail | exact-dp | 132.2 | 126.5 | 142.3 | 6.45 | 8.61 | −3.21 | 2995 | +1.7 [−5.4, +9.6], 14-16-4 |
| Trailing mean, greedy by projection | greedy-proj | 128.4 | 120.5 | 181.4 | 6.21 | 8.11 | −0.08 | 2995 | −2.0 [−9.4, +4.9], 6-11-17 |
| Trailing mean, greedy by value | greedy-value | 107.6 | 107.0 | 166.2 | 6.21 | 8.11 | −0.08 | 2995 | −22.9 [−33.2, −12.9], 7-27-0 |

#### Pooled 2023–2025 (`0f11b3819fd6…`)

| Model | Solver | Lineup mean | Median | Projected | MAE | RMSE | Bias | n | Model − trail: mean [95%], W-L-T |
|---|---|---|---|---|---|---|---|---|---|
| Trailing mean | exact-dp | 133.5 | 140.9 | 188.1 | 6.19 | 8.10 | −0.02 | 4517 | baseline |
| Last week | exact-dp | 131.5 | 122.6 | 253.7 | 7.78 | 10.20 | +0.08 | 4517 | −2.1 [−10.3, +6.6], 23-25-3 |
| Last 3 | exact-dp | 136.0 | 134.7 | 208.9 | 6.51 | 8.52 | +0.03 | 4517 | +2.5 [−4.4, +9.3], 21-21-9 |
| 60/40 season + last 3 | exact-dp | 134.7 | 138.0 | 192.9 | 6.23 | 8.14 | 0.00 | 4517 | +1.1 [−4.1, +6.3], 19-20-12 |
| EWMA α=0.35 | exact-dp | 144.0 | 143.1 | 199.5 | 6.30 | 8.26 | −0.04 | 4517 | +10.5 [+4.2, +16.8], 32-15-4 |
| Shrink to position | exact-dp | 136.3 | 142.9 | 157.7 | 5.99 | 7.71 | −0.02 | 4517 | +2.7 [−1.3, +7.2], 15-11-25 |
| Usage × rate | exact-dp | 136.7 | 140.9 | 202.7 | 6.38 | 8.31 | +0.18 | 4517 | +3.2 [−2.6, +9.0], 23-21-7 |
| Opponent-adjusted trail | exact-dp | 137.3 | 133.8 | 143.0 | 6.39 | 8.60 | −3.13 | 4517 | +3.7 [−2.0, +9.4], 25-21-5 |
| Trailing mean, greedy by projection | greedy-proj | 132.2 | 127.1 | 183.2 | 6.19 | 8.10 | −0.02 | 4517 | −1.4 [−6.6, +3.4], 11-15-25 |
| Trailing mean, greedy by value | greedy-value | 112.0 | 108.5 | 165.5 | 6.19 | 8.10 | −0.02 | 4517 | −21.6 [−28.7, −14.1], 10-41-0 |

#### 2025 shipped slate, look-ahead (`run-541d16551040108e`)

| Model | Solver | Lineup mean | Median | Projected | MAE | RMSE | Bias | n | Model − trail: mean [95%], W-L-T |
|---|---|---|---|---|---|---|---|---|---|
| Trailing mean | exact-dp | 126.7 | 135.9 | 179.6 | 6.63 | 8.62 | −0.81 | 1552 | baseline |
| Last week | exact-dp | 129.6 | 129.5 | 264.5 | 8.43 | 10.98 | −0.09 | 1552 | +2.8 [−14.2, +20.5], 7-9-1 |
| Last 3 | exact-dp | 119.6 | 124.6 | 207.0 | 7.07 | 9.13 | −0.31 | 1552 | −7.1 [−18.3, +3.4], 4-10-3 |
| 60/40 season + last 3 | exact-dp | 114.4 | 114.6 | 186.3 | 6.71 | 8.69 | −0.61 | 1552 | −12.3 [−21.4, −4.2], 3-11-3 |
| EWMA α=0.35 | exact-dp | 121.2 | 114.9 | 194.0 | 6.80 | 8.82 | −0.50 | 1552 | −5.5 [−14.0, +2.8], 7-9-1 |
| Shrink to position | exact-dp | 125.8 | 129.7 | 154.2 | 6.29 | 8.14 | −0.75 | 1552 | −1.0 [−5.3, +2.8], 7-5-5 |
| Usage × rate | exact-dp | 120.4 | 108.4 | 194.5 | 6.81 | 8.82 | −0.46 | 1552 | −6.4 [−20.4, +6.5], 6-8-3 |
| Opponent-adjusted trail | exact-dp | 129.8 | 128.0 | 138.4 | 7.12 | 9.47 | −4.18 | 1552 | +3.0 [−5.6, +11.6], 8-6-3 |
| Trailing mean, greedy by projection | greedy-proj | 124.1 | 125.9 | 169.3 | 6.63 | 8.62 | −0.81 | 1552 | −2.6 [−11.3, +5.6], 9-8-0 |
| Trailing mean, greedy by value | greedy-value | 85.4 | 79.3 | 151.7 | 6.63 | 8.62 | −0.81 | 1552 | −41.3 [−52.4, −30.4], 0-17-0 |

### Slates, availability and excluded weeks

| Run | Universe (sha256) | Slate size | Off slate: bye / no history / unknown id | Slate statuses | Inactive slots in trailing-mean lineups | Solver records | Excluded weeks |
|---|---|---|---|---|---|---|---|
| 2023 development | synthetic-prior-season@1:2023 (`f462cf7709cb`) | 88–113 | 114 / 56 / 17 | played 1500, inactive 251 | 15 | exact-dp/proven 136, greedy-proj/heuristic 17, greedy-value/heuristic 17 | none |
| 2024 development | synthetic-prior-season@1:2024 (`be9a19bb2ada`) | 91–113 | 113 / 28 / 17 | played 1495, inactive 285 | 21 | exact-dp/proven 136, greedy-proj/heuristic 17, greedy-value/heuristic 17 | none |
| 2025 retrospective | synthetic-prior-season@1:2025 (`f1f1f4bf09c2`) | 89–113 | 112 / 16 / 17 | played 1522, inactive 271 | 13 | exact-dp/proven 136, greedy-proj/heuristic 17, greedy-value/heuristic 17 | none |
| 2025 shipped slate | legacy-fantasy-json (`666a3b3de634`) | 87–114 | 114 / 25 / 0 | played 1552, inactive 247 | 11 | exact-dp/proven 136, greedy-proj/heuristic 17, greedy-value/heuristic 17 | none |

- **Unknown identity.** In the synthetic pools these are prior-season players whose id never appears in the evaluated season's sources. They are labelled and never forecast; the report does not guess why they are missing.
- **Inactive.** Each inactive slot counts 0 in the lineup total. nflverse also omits active players who recorded no stats, so `inactive` cannot separate a scratch from a quiet game.

## Uncertainty method

- **What is resampled.** The paired weekly difference (model lineup actual minus trailing-mean lineup actual, rounded to 0.01). A percentile bootstrap resamples weeks with replacement: 2,000 resamples, mulberry32 seeded with 20260912 and re-seeded per comparison, type-7 quantiles, 95% level.
- **Why the week is the unit.** The nine players in a lineup are not independent tests, so each week counts once.
- **Pooled runs.** The pooled summaries resample (season, week) pairs.
- **What the range is.** A descriptive range, not a significance test. With 17 weeks per season the per-season ranges are wide; this report makes no claim of significance.
- **Recomputing.** Every interval and mean can be recomputed from the stored week records (`verifyRunArtifact`).

## Projection models and the EWMA sweep

### Parameter policy

The `core` preset keeps the parameters from the ce5d6b1 `compare-proj.ts`:

- EWMA α=0.35;
- shrink k=4;
- blend 0.6 of the season mean with the last 3 weeks;
- usage over a 3-week window;
- opponent factor clamped to 0.7–1.3;
- at least one scored game to join a slate;
- a position-prior fallback of 8.

Those values were written while looking at 2025. They were not tuned on 2023–2024: the development runs came first, and nothing was changed after them. 2025 is labelled retrospective, never holdout. A clean test would need a season no one has studied, such as a forward 2026 record.

### What the models show

- **Player MAE.** Shrinkage has the lowest player MAE in every run: 6.02, 5.96, 5.99, pooled 5.99, shipped 6.29. Trailing mean is second in every run. The old README said the trailing mean "still wins player MAE"; that was already contradicted by its own shrink figure and is wrong on the regenerated data.
- **EWMA lineups.** EWMA α=0.35 has the highest lineup mean in each synthetic season. It beats the trailing mean by +13.4, +8.9 and +9.1 a week, and each per-season range just includes zero. The development pool gives +11.1 [+3.0, +19.8] and the full pool +10.5 [+4.2, +16.8]. On the shipped slate it loses (−5.5 [−14.0, +2.8]).
- **Opponent adjustment and usage.** Opponent-adjusted projections run about 3 points low (bias −3.1 pooled), but its lineups are fine: 137.3 pooled, 129.8 on the shipped slate. Usage and opponent adjustment are the only models whose ranges against the trailing mean exclude zero in 2025, and only on the synthetic 2025 pool; EWMA's 2025 range just includes zero.

### EWMA sweep (exploratory)

The sweep was run after 2025 had been studied. It includes the 2025 retrospective season, and its best α is never a preselected setting.

| Model | 2023 | 2024 | 2025 | Pooled 2023–2025 | 2025 shipped slate |
|---|---|---|---|---|---|
| trail | 131.9 | 129.0 | 139.7 | 133.5 | 126.7 |
| ewma-0.05 | 117.9 | 113.3 | 144.7 | 125.3 | 117.0 |
| ewma-0.10 | 130.6 | 126.6 | 146.1 | 134.5 | 112.8 |
| ewma-0.15 | 131.1 | 127.6 | 147.3 | 135.3 | 111.2 |
| ewma-0.20 | 136.6 | 134.9 | 150.3 | 140.6 | 115.1 |
| ewma-0.25 | 139.4 | 138.6 | 149.3 | 142.4 | 118.9 |
| ewma-0.30 | 139.3 | 139.4 | 144.6 | 141.1 | 121.5 |
| ewma-0.35 | 145.4 | 137.8 | 148.9 | 144.0 | 121.2 |
| ewma-0.40 | 145.6 | 137.5 | 148.7 | 143.9 | 119.5 |
| ewma-0.45 | 144.8 | 138.9 | 146.8 | 143.5 | 121.3 |
| ewma-0.50 | 141.8 | 138.4 | 142.9 | 141.0 | 121.7 |
| ewma-0.55 | 139.2 | 134.5 | 138.8 | 137.5 | 123.2 |
| ewma-0.60 | 135.5 | 136.1 | 139.7 | 137.1 | 120.2 |
| ewma-0.65 | 131.6 | 132.5 | 139.5 | 134.5 | 121.1 |
| ewma-0.70 | 132.1 | 137.1 | 138.8 | 136.0 | 122.4 |
| ewma-0.75 | 131.3 | 138.0 | 137.5 | 135.6 | 125.8 |
| ewma-0.80 | 130.7 | 136.8 | 134.6 | 134.0 | 126.3 |
| ewma-0.85 | 128.4 | 135.2 | 137.0 | 133.5 | 126.5 |
| ewma-0.90 | 125.2 | 133.4 | 137.4 | 132.0 | 132.5 |
| ewma-0.95 | 128.0 | 132.8 | 134.7 | 131.8 | 132.4 |
| ewma-1.00 | 130.2 | 130.4 | 133.8 | 131.5 | 129.6 |

- **The best α moves.** It is 0.40 in 2023, 0.30 in 2024 and 0.20 in 2025. The pool peaks at 0.35 with 0.40 and 0.45 within 0.5, and the shipped slate peaks at 0.90.
- **Two pools disagree.** The shipped slate rewards heavy weight on last week; the synthetic pools reward moderate weight.
- **The coincidence at 0.35.** The pooled peak landing on the old default is not independent confirmation, because the grid and the seasons were chosen after the fact.

## QB lag

- **2025 page file.** `src/data/study-qb-lag.json` was regenerated by `build-study.ts`. It holds the same 409 pairs, with identical values and identical `n`, `corrEpa` (0.165) and `corrCpoe` (0.143) as before. Only the order of `pairs` changed: the old script kept first-appearance order from the CSV, and the shared runner sorts by player id, then week. The file is the same length in bytes.
- **Other seasons.** The same computation gives 2023: n = 433, r = 0.141 (EPA per attempt) and 0.109 (CPOE); 2024: n = 425, r = 0.152 and 0.121.
- **Provenance.** Each QB lag artifact records the player-week hash it read, and publish checks it against the season run.

## Narrative corrections

| Old statement (page or README) | Regenerated evidence | Change |
|---|---|---|
| "Exact DP 116.5 … greedy 115.8 … +0.7" | Shipped slate 126.7 vs 124.1 (+2.6 [−5.6, +11.3]); pooled synthetic 133.5 vs 132.2 (+1.4 [−3.4, +6.6]) | Numbers replaced; "barely" still fits |
| "That's a 0.7-point gap — inside the noise" | The bootstrap range includes zero in every run | Replaced by the analysis |
| "It overshot every single week (17 of 17)"; "Every week is under [the line]" | 17 of 17 in every season and on the shipped slate (51 of 51 synthetic) | Kept, now computed from the data at render time |
| "That's packing last week's luck, not a bug in the picker" / "That's the hole — not the picker math" | The picker had a bug (178 of 510 silent fallbacks). The overshoot persists with proven-optimal lineups, and player bias is about 0 | Rewritten: there was a bug; the overshoot is selection |
| "Shrinkage … best player MAE (6.23), worse lineup (112.9) — it flattens stars" | Best MAE in every run. Lineups 136.3 pooled (+2.7 [−1.3, +7.2]); shipped 125.8 (−1.0 [−5.3, +2.8]) | "Worse lineup" and "flattens stars" dropped |
| "Trailing mean still wins player MAE (6.58)" | Shrinkage wins every run; trailing mean is second | Contradiction resolved |
| "EWMA: only model that moved lineup actuals … peak 121.5 at α=0.30" | Old peak partly fallback luck. α=0.35 +10.5 pooled on synthetic pools, −5.5 on the shipped slate; best α varies by season | Rewritten; sweep kept exploratory |
| "Opponent-adjust: 67.8. Thin splits." / "built terrible teams" | Caused by postgame-row opponents; 137.3 pooled, 129.8 shipped | Cause corrected |
| "Exact DP missed a legal roster some weeks (hill-climb fallback)" | True, but those lineups were reported as exact | Now reported as a solver failure, fixed |
| "Estimated DST points-allowed" | Points allowed is the final score | Fixed |
| "2025 holdout" | 2025 had been examined | Relabelled retrospective |

## Limits

- The salaries are synthetic, frozen per season and shaped like the shipped slate's bands. The synthetic pools miss rookies and offseason moves; a player traded mid-season is matched to his latest team before the cutoff.
- History is within-season only, so week 1 never has a slate and early weeks have thin priors.
- Three seasons is 51 weeks. The ranges are wide, and 2025 is retrospective.
- The attribution steps 0–c1 come from an uncommitted replay harness. Step c2 bundles several policy changes; only the opponent effect was isolated.
- The exact DP does not model stacks, and study models never request one.

## Reproduce

```bash
npm ci
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
# attribution and exploration (not published)
npm run study:build -- --seasons 2025 --role retrospective --universe legacy-fantasy-json --models core --scoring legacy-study-dst@ce5d6b1 --out-dir artifacts/study/legacy2025-lscore
npm run study:build -- --seasons 2023-2025 --role retrospective --models ewma-sweep --out-dir artifacts/study/ewma-synth
```

Add `--offline --pin-inputs docs/study/input-manifest.json` to any study or wrapper command to require these exact bytes from the cache.
