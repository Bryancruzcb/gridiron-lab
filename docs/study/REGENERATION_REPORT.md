# Study regeneration report

**Update (2026-09-18 PT):** no-salary artifact regen on `study/no-salary-cap-regen` — `synthetic-prior-season@2`, unit placeholder salaries (not DraftKings prices), `trail-greedy-value` removed. Per-season **projection MAE** tables below are the primary result; computer-vs-greedy / cheap-picks framing is retired from the claim.

Date: 2026-09-12 (Pacific). Branch `wip/study-review-fixes`. Pipeline `gridiron-lab-study-pipeline@2`, solver `gridiron-lab-solveLineup@1` (strict), scoring `gridiron-lab-ppr-dst@1`, opponent model `opp@2`. Runs made on Windows 11 with Node 26.3.0.

This report compares three versions of the study numbers: the first publication at baseline `ce5d6b1`, the previous regeneration at `5a00c2f`, and this revision. It attributes each change to one cause at a time: (a) the solver repair and strict exact metadata, (b) the scoring repair, (c) the slate, week and exclusion policy, (d) the per-season universes and the multi-season extension, and, in this revision, (e) the opponent-model fix and (f) upstream input drift.

## Correction after the final review

The final independent review confirmed four problems in the previous regeneration:

- The opponent-adjusted model compared two different populations.
- The pinned schedule file no longer matched upstream.
- This report said usage and opponent adjustment were the only models whose ranges exclude zero in 2025. On the shipped slate the 60/40 blend's range excludes zero too.
- Several README figures had no committed source.

This revision fixes the model, re-acquires every input through the pipeline, reruns every published command, and measures what the new inputs changed separately from what the fix changed.

### (e) The opponent model compared different populations

`opp@1` scaled the trailing mean by `opponentAllowed(pos, opponent) / positionMean(pos)`, clamped to 0.7–1.3.

- The numerator averaged every source row at the position against that opponent, backups included.
- The denominator averaged only the universe pool's players, the top 18 QB, 28 RB, 36 WR and 16 TE by prior-season points per game.
- For skill positions the pool mean is far above the all-rows mean, so the factor sat well below 1 whatever the opponent, and most skill players were clamped at 0.7.
- The model mostly multiplied the trailing mean by 0.7 for RB, WR and TE, then reweighted QBs and defenses against them.

The same mismatch was in the ce5d6b1 `compare-proj.ts`.

`opp@2` divides by `leagueAllowed(pos)`: the mean of the same pre-cutoff rows against every opponent (defense rows for DST). The row-weighted mean factor across opponents is therefore exactly 1. The pool's position mean is still the shrink model's prior. Model specs now carry a versioned `definition` (`opp@2`, the others `@1`), and the pipeline ref moved to `@2`. Every run id, the models hash (`core` is now `f1de4cbcce62b064d63ba950065d6bc6bcd78147313e8887bf617141421508a3`) and the page file changed, so no old and new run can be pooled or published together.

The factor on real data, for the slate players of weeks 6, 10 and 14 on each season's synthetic pool (a one-time diagnostic that rebuilds each week's features with the pipeline modules and computes both definitions):

| Season | Position | Slate player-weeks | opp@1 median factor | opp@1 at 0.7 / at 1.3 | opp@2 median factor | opp@2 at 0.7 / at 1.3 |
|---|---|---|---|---|---|---|
| 2023 | QB | 43 | 0.71 | 20 / 0 | 0.97 | 2 / 9 |
| 2023 | RB | 76 | 0.66 | 44 / 0 | 1.01 | 3 / 4 |
| 2023 | WR | 99 | 0.51 | 99 / 0 | 0.99 | 6 / 1 |
| 2023 | TE | 43 | 0.51 | 39 / 0 | 1.00 | 8 / 4 |
| 2023 | DST | 44 | 0.84 | 11 / 10 | 0.95 | 8 / 12 |
| 2024 | QB | 46 | 0.78 | 12 / 1 | 0.97 | 3 / 4 |
| 2024 | RB | 68 | 0.51 | 67 / 0 | 1.02 | 0 / 6 |
| 2024 | WR | 92 | 0.55 | 86 / 0 | 1.01 | 3 / 5 |
| 2024 | TE | 39 | 0.49 | 38 / 0 | 0.96 | 8 / 3 |
| 2024 | DST | 40 | 0.89 | 6 / 6 | 0.92 | 6 / 7 |
| 2025 | QB | 50 | 0.80 | 13 / 1 | 0.99 | 1 / 6 |
| 2025 | RB | 73 | 0.52 | 72 / 0 | 1.01 | 2 / 2 |
| 2025 | WR | 96 | 0.52 | 96 / 0 | 0.99 | 0 / 3 |
| 2025 | TE | 45 | 0.55 | 40 / 0 | 1.00 | 4 / 3 |
| 2025 | DST | 44 | 0.88 | 16 / 8 | 0.96 | 14 / 12 |

Tests in `tests/domain/study-projections.test.ts` check that the factor centres on 1 across opponents at every position with a starters-only pool, and that opp projections are identical for a starters-only and a full pool. Both fail when the denominator is put back to the pool's position mean. The future-row perturbation test still covers `opp`.

### (f) Input drift

The committed manifest pinned nfldata `games.csv` at `63beda7e…`, which is the file at nfldata commit `82140d24` (2026-09-12 22:05 UTC). nfldata updates that file every few minutes during the season. The pipeline fetched it again at 2026-09-13 04:58 UTC and got `613dbce5…`.

- **Stats files.** All eight nflverse stats files hashed exactly as pinned (upstream Last-Modified still 2026-08-13).
- **What changed in `games.csv`.** 272 rows of 2026 changed. In earlier seasons only the `ftn` column changed, in 53 rows: 2024 weeks 16–22 and 2025 weeks 20–22. The study reads `game_id`, `season`, `game_type`, `week` and the team and score columns, never `ftn`.

To measure drift on its own, every command below was rerun with the `5a00c2f` code (a `git archive` of that commit under `artifacts/base`) on the refreshed inputs, then compared with the files committed at `5a00c2f`:

- `study-seasons.json`: every summary, weekly total, QB lag and universe field is identical once run ids, result hashes and input hashes are masked.
- `study-backtest.json`: identical apart from the run id in its notes. `study-projections.json` and `study-ewma.json`: identical apart from run ids and line endings. `study-qb-lag.json`: byte-identical.
- The unpublished runs match the previous revision of this report: the attribution-only run (trailing mean 122.1, shrink 123.6, opp@1 127.5) and the EWMA sweep table row for row.

**Input drift changed no number.** It changed the schedule hash, every run id, and the three synthetic universe hashes, because each universe records the schedule it was built with.

### Before and after

Every number here comes from the regenerated records. "Before" is the `5a00c2f` publication, which the drift rerun reproduced exactly. Across all six published rows and the three unpublished run groups, the opponent-adjusted model is the only one whose numbers moved. Every other model's lineups, projections, errors and ranges are unchanged, because no other method reads the opponent factor. Week by week across the 11 runs, the drift rerun and this revision have identical slates, and 2,363 of 2,363 non-opp model-weeks have identical projections, solver records and lineups; all 102 opp model-weeks changed.

| Run | Lineup mean | Median | Projected | MAE | RMSE | Bias | Opp − trail: mean [95%], W-L-T |
|---|---|---|---|---|---|---|---|
| 2023 development | 137.8 → 138.2 | 127.7 → 139.5 | 144.3 → 198.2 | 6.42 → 6.34 | 8.56 → 8.27 | −3.12 → −0.18 | +5.9 [−7.1, +19.4], 9-8-0 → +6.2 [−10.2, +22.1], 11-6-0 |
| 2024 development | 126.5 → 133.2 | 126.0 → 133.8 | 140.3 → 197.9 | 6.47 → 6.41 | 8.67 → 8.38 | −3.31 → −0.19 | −2.4 [−8.8, +5.1], 5-8-4 → +4.3 [−8.9, +18.6], 9-8-0 |
| 2025 retrospective | 147.4 → 143.4 | 154.5 → 144.6 | 144.4 → 197.5 | 6.27 → 6.32 | 8.57 → 8.28 | −2.98 → +0.04 | +7.6 [+0.5, +15.4], 11-5-1 → +3.7 [−10.6, +19.3], 8-9-0 |
| pooled 2023+2024 | 132.2 → 135.7 | 126.5 → 136.7 | 142.3 → 198.0 | 6.45 → 6.38 | 8.61 → 8.32 | −3.21 → −0.18 | +1.7 [−5.4, +9.6], 14-16-4 → +5.3 [−5.0, +15.4], 20-14-0 |
| pooled 2023+2024+2025 | 137.3 → 138.3 | 133.8 → 142.0 | 143.0 → 197.9 | 6.39 → 6.36 | 8.60 → 8.31 | −3.13 → −0.11 | +3.7 [−2.0, +9.4], 25-21-5 → +4.7 [−3.8, +14.1], 28-23-0 |
| 2025 shipped slate | 129.8 → 122.7 | 128.0 → 121.8 | 138.4 → 195.8 | 7.12 → 6.86 | 9.47 → 8.90 | −4.18 → −0.87 | +3.0 [−5.6, +11.6], 8-6-3 → −4.1 [−16.8, +8.7], 8-9-0 |

- **The attribution-only run** (shipped slate, legacy DST scoring): opp 127.5 → 125.2, MAE 7.07 → 6.80.
- **Shipped-slate page file** `study-projections.json`: opp 129.8 → 122.7, MAE 7.12 → 6.86.
- **What the fix changes in the reading:**
  - The opponent model's bias of about −3 points was the population mismatch, not a property of opponent adjustment.
  - Every opp range against the trailing mean now includes zero.
  - In 2025 the range no longer excludes zero (+7.6 [+0.5, +15.4] became +3.7 [−10.6, +19.3]), so the previous claim that opponent adjustment beat the trailing mean in 2025 does not hold.
  - On the shipped slate opponent adjustment no longer builds the best lineups: last week does (129.6).

### New run ids

| Purpose | Previous run id | Run id (this revision) | resultSha256 |
|---|---|---|---|
| 2023 development | `run-ccd95ce80683a5be` | `run-85628408012ca98e` | `a9b7aed986ed…` |
| 2024 development | `run-9bb334f25c8c50d0` | `run-9e1e548b6e174b76` | `69d273903fb7…` |
| 2025 retrospective | `run-2a18ed7b1af9319f` | `run-00f774f034aafef8` | `4cccb2e9ab67…` |
| 2025 shipped slate | `run-541d16551040108e` | `run-51125c0f6f553bcb` | `7c79dfca98f8…` |
| Attribution only | `run-cc4cbf7589429295` | `run-02e64b5b3842f6cb` | `e579ae5e45d7…` |
| EWMA sweeps 2023, 2024, 2025 | `run-43a5f8c5df66e2a8`, `run-49caec44e4d49f8e`, `run-3579951cea06d2d3` | `run-8a32276580494753`, `run-d92c8133cce6a922`, `run-01bbdb13651514c8` | `a3eea9eb1f48…`, `0ac516e443b3…`, `f8e06db22264…` |
| `study-backtest.json` | `run-4c477eee00e6c321` | `run-a20bb9ad7b8609a0` | `d9c847e7b1aa…` |
| `study-projections.json` | `run-591884ce0be673d4` | `run-d715b1d9ebdf67c2` | `10aa27f50060…` |
| `study-ewma.json` | `run-7e9f57ae6af17c33` | `run-7be77f04d6df2e60` | `57462788810f…` |
| `study-seasons.json` | file `3483f5176058…` | file `e932d030c2fe…` | pools `61c897405c53…` (2023+2024), `71179fb604fa…` (all) |
| `study-facts.json` (new) | – | file `884fbd8bb391…` | – |

The drift rerun's own ids (old code, new inputs) were `run-9f27d7cde29c130d`, `run-79391cc07b3817d4`, `run-11b100e1615cd882` and `run-2b47fd03540c9158` for the four published runs. Old code on new bytes and new code on new bytes never share an id.

### README and tests

- **Wording.** The README called the points-per-dollar greedy baseline "stars and scrubs". That baseline leaves cap unspent, which is the opposite build. It now uses the study page's term, cheap points-per-dollar picks.
- **What the docs test checks.** `tests/domain/docs-agreement.test.ts` recomputes every number in the README's Result and What failed sections from `src/data/study-seasons.json`, `src/data/study-ewma.json`, `src/data/fantasy.json` and the new `docs/study/study-facts.json`. A final check fails on any number in those sections that no assertion read; code spans and one listed phrase about the live labs are exempt. Changing any one of the README's 185 study numbers makes the test fail. The same test renders this report's projection-first MAE-by-run, models-by-run, slates and EWMA sweep tables and its list of ranges that exclude zero from those files, and requires them verbatim.
- **The facts file.** `study-facts.json` is written by `npm run study:build -- facts` from the published runs, their universe files and the synthetic EWMA sweeps. It holds the per-season best α, inactive lineup slots, the overlap of the shipped slate with the clean 2025 pool, and the slate and solver counts in the tables below. It refuses edited or attribution-only runs and universe files that do not hash to the run's universe.
- **Replay-only counts.** Numbers that exist only in a one-time replay of the old scripts are no longer in the README. They stay in this report: 178 of 510 empty exact solves, the old DST estimate missing the final score in 487 of 544 2025 team-games, the first publication's 116.5 / 115.8 / 80.1 and EWMA peak 121.5 at α=0.30, and the old opponent-adjust 67.8.
- **Legacy wrappers.** `build-study.ts`, `compare-proj.ts` and `compare-ewma.ts` used to write attribution-only numbers into `src/data` with only a log warning. They now refuse `--scoring legacy-study-dst@ce5d6b1` unless `--legacy-out` points outside `src/data`, and the page-file adapters refuse attribution-only runs unless the caller opts in. A file written that way leads with an attribution-only note.

### Reproducibility of this revision

- **Pinned offline rerun.** After the results commit (`1d57efb`), every command in [Reproduce](#reproduce), the attribution-only run included, was rerun with `--offline --pin-inputs docs/study/input-manifest.json` into `artifacts/rerun`. The wrappers wrote with `--legacy-out` there, and publish merged into a copy of the previous manifest, as the committed publish had. All 33 files were byte-identical to the committed regeneration, with every run id the same:
  - the 26 run, multi-season, universe and QB lag artifacts;
  - `src/data/study-seasons.json`, `study-backtest.json`, `study-projections.json`, `study-ewma.json` and `study-qb-lag.json`;
  - `docs/study/input-manifest.json` and `docs/study/study-facts.json`.
- **Rerun times** (from the rerun meta files): 2023 6,881 ms, 2024 7,935 ms, 2025 6,761 ms, shipped slate 6,519 ms, attribution only 5,647 ms, sweeps 11,534, 11,016 and 11,230 ms, `build-study.ts` 1,805 ms, `compare-proj.ts` 7,012 ms, `compare-ewma.ts` 14,942 ms.
- **Old code on new bytes.** Section (f): the `5a00c2f` code on the refreshed inputs reproduced every number of the previous revision.
- **Bite checks.** Each change below was made in a throwaway copy, and the named tests failed:
  - `opp` back to dividing by the pool's position mean: four opponent-factor tests.
  - The wrapper output check removed: the wrapper end-to-end refusal test.
  - The adapters' attribution-only guard removed: the adapter test.
  - Every number in the README's Result and What failed sections changed one at a time: 185 of 185 caught.
  - Six edits to this report's checked tables and list, including restoring the old claim that opponent adjustment excluded zero in 2025: all caught.

## Summary

- **Old headline** (2025, the shipped 114-player slate): exact DP 116.5, greedy by projection 115.8, points-per-dollar greedy 80.1. The exact lineup beat greedy in 7 of 17 weeks.
- **The same slate, regenerated**: 126.7, 124.1 and 85.4, with the exact lineup ahead in 8 of 17 weeks. The +2.6 weekly gap has a 95% week-bootstrap range of −5.6 to +11.3.
- **Clean per-season pools** (2023–2025 pooled, 51 weeks): 133.5, 132.2 and 112.0. The gap is +1.4, range −3.4 to +6.6.
- **Still true**: the solver is clearly better than points-per-dollar greedy and not clearly better than projection greedy. Its pregame projection was higher than its actual score in every week of every run.
- **No longer true**:
  - The picker had no bug. It had one, although the overshoot does not come from it.
  - Trailing mean wins player MAE. Shrinkage wins it in every run.
  - Opponent adjustment builds terrible teams. That came from a postgame-row lookup and a factor that compared different populations. Corrected, it is within the noise of the trailing mean in every run.
  - EWMA peaks at α=0.30 on 2025. The peak moves once the solver is fixed, and it moves again from season to season.
- **Unchanged**: the QB lag file has the same 409 pairs with the same values and correlations; only the pair order differs from the first publication.

## Inputs

Every input was fetched by the pipeline's acquisition step into `.study-cache/` (gitignored). The committed manifest is [`input-manifest.json`](input-manifest.json). It keeps the first recorded retrieval of identical bytes, so the stats files show the retrieval of the previous regeneration.

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
| `nfldata_games` (`games.csv`) | `613dbce57073af64…` | 2,179,657 | none (etag only) | 2026-09-13T04:58:22Z |
| `fantasy.json` (repo file, LF-normalized) | `7f401dfb3e230b7b…` | 34,840 | – | read at run time |

Notes on the inputs:

- The 2025 stats hashes match the bytes the wave 1 scoring checks used.
- `games.csv` is a single mutable file. Wave 1 recorded `e5443356…`, the previous regeneration `63beda7e…`, and this revision `613dbce5…`. Every run pins the hash it read. Section (f) shows the last change touched no column the study reads.
- The 2022 files exist only because the 2023 universe is built from 2022.
- Each season's player-week file has 22 rows that the shared parser skips (missing id, team, season or week). The run meta files record this as a warning.

## Runs

The drift rerun fetched every input into an empty cache at 2026-09-13 04:58 UTC. Every run of this revision then read those bytes with `--offline`, on commit `febce1b` with the facts builder not yet committed. Elapsed times come from each run's `.meta.json`.

| Purpose | Command (all `npm run study:build --` unless noted) | Run id | resultSha256 | Elapsed |
|---|---|---|---|---|
| 2023 development | `--seasons 2023,2024 --role development --models core --qb-lag` | `run-85628408012ca98e` | `a9b7aed986ed…` | 6,943 ms |
| 2024 development | (same command) | `run-9e1e548b6e174b76` | `69d273903fb7…` | 6,797 ms |
| 2025 retrospective | `--seasons 2025 --role retrospective --models core --qb-lag` | `run-00f774f034aafef8` | `4cccb2e9ab67…` | 7,497 ms |
| 2025 shipped slate | `--seasons 2025 --role retrospective --universe legacy-fantasy-json --models core` | `run-51125c0f6f553bcb` | `7c79dfca98f8…` | 6,298 ms |
| Attribution only, never published | same plus `--scoring legacy-study-dst@ce5d6b1` | `run-02e64b5b3842f6cb` | `e579ae5e45d7…` | 6,049 ms |
| EWMA sweep, exploratory | `--seasons 2023-2025 --role retrospective --models ewma-sweep` | `run-8a32276580494753`, `run-d92c8133cce6a922`, `run-01bbdb13651514c8` | `a3eea9eb1f48…`, `0ac516e443b3…`, `f8e06db22264…` | 14,031, 13,774, 17,271 ms |
| `study-backtest.json`, `study-qb-lag.json` | `node --experimental-strip-types scripts/build-study.ts` | `run-a20bb9ad7b8609a0` | `d9c847e7b1aa…` | 2,363 ms |
| `study-projections.json` | `node --experimental-strip-types scripts/compare-proj.ts` | `run-d715b1d9ebdf67c2` | `10aa27f50060…` | 6,544 ms |
| `study-ewma.json` | `node --experimental-strip-types scripts/compare-ewma.ts` | `run-7be77f04d6df2e60` | `57462788810f…` | 12,714 ms |
| `study-seasons.json`, manifest | `publish --runs … --shipped-slate … --qb-lag … --out src/data/study-seasons.json --manifest docs/study/input-manifest.json` | file `e932d030c2fe…` | pools `61c897405c53…` (2023+2024), `71179fb604fa…` (all) | – |
| `study-facts.json` | `facts --runs … --shipped-slate … --sweeps … --out docs/study/study-facts.json` | file `884fbd8bb391…` | – | – |

The locked model configuration is the `core` preset, `modelsSha256` `f1de4cbcce62b064d63ba950065d6bc6bcd78147313e8887bf617141421508a3`. The universes are `synthetic-prior-season@1:2023` `efb986f3f509…`, `:2024` `4ee04f01f8fd…`, `:2025` `90ff6c40780b…`, and the shipped slate `666a3b3de634…`. The synthetic universe hashes changed only because each records the schedule hash it was built with; their players and salaries are unchanged.

## Reproducibility

- **Offline repeat.** In the previous regeneration the 2025 run was repeated offline into a second directory; the run, universe and QB lag files were byte-identical.
- **Pinned rerun of everything.** See [Reproducibility of this revision](#reproducibility-of-this-revision).
- **Manifest.** Publishing keeps the first recorded retrieval of identical bytes, so a republish from rerun meta files reproduces the committed manifest. A test covers this.
- **Changed source bytes.** A source-byte change produces a different run id. The pin test in `tests/domain/study-cli.test.ts` covers this, and this revision's drift rerun is a real example: same code, new schedule bytes, new ids, identical numbers. The publish and facts steps re-verify each run's id, result hash and summary against its week records, and refuse edited files.

## Where the shipped 114-player slate came from

`src/data/fantasy.json` arrived in the initial commit `23f0d54`. No generator script is in the history. `src/lib/metrics.ts` describes its projection as "60% season PPG plus 40% weeks 14–18". An audit against the cached 2025 bytes found the following (the 2025 stats bytes are unchanged in this revision, so the audit still holds):

- **Season stats.** For all 98 offensive players, `games`, `ppg` and season `ppr` equal the full 2025 regular season in nflverse `fantasy_points_ppr`.
- **Late-season PPG.** `recencyPpg` equals weeks 14–18 PPG for 95 of 98. The three exceptions each played one late game.
- **Projection.** `proj = 0.6 × ppg + 0.4 × recencyPpg` holds for 114 of 114 (the docs test rechecks it on every run).
- **Salaries.** Within each position, salary is linear in `proj`: R² 0.996–0.998, Spearman 0.986–0.994. The bands are QB $5,000–8,200, RB $4,000–9,000, WR $3,500–9,200, TE $2,500–6,800 and DST $2,000–3,200.
- **Selection.** Each pool is essentially the top N by that projection among players with a minimum number of games (4 for QB and WR, 8 for RB and TE):
  - RB 28 of 28 and WR 36 of 36 match exactly;
  - QB 16 of 18 (Mitchell Trubisky and Patrick Mahomes rank higher but are absent);
  - TE 15 of 16.
- **Defenses.** DST `ppg` does not match the old study scripts' formula (1 of 16), so defense projections came from yet another scoring path.

The pool and every salary therefore use information from after every 2025 prediction cutoff, including weeks 14–18. The pipeline labels this universe `lookAhead: true`, and the page and README call it the shipped slate, a comparison and never a clean historical slate. Only 66 of its 114 players are in the synthetic 2025 pool built from 2024 (QB 8, RB 17, WR 23, TE 8, DST 10; `study-facts.json`).

## Before and after on the shipped 2025 slate

The table applies one change at a time, in the order shown. Attribution depends on that order.

- **Steps 0 to c1** come from a one-time replay harness kept in the gitignored `artifacts/` directory, not committed, run in the previous regeneration on the schedule bytes pinned then (`63beda7e…`). It runs the ce5d6b1 `build-study.ts`, `compare-proj.ts` and `compare-ewma.ts` logic line for line against the cached 2025 bytes. Its only switches are the solver (the ce5d6b1 `exactLineup ?? hillClimbLineup` and `greedyLineup`, or the repaired `solveLineup`) and, for c1, dropping pool players whose team has no team-week row that week. Its opponent adjustment is the ce5d6b1 one, with postgame opponents and the population mismatch.
- **Steps c2 to d** are the committed pipeline runs listed above, with `opp@2`.
- **To rebuild the harness**, take `git show ce5d6b1:` of the three scripts and `src/lib/optimizer.ts`, read the snapshot files named in the manifest instead of fetching, and swap the solver calls. Section (f) shows the schedule change since then touches no column those scripts read.

| Step | Computer mean | Median | Top names | Cheap picks | Computer beat top names | Trail MAE | Shrink MAE | EWMA 0.35 lineup | Shrink lineup | Opp-adjust lineup | Sweep best α |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Published (ce5d6b1 files) | 116.5 | 119.6 | 115.8 | 80.1 | 7 of 17 | 6.58 | 6.23 | 118.9 | 112.9 | 67.8 | 0.30 (121.5) |
| 0. Replay of ce5d6b1 scripts on the cached bytes | 116.5 | 119.6 | 115.8 | 80.1 | 7 of 17 | 6.58 | 6.23 | 118.9 | 112.9 | 67.8 | 0.30 (121.5) |
| a. + repaired solver (strict `solveLineup`) | 114.1 | 117.1 | 115.8 | 80.1 | 8 of 17 | 6.58 | 6.23 | 113.6 | 113.6 | 62.3 | 0.90 (120.1) |
| c1. + players on a bye removed from the slate | 122.1 | 123.4 | 123.2 | 83.8 | 8 of 17 | 6.58 | 6.23 | 120.8 | 122.1 | 79.8 | 0.90 (131.6) |
| c2. + rest of the pipeline policy, legacy DST scoring | 122.1 | 123.4 | 123.2 | 83.8 | 8 of 17 | 6.58 | 6.23 | 120.8 | 123.6 | 125.2 | not run |
| b. + scoring repair (`gridiron-lab-ppr-dst@1`) | 126.7 | 135.9 | 124.1 | 85.4 | 8 of 17 | 6.63 | 6.29 | 121.2 | 125.8 | 122.7 | 0.90 (132.5) |
| d. per-season universe instead (2025 only) | 139.7 | 142.7 | 139.7 | 120.7 | 4 of 17 | 6.17 | 5.99 | 148.9 | 140.8 | 143.4 | 0.20 (150.3) |

Step 0 reproduces every published number exactly, so the upstream 2025 files did not drift in any way that matters here. The opp-adjust values for c2, b and d were 127.5, 129.8 and 147.4 with `opp@1`.

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
- **Size of the change.** Measured once with the pipeline's two scoring paths (`prepareSeason` with `legacy-study-dst@ce5d6b1` and with `gridiron-lab-ppr-dst@1`) on the bytes pinned in the previous regeneration. This revision's stats bytes are identical and the schedule change touches no score column, so the table stands:

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
  - Opponent adjustment: with `opp@1` this step alone moved it from 79.8 to 127.5. The old script read week w's opponent from the player's week-w stat row. A player with no row (inactive, and before c1 also on bye) got an adjustment factor of 1, while everyone else was scaled by the clamped factor, usually 0.7, so non-playing players looked relatively better. At step 0 the opponent-adjusted lineups held 78 offensive players with no week-w row over 17 weeks (27 of them on bye), and still 70 at c1, against 17 and 12 for the trailing mean. With opponents taken from the schedule, that bias is gone. `opp@2` then compares the same populations and gives 125.2.
- **Common weeks and exclusions.** In every regenerated run every solve succeeded and every lineup actual was complete, so no week was excluded and all 17 weeks per season are the common set. The exclusion policy is in place but changed nothing on these seasons.
- **Zero fill.** The old scripts counted a missing actual as 0. The pipeline counts only `inactive` (final game, source covers the week, no row) as 0 and would exclude the week for `not-final`, `missing-source` or `unknown-identity`. In 2023–2025 only `played` and `inactive` occur on the slates, so lineup totals match the old zero fill.
- **MAE.** The denominator is still played slate player-weeks (n = 1,552 on the shipped slate, as before). With 17 or 51 weeks, the median rule (average of the two middle values instead of the lower one) changes nothing.

### (d) Per-season universes and multi-season extension

- **The universe rule.** `synthetic-prior-season@1` builds each season's pool (QB 18, RB 28, WR 36, TE 16, DST 16) from the prior regular season only. It takes the top players by points per game with at least 4 scored games and prices them linearly within the shipped slate's per-position bands, rounded to $100. The universe is frozen and hashed before week 1.
- **Levels are not comparable across universes.** The pools share 66 of 114 players and the prices differ, so a computer mean of 139.7 on the synthetic 2025 pool against 126.7 on the shipped slate says nothing on its own. Comparisons inside a run are paired week by week.
- **What differs between pools.** The exact-vs-greedy gap is +2.6 on the shipped slate and 0.0 on the synthetic 2025 pool. EWMA α=0.35 gains +9.1 on the synthetic pool and loses 5.5 on the shipped slate.

## Per-season results

### Projection quality: player MAE by run (primary)

After the no-salary regen (`synthetic-prior-season@2`, unit placeholder salaries, `trail-greedy-value` removed), the **primary** result table is projection error — not exact-vs-greedy under a salary cap. MAE is mean |projected − actual| on played slate player-weeks. Shrinkage is best in every run; trailing mean is second. Lineup means remain in the models tables below for archaeology; they are not the resume claim.

| Run | Weeks | Player-weeks | Shrink MAE | Trail MAE | Best method | Opp MAE |
|---|---|---|---|---|---|---|
| 2023 development | 17 | 1,500 | 6.02 | 6.24 | Shrink to position (6.02) | 6.34 |
| 2024 development | 17 | 1,495 | 5.96 | 6.18 | Shrink to position (5.96) | 6.41 |
| 2025 retrospective | 17 | 1,522 | 5.99 | 6.17 | Shrink to position (5.99) | 6.32 |
| pooled 2023+2024 | 34 | 2,995 | 5.99 | 6.21 | Shrink to position (5.99) | 6.38 |
| pooled 2023+2024+2025 | 51 | 4,517 | 5.99 | 6.19 | Shrink to position (5.99) | 6.36 |
| 2025 shipped slate | 17 | 1,552 | 6.29 | 6.63 | Shrink to position (6.29) | 6.86 |

Player-level bias of the trailing mean is −0.02 points pooled (n = 4,517). With unit placeholder salaries the trailing-mean exact DP and greedy-by-projection lineups often match on synthetic pools; that is not a DFS edge claim.

### Models by run

MAE, RMSE and bias are per played slate player-week over the common weeks; bias is projection minus actual. The last column compares each model's weekly lineup with the trailing mean's. `trail-greedy-value` is gone from the preset.

#### 2023 development (`run-7d10819f40b21866`)

| Model | Solver | Lineup mean | Median | Projected | MAE | RMSE | Bias | n | Model − trail: mean [95%], W-L-T |
|---|---|---|---|---|---|---|---|---|---|
| Trailing mean | exact-dp | 137.1 | 137.5 | 198.4 | 6.24 | 8.17 | −0.05 | 1500 | baseline |
| Last week | exact-dp | 133.9 | 129.6 | 258.7 | 7.76 | 10.12 | −0.03 | 1500 | −3.2 [−17.2, +11.1], 6-10-1 |
| Last 3 | exact-dp | 145.6 | 137.5 | 216.0 | 6.53 | 8.57 | −0.10 | 1500 | +8.5 [−1.5, +19.5], 8-6-3 |
| 60/40 season + last 3 | exact-dp | 142.0 | 137.5 | 200.3 | 6.26 | 8.20 | −0.07 | 1500 | +4.9 [−3.0, +13.6], 7-5-5 |
| EWMA α=0.35 | exact-dp | 142.4 | 140.2 | 206.7 | 6.31 | 8.32 | −0.14 | 1500 | +5.3 [−2.5, +13.6], 10-5-2 |
| Shrink to position | exact-dp | 146.7 | 141.8 | 162.8 | 6.02 | 7.73 | −0.04 | 1500 | +9.6 [+2.2, +18.0], 8-2-7 |
| Usage × rate | exact-dp | 135.4 | 131.6 | 205.8 | 6.40 | 8.39 | +0.04 | 1500 | −1.8 [−10.5, +7.4], 5-8-4 |
| Opponent-adjusted trail | exact-dp | 146.2 | 145.5 | 204.8 | 6.34 | 8.27 | −0.18 | 1500 | +9.1 [−2.2, +21.5], 7-10-0 |
| Trailing mean, greedy by projection | greedy-proj | 137.1 | 137.5 | 198.4 | 6.24 | 8.17 | −0.05 | 1500 | 0.0 [0.0, 0.0], 0-0-17 |

#### 2024 development (`run-715052c7ebb0f090`)

| Model | Solver | Lineup mean | Median | Projected | MAE | RMSE | Bias | n | Model − trail: mean [95%], W-L-T |
|---|---|---|---|---|---|---|---|---|---|
| Trailing mean | exact-dp | 127.9 | 130.2 | 186.4 | 6.18 | 8.04 | −0.12 | 1495 | baseline |
| Last week | exact-dp | 134.0 | 135.1 | 249.1 | 7.81 | 10.04 | +0.12 | 1495 | +6.1 [−1.6, +14.3], 8-8-1 |
| Last 3 | exact-dp | 135.6 | 134.4 | 207.6 | 6.44 | 8.37 | +0.07 | 1495 | +7.7 [−1.0, +17.1], 8-6-3 |
| 60/40 season + last 3 | exact-dp | 131.2 | 135.3 | 190.8 | 6.18 | 8.04 | −0.04 | 1495 | +3.3 [−3.1, +10.6], 8-5-4 |
| EWMA α=0.35 | exact-dp | 138.0 | 138.0 | 198.4 | 6.26 | 8.16 | −0.01 | 1495 | +10.1 [+0.5, +20.2], 11-4-2 |
| Shrink to position | exact-dp | 131.9 | 129.0 | 157.2 | 5.96 | 7.64 | −0.12 | 1495 | +4.0 [−2.8, +11.3], 6-8-3 |
| Usage × rate | exact-dp | 139.1 | 141.7 | 208.0 | 6.35 | 8.18 | +0.21 | 1495 | +11.1 [−1.4, +25.4], 10-5-2 |
| Opponent-adjusted trail | exact-dp | 132.6 | 133.8 | 198.1 | 6.41 | 8.38 | −0.19 | 1495 | +4.7 [−9.2, +19.4], 9-8-0 |
| Trailing mean, greedy by projection | greedy-proj | 127.9 | 130.2 | 186.4 | 6.18 | 8.04 | −0.12 | 1495 | 0.0 [0.0, 0.0], 0-0-17 |

#### 2025 retrospective (`run-6c94c248f660227d`)

| Model | Solver | Lineup mean | Median | Projected | MAE | RMSE | Bias | n | Model − trail: mean [95%], W-L-T |
|---|---|---|---|---|---|---|---|---|---|
| Trailing mean | exact-dp | 154.5 | 156.6 | 191.0 | 6.17 | 8.08 | +0.11 | 1522 | baseline |
| Last week | exact-dp | 137.4 | 125.6 | 258.3 | 7.78 | 10.42 | +0.14 | 1522 | −17.2 [−31.0, −3.6], 4-12-1 |
| Last 3 | exact-dp | 143.0 | 146.6 | 210.2 | 6.57 | 8.62 | +0.12 | 1522 | −11.5 [−23.2, −0.1], 4-10-3 |
| 60/40 season + last 3 | exact-dp | 156.8 | 160.0 | 196.4 | 6.24 | 8.17 | +0.12 | 1522 | +2.2 [−5.8, +10.1], 6-6-5 |
| EWMA α=0.35 | exact-dp | 155.5 | 156.3 | 200.9 | 6.31 | 8.30 | +0.04 | 1522 | +0.9 [−11.4, +11.9], 9-7-1 |
| Shrink to position | exact-dp | 152.3 | 155.4 | 160.5 | 5.99 | 7.74 | +0.09 | 1522 | −2.2 [−7.6, +2.4], 4-4-9 |
| Usage × rate | exact-dp | 149.0 | 142.7 | 201.3 | 6.38 | 8.36 | +0.29 | 1522 | −5.6 [−17.4, +5.7], 6-9-2 |
| Opponent-adjusted trail | exact-dp | 150.8 | 144.3 | 200.3 | 6.32 | 8.28 | +0.04 | 1522 | −3.8 [−18.7, +14.1], 7-10-0 |
| Trailing mean, greedy by projection | greedy-proj | 154.5 | 156.6 | 191.0 | 6.17 | 8.08 | +0.11 | 1522 | 0.0 [0.0, 0.0], 0-0-17 |

#### pooled 2023+2024 (`cf0245970965…`)

| Model | Solver | Lineup mean | Median | Projected | MAE | RMSE | Bias | n | Model − trail: mean [95%], W-L-T |
|---|---|---|---|---|---|---|---|---|---|
| Trailing mean | exact-dp | 132.5 | 132.4 | 192.4 | 6.21 | 8.11 | −0.08 | 2995 | baseline |
| Last week | exact-dp | 134.0 | 135.1 | 253.9 | 7.78 | 10.08 | +0.05 | 2995 | +1.5 [−6.4, +9.0], 14-18-2 |
| Last 3 | exact-dp | 140.6 | 134.5 | 211.8 | 6.48 | 8.47 | −0.01 | 2995 | +8.1 [+1.1, +15.2], 16-12-6 |
| 60/40 season + last 3 | exact-dp | 136.6 | 137.0 | 195.6 | 6.22 | 8.13 | −0.06 | 2995 | +4.1 [−1.3, +9.7], 15-10-9 |
| EWMA α=0.35 | exact-dp | 140.2 | 139.6 | 202.6 | 6.29 | 8.24 | −0.08 | 2995 | +7.7 [+1.3, +13.7], 21-9-4 |
| Shrink to position | exact-dp | 139.3 | 133.8 | 160.0 | 5.99 | 7.69 | −0.08 | 2995 | +6.8 [+1.6, +12.5], 14-10-10 |
| Usage × rate | exact-dp | 137.2 | 136.2 | 206.9 | 6.37 | 8.29 | +0.12 | 2995 | +4.7 [−3.1, +13.2], 15-13-6 |
| Opponent-adjusted trail | exact-dp | 139.4 | 138.7 | 201.4 | 6.38 | 8.32 | −0.18 | 2995 | +6.9 [−1.8, +16.5], 16-18-0 |
| Trailing mean, greedy by projection | greedy-proj | 132.5 | 132.4 | 192.4 | 6.21 | 8.11 | −0.08 | 2995 | 0.0 [0.0, 0.0], 0-0-34 |

#### pooled 2023+2024+2025 (`cabea9fac08e…`)

| Model | Solver | Lineup mean | Median | Projected | MAE | RMSE | Bias | n | Model − trail: mean [95%], W-L-T |
|---|---|---|---|---|---|---|---|---|---|
| Trailing mean | exact-dp | 139.9 | 141.7 | 191.9 | 6.19 | 8.10 | −0.02 | 4517 | baseline |
| Last week | exact-dp | 135.1 | 131.1 | 255.4 | 7.78 | 10.20 | +0.08 | 4517 | −4.7 [−12.1, +2.8], 18-30-3 |
| Last 3 | exact-dp | 141.4 | 137.5 | 211.3 | 6.51 | 8.52 | +0.03 | 4517 | +1.6 [−5.1, +8.3], 20-22-9 |
| 60/40 season + last 3 | exact-dp | 143.3 | 144.6 | 195.8 | 6.23 | 8.14 | 0.00 | 4517 | +3.5 [−1.0, +8.0], 21-16-14 |
| EWMA α=0.35 | exact-dp | 145.3 | 143.1 | 202.0 | 6.30 | 8.26 | −0.04 | 4517 | +5.4 [−0.8, +10.8], 30-16-5 |
| Shrink to position | exact-dp | 143.7 | 144.3 | 160.1 | 5.99 | 7.71 | −0.02 | 4517 | +3.8 [0.0, +8.0], 18-14-19 |
| Usage × rate | exact-dp | 141.1 | 139.2 | 205.0 | 6.38 | 8.31 | +0.18 | 4517 | +1.3 [−5.4, +8.5], 21-22-8 |
| Opponent-adjusted trail | exact-dp | 143.2 | 140.4 | 201.1 | 6.36 | 8.31 | −0.11 | 4517 | +3.3 [−4.8, +12.2], 23-28-0 |
| Trailing mean, greedy by projection | greedy-proj | 139.9 | 141.7 | 191.9 | 6.19 | 8.10 | −0.02 | 4517 | 0.0 [0.0, 0.0], 0-0-51 |

#### 2025 shipped slate (`run-cc0cafb84e5a6615`)

| Model | Solver | Lineup mean | Median | Projected | MAE | RMSE | Bias | n | Model − trail: mean [95%], W-L-T |
|---|---|---|---|---|---|---|---|---|---|
| Trailing mean | exact-dp | 126.7 | 135.9 | 179.6 | 6.63 | 8.62 | −0.81 | 1552 | baseline |
| Last week | exact-dp | 129.6 | 129.5 | 264.5 | 8.43 | 10.98 | −0.09 | 1552 | +2.8 [−14.2, +20.5], 7-9-1 |
| Last 3 | exact-dp | 119.6 | 124.6 | 207.0 | 7.07 | 9.13 | −0.31 | 1552 | −7.1 [−18.3, +3.4], 4-10-3 |
| 60/40 season + last 3 | exact-dp | 114.4 | 114.6 | 186.3 | 6.71 | 8.69 | −0.61 | 1552 | −12.3 [−21.4, −4.2], 3-11-3 |
| EWMA α=0.35 | exact-dp | 121.2 | 114.9 | 194.0 | 6.80 | 8.82 | −0.50 | 1552 | −5.5 [−14.0, +2.8], 7-9-1 |
| Shrink to position | exact-dp | 125.8 | 129.7 | 154.2 | 6.29 | 8.15 | −0.75 | 1552 | −1.0 [−5.3, +2.8], 7-5-5 |
| Usage × rate | exact-dp | 120.4 | 108.4 | 194.5 | 6.81 | 8.82 | −0.46 | 1552 | −6.4 [−20.4, +6.5], 6-8-3 |
| Opponent-adjusted trail | exact-dp | 122.7 | 121.8 | 195.8 | 6.86 | 8.90 | −0.87 | 1552 | −4.1 [−16.8, +8.7], 8-9-0 |
| Trailing mean, greedy by projection | greedy-proj | 124.1 | 125.9 | 169.3 | 6.63 | 8.62 | −0.81 | 1552 | −2.6 [−11.3, +5.6], 9-8-0 |

### Slates, availability and excluded weeks

From `study-facts.json`, over the common weeks (solver records over every week in range).

| Run | Universe (sha256) | Slate size | Off slate: bye / no history / unknown id | Slate statuses | Inactive slots in trailing-mean lineups | Solver records | Excluded weeks |
|---|---|---|---|---|---|---|---|
| 2023 development | synthetic-prior-season@2:2023 (`d64d489bb2de`) | 88–113 | 114 / 56 / 17 | inactive 251, played 1500 | 18 | exact-dp/proven 136, greedy-proj/heuristic 17 | none |
| 2024 development | synthetic-prior-season@2:2024 (`eb399586c9d2`) | 91–113 | 113 / 28 / 17 | inactive 285, played 1495 | 20 | exact-dp/proven 136, greedy-proj/heuristic 17 | none |
| 2025 retrospective | synthetic-prior-season@2:2025 (`3752fb27ae12`) | 89–113 | 112 / 16 / 17 | inactive 271, played 1522 | 4 | exact-dp/proven 136, greedy-proj/heuristic 17 | none |
| 2025 shipped slate | legacy-fantasy-json (`666a3b3de634`) | 87–114 | 114 / 25 / 0 | inactive 247, played 1552 | 11 | exact-dp/proven 136, greedy-proj/heuristic 17 | none |

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

Those values were written while looking at 2025. They were not tuned on 2023–2024: the development runs came first, and nothing was changed after them. The `opp@2` fix changes what the opponent factor divides by, not a parameter; it was made because a reviewer found the populations did not match, not because of the results. 2025 is labelled retrospective, never holdout. A clean test would need a season no one has studied, such as a forward 2026 record.

### What the models show

- **Player MAE.** Shrinkage has the lowest player MAE in every run: 6.02, 5.96, 5.99, pooled 5.99, shipped 6.29. Trailing mean is second in every run. The old README said the trailing mean "still wins player MAE"; that was already contradicted by its own shrink figure and is wrong on the regenerated data.
- **EWMA lineups.** EWMA α=0.35 has the highest lineup mean in each synthetic season. It beats the trailing mean by +13.4, +8.9 and +9.1 a week, and each per-season range just includes zero. The development pool gives +11.1 [+3.0, +19.8] and the full pool +10.5 [+4.2, +16.8]. On the shipped slate it loses (−5.5 [−14.0, +2.8]).
- **Opponent adjustment.** With `opp@2` its projections are about as unbiased as the trailing mean's (bias −0.11 pooled, against −3.13 with `opp@1`). Its lineups average 138.3 pooled (+4.7 [−3.8, +14.1]) and 122.7 on the shipped slate (−4.1 [−16.8, +8.7]). Every one of its ranges against the trailing mean includes zero.
- **Ranges that exclude zero.** Against the trailing mean, by run.

Lineup ranges against the trailing mean that exclude zero (descriptive bootstrap; greedy-by-projection kept when it excludes zero):

  - 2023 development: Shrink to position +9.6 [+2.2, +18.0]
  - 2024 development: EWMA α=0.35 +10.1 [+0.5, +20.2]
  - 2025 retrospective: Last week −17.2 [−31.0, −3.6]; Last 3 −11.5 [−23.2, −0.1]
  - pooled 2023+2024: Last 3 +8.1 [+1.1, +15.2]; EWMA α=0.35 +7.7 [+1.3, +13.7]; Shrink to position +6.8 [+1.6, +12.5]
  - pooled 2023+2024+2025: Shrink to position +3.8 [0.0, +8.0]
  - 2025 shipped slate: 60/40 season + last 3 −12.3 [−21.4, −4.2]


### EWMA sweep (exploratory)

The sweep was run after 2025 had been studied. It includes the 2025 retrospective season, and its best α is never a preselected setting. Every value matches the previous revision: no EWMA or trailing-mean number depends on the opponent model or on the schedule change. The synthetic columns come from `study-facts.json` and the shipped-slate column from `src/data/study-ewma.json`.

| Model | 2023 | 2024 | 2025 | Pooled 2023–2025 | 2025 shipped slate |
|---|---|---|---|---|---|
| trail | 137.1 | 127.9 | 154.5 | 139.9 | 126.7 |
| ewma-0.05 | 120.6 | 112.9 | 149.6 | 127.7 | 117.0 |
| ewma-0.10 | 133.4 | 126.5 | 151.7 | 137.2 | 112.8 |
| ewma-0.15 | 130.2 | 127.7 | 154.9 | 137.6 | 111.2 |
| ewma-0.20 | 135.3 | 135.7 | 158.4 | 143.2 | 115.1 |
| ewma-0.25 | 136.2 | 139.5 | 162.5 | 146.1 | 118.9 |
| ewma-0.30 | 142.0 | 139.6 | 153.9 | 145.2 | 121.5 |
| ewma-0.35 | 142.4 | 138.0 | 155.5 | 145.3 | 121.2 |
| ewma-0.40 | 143.7 | 137.3 | 153.6 | 144.9 | 119.5 |
| ewma-0.45 | 142.0 | 139.6 | 151.6 | 144.4 | 121.3 |
| ewma-0.50 | 143.6 | 138.2 | 150.7 | 144.2 | 121.7 |
| ewma-0.55 | 136.7 | 137.3 | 145.8 | 139.9 | 123.2 |
| ewma-0.60 | 136.5 | 137.6 | 143.1 | 139.1 | 120.2 |
| ewma-0.65 | 137.7 | 135.0 | 139.4 | 137.4 | 121.1 |
| ewma-0.70 | 137.6 | 141.4 | 135.8 | 138.2 | 122.4 |
| ewma-0.75 | 134.8 | 139.9 | 136.9 | 137.2 | 125.8 |
| ewma-0.80 | 134.5 | 136.2 | 137.8 | 136.2 | 126.3 |
| ewma-0.85 | 131.5 | 136.2 | 136.6 | 134.8 | 126.5 |
| ewma-0.90 | 131.4 | 135.7 | 137.9 | 135.0 | 132.5 |
| ewma-0.95 | 133.3 | 133.7 | 137.4 | 134.8 | 132.4 |
| ewma-1.00 | 133.9 | 134.0 | 137.4 | 135.1 | 129.6 |

- **The best α moves.** It is 0.40 in 2023, 0.30 in 2024 and 0.20 in 2025. The pool peaks at 0.35 with 0.40 and 0.45 within 0.5, and the shipped slate peaks at 0.90.
- **Two pools disagree.** The shipped slate rewards heavy weight on last week; the synthetic pools reward moderate weight.
- **The coincidence at 0.35.** The pooled peak landing on the old default is not independent confirmation, because the grid and the seasons were chosen after the fact.

## QB lag

- **2025 page file.** `src/data/study-qb-lag.json` was regenerated by `build-study.ts` and is byte-identical to the previous revision. Against the first publication it holds the same 409 pairs, with identical values and identical `n`, `corrEpa` (0.165) and `corrCpoe` (0.143). Only the order of `pairs` changed: the old script kept first-appearance order from the CSV, and the shared runner sorts by player id, then week.
- **Other seasons.** The same computation gives 2023: n = 433, r = 0.141 (EPA per attempt) and 0.109 (CPOE); 2024: n = 425, r = 0.152 and 0.121.
- **Provenance.** Each QB lag artifact records the player-week hash it read, and publish checks it against the season run.

## Narrative corrections

| Old statement (page, README or this report) | Regenerated evidence | Change |
|---|---|---|
| "Exact DP 116.5 … greedy 115.8 … +0.7" | Shipped slate 126.7 vs 124.1 (+2.6 [−5.6, +11.3]); pooled synthetic 133.5 vs 132.2 (+1.4 [−3.4, +6.6]) | Numbers replaced; "barely" still fits |
| "That's a 0.7-point gap — inside the noise" | The bootstrap range includes zero in every run | Replaced by the analysis |
| "It overshot every single week (17 of 17)"; "Every week is under [the line]" | 17 of 17 in every season and on the shipped slate (51 of 51 synthetic) | Kept, now computed from the data at render time |
| "That's packing last week's luck, not a bug in the picker" / "That's the hole — not the picker math" | The picker had a bug (178 of 510 silent fallbacks). The overshoot persists with proven-optimal lineups, and player bias is about 0 | Rewritten: there was a bug; the overshoot is selection |
| "Shrinkage … best player MAE (6.23), worse lineup (112.9) — it flattens stars" | Best MAE in every run. Lineups 136.3 pooled (+2.7 [−1.3, +7.2]); shipped 125.8 (−1.0 [−5.3, +2.8]) | "Worse lineup" and "flattens stars" dropped |
| "Trailing mean still wins player MAE (6.58)" | Shrinkage wins every run; trailing mean is second | Contradiction resolved |
| "EWMA: only model that moved lineup actuals … peak 121.5 at α=0.30" | Old peak partly fallback luck. α=0.35 +10.5 pooled on synthetic pools, −5.5 on the shipped slate; best α varies by season | Rewritten; sweep kept exploratory |
| "Opponent-adjust: 67.8. Thin splits." / "built terrible teams" | Caused by postgame-row opponents and a factor that compared different populations; `opp@2` gives 138.3 pooled, 122.7 shipped | Cause corrected twice |
| "Opponent-adjusted projections run about 3 points low, but its lineups are fine: 137.3 pooled, 129.8 on the shipped slate" (previous revision) | The low bias was the `opp@1` population mismatch; `opp@2` bias −0.11 pooled; lineups 138.3 and 122.7, every range includes zero | Rewritten |
| "Usage and opponent adjustment are the only models whose ranges against the trailing mean exclude zero in 2025" (previous revision) | 2025: only usage; the 60/40 blend's shipped-slate range excludes zero too | Replaced by the list above |
| "The solver beats “stars and scrubs”" (README) | That baseline takes the most projected points per dollar and leaves cap unspent | Renamed cheap points-per-dollar picks |
| "Exact DP missed a legal roster some weeks (hill-climb fallback)" | True, but those lineups were reported as exact | Now reported as a solver failure, fixed |
| "Estimated DST points-allowed" | Points allowed is the final score | Fixed |
| "2025 holdout" | 2025 had been examined | Relabelled retrospective |

## Limits

- The salaries are synthetic, frozen per season and shaped like the shipped slate's bands. The synthetic pools miss rookies and offseason moves; a player traded mid-season is matched to his latest team before the cutoff.
- History is within-season only, so week 1 never has a slate and early weeks have thin priors.
- Three seasons is 51 weeks. The ranges are wide, and 2025 is retrospective.
- The attribution steps 0–c1 come from an uncommitted replay harness run on the previous schedule bytes. Step c2 bundles several policy changes; only the opponent effect was isolated.
- The opponent-factor diagnostic above is a one-time script, not a committed artifact.
- The exact DP does not model stacks, and study models never request one.

## Reproduce

```bash
npm ci
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
# attribution only (not published): the wrappers refuse this scoring unless --legacy-out is outside src/data
npm run study:build -- --seasons 2025 --role retrospective --universe legacy-fantasy-json --models core --scoring legacy-study-dst@ce5d6b1 --out-dir artifacts/study/legacy2025-lscore
```

Add `--offline --pin-inputs docs/study/input-manifest.json` to any study or wrapper command to require these exact bytes from the cache.

## Projection-first models tables (post no-salary regen)

#### 2023 development (`run-7d10819f40b21866`)

| Model | Solver | Lineup mean | Median | Projected | MAE | RMSE | Bias | n | Model − trail: mean [95%], W-L-T |
|---|---|---|---|---|---|---|---|---|---|
| Trailing mean | exact-dp | 137.1 | 137.5 | 198.4 | 6.24 | 8.17 | −0.05 | 1500 | baseline |
| Last week | exact-dp | 133.9 | 129.6 | 258.7 | 7.76 | 10.12 | −0.03 | 1500 | −3.2 [−17.2, +11.1], 6-10-1 |
| Last 3 | exact-dp | 145.6 | 137.5 | 216.0 | 6.53 | 8.56 | −0.10 | 1500 | +8.5 [−1.5, +19.5], 8-6-3 |
| 60/40 season + last 3 | exact-dp | 142.0 | 137.5 | 200.3 | 6.26 | 8.20 | −0.07 | 1500 | +4.9 [−3.0, +13.6], 7-5-5 |
| EWMA α=0.35 | exact-dp | 142.4 | 140.2 | 206.7 | 6.31 | 8.32 | −0.14 | 1500 | +5.3 [−2.5, +13.6], 10-5-2 |
| Shrink to position | exact-dp | 146.7 | 141.8 | 162.8 | 6.02 | 7.73 | −0.04 | 1500 | +9.6 [+2.2, +18.0], 8-2-7 |
| Usage × rate | exact-dp | 135.4 | 131.6 | 205.8 | 6.40 | 8.39 | +0.04 | 1500 | −1.8 [−10.5, +7.4], 5-8-4 |
| Opponent-adjusted trail | exact-dp | 146.2 | 145.5 | 204.8 | 6.34 | 8.27 | −0.18 | 1500 | +9.1 [−2.2, +21.5], 7-10-0 |
| Trailing mean, greedy by projection | greedy-proj | 137.1 | 137.5 | 198.4 | 6.24 | 8.17 | −0.05 | 1500 | 0.0 [0.0, 0.0], 0-0-17 |

#### 2024 development (`run-715052c7ebb0f090`)

| Model | Solver | Lineup mean | Median | Projected | MAE | RMSE | Bias | n | Model − trail: mean [95%], W-L-T |
|---|---|---|---|---|---|---|---|---|---|
| Trailing mean | exact-dp | 127.9 | 130.2 | 186.4 | 6.18 | 8.04 | −0.12 | 1495 | baseline |
| Last week | exact-dp | 134.0 | 135.1 | 249.1 | 7.81 | 10.04 | +0.12 | 1495 | +6.1 [−1.6, +14.3], 8-8-1 |
| Last 3 | exact-dp | 135.6 | 134.4 | 207.6 | 6.44 | 8.37 | +0.07 | 1495 | +7.7 [−1.0, +17.1], 8-6-3 |
| 60/40 season + last 3 | exact-dp | 131.2 | 135.3 | 190.8 | 6.18 | 8.04 | −0.04 | 1495 | +3.3 [−3.1, +10.6], 8-5-4 |
| EWMA α=0.35 | exact-dp | 138.0 | 138.0 | 198.4 | 6.26 | 8.16 | −0.01 | 1495 | +10.1 [+0.5, +20.2], 11-4-2 |
| Shrink to position | exact-dp | 131.9 | 129.0 | 157.2 | 5.96 | 7.64 | −0.12 | 1495 | +4.0 [−2.8, +11.3], 6-8-3 |
| Usage × rate | exact-dp | 139.1 | 141.7 | 208.0 | 6.35 | 8.18 | +0.21 | 1495 | +11.1 [−1.4, +25.4], 10-5-2 |
| Opponent-adjusted trail | exact-dp | 132.6 | 133.8 | 198.1 | 6.41 | 8.38 | −0.19 | 1495 | +4.7 [−9.2, +19.4], 9-8-0 |
| Trailing mean, greedy by projection | greedy-proj | 127.9 | 130.2 | 186.4 | 6.18 | 8.04 | −0.12 | 1495 | 0.0 [0.0, 0.0], 0-0-17 |

#### 2025 retrospective (`run-6c94c248f660227d`)

| Model | Solver | Lineup mean | Median | Projected | MAE | RMSE | Bias | n | Model − trail: mean [95%], W-L-T |
|---|---|---|---|---|---|---|---|---|---|
| Trailing mean | exact-dp | 154.5 | 156.6 | 191.0 | 6.17 | 8.08 | +0.11 | 1522 | baseline |
| Last week | exact-dp | 137.4 | 125.6 | 258.3 | 7.78 | 10.42 | +0.14 | 1522 | −17.2 [−31.0, −3.6], 4-12-1 |
| Last 3 | exact-dp | 143.0 | 146.6 | 210.2 | 6.57 | 8.62 | +0.12 | 1522 | −11.5 [−23.2, −0.1], 4-10-3 |
| 60/40 season + last 3 | exact-dp | 156.8 | 160.0 | 196.4 | 6.24 | 8.17 | +0.12 | 1522 | +2.2 [−5.8, +10.1], 6-6-5 |
| EWMA α=0.35 | exact-dp | 155.5 | 156.3 | 200.9 | 6.31 | 8.30 | +0.04 | 1522 | +0.9 [−11.4, +11.9], 9-7-1 |
| Shrink to position | exact-dp | 152.3 | 155.4 | 160.5 | 5.99 | 7.74 | +0.09 | 1522 | −2.2 [−7.6, +2.4], 4-4-9 |
| Usage × rate | exact-dp | 149.0 | 142.7 | 201.3 | 6.38 | 8.36 | +0.29 | 1522 | −5.6 [−17.4, +5.7], 6-9-2 |
| Opponent-adjusted trail | exact-dp | 150.8 | 144.3 | 200.3 | 6.32 | 8.28 | +0.04 | 1522 | −3.8 [−18.7, +14.1], 7-10-0 |
| Trailing mean, greedy by projection | greedy-proj | 154.5 | 156.6 | 191.0 | 6.17 | 8.08 | +0.11 | 1522 | 0.0 [0.0, 0.0], 0-0-17 |

#### pooled 2023+2024 (`cf0245970965…`)

| Model | Solver | Lineup mean | Median | Projected | MAE | RMSE | Bias | n | Model − trail: mean [95%], W-L-T |
|---|---|---|---|---|---|---|---|---|---|
| Trailing mean | exact-dp | 132.5 | 132.4 | 192.4 | 6.21 | 8.11 | −0.08 | 2995 | baseline |
| Last week | exact-dp | 134.0 | 135.1 | 253.9 | 7.78 | 10.08 | +0.05 | 2995 | +1.5 [−6.4, +9.0], 14-18-2 |
| Last 3 | exact-dp | 140.6 | 134.5 | 211.8 | 6.48 | 8.47 | −0.01 | 2995 | +8.1 [+1.1, +15.2], 16-12-6 |
| 60/40 season + last 3 | exact-dp | 136.6 | 137.0 | 195.6 | 6.22 | 8.12 | −0.06 | 2995 | +4.1 [−1.3, +9.7], 15-10-9 |
| EWMA α=0.35 | exact-dp | 140.2 | 139.6 | 202.6 | 6.29 | 8.24 | −0.07 | 2995 | +7.7 [+1.3, +13.7], 21-9-4 |
| Shrink to position | exact-dp | 139.3 | 133.8 | 160.0 | 5.99 | 7.69 | −0.08 | 2995 | +6.8 [+1.6, +12.5], 14-10-10 |
| Usage × rate | exact-dp | 137.2 | 136.2 | 206.9 | 6.37 | 8.29 | +0.12 | 2995 | +4.7 [−3.1, +13.2], 15-13-6 |
| Opponent-adjusted trail | exact-dp | 139.4 | 138.7 | 201.4 | 6.38 | 8.32 | −0.18 | 2995 | +6.9 [−1.8, +16.5], 16-18-0 |
| Trailing mean, greedy by projection | greedy-proj | 132.5 | 132.4 | 192.4 | 6.21 | 8.11 | −0.08 | 2995 | 0.0 [0.0, 0.0], 0-0-34 |

#### pooled 2023+2024+2025 (`cabea9fac08e…`)

| Model | Solver | Lineup mean | Median | Projected | MAE | RMSE | Bias | n | Model − trail: mean [95%], W-L-T |
|---|---|---|---|---|---|---|---|---|---|
| Trailing mean | exact-dp | 139.9 | 141.7 | 191.9 | 6.19 | 8.10 | −0.02 | 4517 | baseline |
| Last week | exact-dp | 135.1 | 131.1 | 255.4 | 7.78 | 10.20 | +0.08 | 4517 | −4.7 [−12.1, +2.8], 18-30-3 |
| Last 3 | exact-dp | 141.4 | 137.5 | 211.3 | 6.51 | 8.52 | +0.03 | 4517 | +1.6 [−5.1, +8.3], 20-22-9 |
| 60/40 season + last 3 | exact-dp | 143.3 | 144.6 | 195.8 | 6.23 | 8.14 | 0.00 | 4517 | +3.5 [−1.0, +8.0], 21-16-14 |
| EWMA α=0.35 | exact-dp | 145.3 | 143.1 | 202.0 | 6.30 | 8.26 | −0.04 | 4517 | +5.4 [−0.8, +10.8], 30-16-5 |
| Shrink to position | exact-dp | 143.7 | 144.3 | 160.1 | 5.99 | 7.71 | −0.02 | 4517 | +3.8 [0.0, +8.0], 18-14-19 |
| Usage × rate | exact-dp | 141.1 | 139.2 | 205.0 | 6.38 | 8.31 | +0.18 | 4517 | +1.3 [−5.4, +8.5], 21-22-8 |
| Opponent-adjusted trail | exact-dp | 143.2 | 140.4 | 201.1 | 6.36 | 8.31 | −0.11 | 4517 | +3.3 [−4.8, +12.2], 23-28-0 |
| Trailing mean, greedy by projection | greedy-proj | 139.9 | 141.7 | 191.9 | 6.19 | 8.10 | −0.02 | 4517 | 0.0 [0.0, 0.0], 0-0-51 |

#### 2025 shipped slate (`run-cc0cafb84e5a6615`)

| Model | Solver | Lineup mean | Median | Projected | MAE | RMSE | Bias | n | Model − trail: mean [95%], W-L-T |
|---|---|---|---|---|---|---|---|---|---|
| Trailing mean | exact-dp | 126.7 | 135.9 | 179.6 | 6.63 | 8.62 | −0.81 | 1552 | baseline |
| Last week | exact-dp | 129.6 | 129.5 | 264.5 | 8.43 | 10.98 | −0.09 | 1552 | +2.8 [−14.2, +20.5], 7-9-1 |
| Last 3 | exact-dp | 119.6 | 124.6 | 207.0 | 7.07 | 9.13 | −0.31 | 1552 | −7.1 [−18.3, +3.4], 4-10-3 |
| 60/40 season + last 3 | exact-dp | 114.4 | 114.6 | 186.3 | 6.71 | 8.69 | −0.61 | 1552 | −12.3 [−21.4, −4.2], 3-11-3 |
| EWMA α=0.35 | exact-dp | 121.2 | 114.9 | 194.0 | 6.80 | 8.82 | −0.50 | 1552 | −5.5 [−14.0, +2.8], 7-9-1 |
| Shrink to position | exact-dp | 125.8 | 129.7 | 154.2 | 6.29 | 8.14 | −0.75 | 1552 | −1.0 [−5.3, +2.8], 7-5-5 |
| Usage × rate | exact-dp | 120.4 | 108.4 | 194.5 | 6.81 | 8.82 | −0.46 | 1552 | −6.4 [−20.4, +6.5], 6-8-3 |
| Opponent-adjusted trail | exact-dp | 122.7 | 121.8 | 195.8 | 6.86 | 8.90 | −0.87 | 1552 | −4.1 [−16.8, +8.7], 8-9-0 |
| Trailing mean, greedy by projection | greedy-proj | 124.1 | 125.9 | 169.3 | 6.63 | 8.62 | −0.81 | 1552 | −2.6 [−11.3, +5.6], 9-8-0 |
