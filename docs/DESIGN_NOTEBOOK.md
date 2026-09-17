# Design notebook (interview-facing)

**Audience:** you, explaining Gridiron Lab as a **data-science** project in 60 seconds or 5 minutes (resume screen or hiring manager).  
**Not this file:** the long build diary in [`IMPLEMENTATION_PROGRESS.md`](IMPLEMENTATION_PROGRESS.md), or the attribution archaeology in [`study/REGENERATION_REPORT.md`](study/REGENERATION_REPORT.md). Open those only if someone asks "how did you get here?"

**One-line resume angle:** Causal multi-season evaluation of salary-cap lineup policies on NFL player-week data — leakage-controlled inputs, versioned scoring, proven exact optimizer, bootstrap uncertainty, failures published.

**Core claim:** `/study` is the scientific result. The React labs are instrumentation around a reproducible 2023–2025 lineup evaluation with strict causality, a proven salary-cap solver, and published numbers pinned by tests. Lead with methodology and eval design, not UI.

---

## 60-second talk track

> I ran a causal evaluation of salary-cap lineup selection on NFL data, not a fantasy tip app. For each of 2023–2025 I freeze a 114-player pool and synthetic salaries from the *prior* season only, project with strictly pre-week history, then require an exact DP to prove the best $50k lineup—or that week is dropped for every method. Scoring is a versioned PPR+DST ruleset. Exact vs greedy-by-projection is about **+1.4 points/week** pooled, but the bootstrap CI includes zero; vs points-per-dollar greedy it wins by ~22. A look-ahead "shipped slate" stays labelled comparison-only. README "What failed" documents leakage and solver bugs I found and fixed. Every study number in the README is regenerated in CI from pinned artifacts.

**Resume bullets to steal from:** leakage control · common-week policy · proven vs heuristic contract · content-addressed inputs · bootstrap over weeks · published failure modes.

**Open in the repo first:** `README.md` Result + What failed, then this notebook. **Browser demo (optional):** `/study`.

---

## 5-minute talk track

1. **Problem (DS).** Cap-constrained selection is an *evaluation* problem: can you compare policies without leakage, with a correct optimizer, and with regenerable numbers? Hobby projects often leak future info, soft-fail the solver, or hand-edit results. I built a study I can defend under scrutiny.
2. **Design split.** Offline pipeline (`scripts/lib/study/*`) is the science path: inputs → universe → causal projections → strict solves → sealed artifacts → publish. The app (`src/lib`, routes, worker) is exploration/demo on the same `solveLineup`. In an interview, spend most of the time on the pipeline and README Result — not the UI.
3. **Leakage control.** Projection cutoff is "rows strictly before week *w*." Opponents come from the *schedule*, never postgame rows. Universes are either `synthetic-prior-season@1` (clean) or the shipped `fantasy.json` (look-ahead, labelled). Roles are `development` / `retrospective` / `holdout`—2025 is retrospective, not a holdout.
4. **Solver contract.** `solveLineup` runs exactly one method with no silent fallback. Study weeks require `exact-dp` + `optimality: "proven"`. The interactive page may fall back to hill-climb for QB stacks, but it labels heuristic and records why.
5. **Honesty as a feature.** First DP sometimes returned nothing and hill-climb was mislabelled exact. Opponent-adjust v1 compared different populations (`opp@1` → `opp@2`). DST scoring double-counted XPs. Those are in README "What failed," not buried.
6. **Reproducibility.** Content-addressed `.study-cache/`, pinned `docs/study/input-manifest.json`, `--offline --pin-inputs`, run ids hashed from config+inputs+policies, `docs-agreement.test.ts` fails if README numbers drift.
7. **What I'd say next.** Weak forecast (trailing mean), synthetic salaries miss rookies, 51 weeks can't separate exact vs greedy, inactive≈0 is ambiguous in nflverse. Cap-optimal on a bad projection is still a bad lineup.

---

## Architecture (layers)

```mermaid
flowchart TB
  subgraph sources [External sources]
    NFLV[nflverse player/team week]
    GAMES[nfldata games.csv]
    ESPN[ESPN live feeds]
  end

  subgraph offline [Offline study pipeline]
    IN[inputs.ts acquire + SHA-256 cache]
    PRE[prepare.ts score rows]
    UNI[universe.ts freeze pool + salaries]
    PROJ[projections.ts pre-cutoff snapshot]
    RUN[runner.ts common slate + strict solve]
    PUB[publish.ts seasons file + manifest]
  end

  subgraph domain [Shared domain]
    SCORE[football/scoring.ts ruleset]
    OPT[optimizer.ts solveLineup]
    VAL[football/lineup-validation.ts]
  end

  subgraph app [TanStack Start app]
    STUDY["/study reads study-seasons.json"]
    OPTUI["/optimizer + worker"]
    QB["/qb EPA CPOE"]
    LIVE["/live /players freshness"]
  end

  NFLV --> IN
  GAMES --> IN
  IN --> PRE
  PRE --> UNI
  PRE --> PROJ
  UNI --> RUN
  PROJ --> RUN
  SCORE --> PRE
  OPT --> RUN
  VAL --> OPT
  RUN --> PUB
  PUB --> STUDY
  OPT --> OPTUI
  ESPN --> LIVE
```

### Why each layer exists (and the tradeoff)

| Layer | Why it exists | Tradeoff |
|---|---|---|
| **inputs / hash cache** | Interviewers ask "can you regenerate?" Pins + offline mode answer with bytes, not vibes. | Cache is gitignored; collaborators must fetch once or use the manifest. |
| **prepare + scoring** | One versioned ruleset (`gridiron-lab-ppr-dst@1`); providers normalize columns first. Missing stats stay missing—never filled with zeros. | Not exact DraftKings; DST points-allowed = opponent's final score (including D/ST scores). |
| **universe** | Separates *who is eligible and at what salary* from *how you project*. Clean pools use prior season only; legacy slate stays for attribution. | Synthetic salaries ≠ market prices; rookies/offseason moves absent. |
| **projections** | Pure functions of a pre-cutoff snapshot so every method sees the same information set. Method defs are versioned (`opp@2`, `ewma@1`, …). | Methods are simple (trail, EWMA, shrink, …)—deliberately explainable, not a black-box ML stack. |
| **runner** | One common slate per week; every model must solve or the week is excluded for all; summaries from week records + week-level bootstrap. | Strictness drops weeks under incomplete actuals; small *n* → wide intervals. |
| **publish** | Page never hand-edits numbers; publish verifies artifact hashes and refuses mixed configs / attribution-only scoring. | Two-step workflow (run → publish) before README/CI agree. |
| **optimizer + validation** | Exact DP for DK-like roster under salary; heuristics labelled; stack is a separate concern. | Exact DP does not encode QB stack; UI may hill-climb and must say so. |
| **worker protocol** | Keeps DP off the main thread; pure `handleWorkerRequest` so Node tests = browser path. | Extra protocol validation; cancel = terminate worker. |
| **routes / labs** | Teachability: interactive optimizer and QB lab make the study tangible. Study / optimizer / QB page sections live in `src/components/{study,optimizer,qb}/`; routes stay thin shells. | `qb.tsx` still owns URL/pin/scatter state (`QbLab`); some product surface (auth/db) is adjacent to the DS story. |

### App surface map (optional demo)

Only if they ask to click around. Prefer the study pipeline files below. Component folders (post-split):

- `src/components/study/` — DidItHelp, TooOptimistic, BetterGuesses, HotQbs, WhatWentWrong, …
- `src/components/optimizer/` — SolvePanel, LineupResult, PlayerRows, BacktestPanel, …
- `src/components/qb/` — WeekBars, QbDot, QbDotTip, Field

Routes (`src/routes/study.tsx`, `optimizer.tsx`, `qb.tsx`) compose those pieces. Solver contract (`useLineupSolver` / proven-vs-heuristic labelling) is unchanged.

---

## Data flow (one study week)

```mermaid
sequenceDiagram
  participant Cache as study-cache SHA-256
  participant Prep as prepare
  participant Snap as snapshotBefore(w)
  participant Feat as buildFeatures
  participant Proj as project(model)
  participant DP as solveLineup exact-dp
  participant Seal as sealRun + publish

  Cache->>Prep: verified player/team/game rows
  Prep->>Snap: only rows with week < w
  Note over Snap: scores stripped from week ≥ w games
  Snap->>Feat: position prior + opp allowed (same population)
  loop each model on shared slate
    Feat->>Proj: subject + snapshot
    Proj->>DP: salary + proj pool
    DP-->>Seal: proven lineup or week excluded
  end
  Seal->>Seal: common weeks only; bootstrap over weeks
```

**Interview soundbite:** "The slate is shared; the projection and the solver method vary; a failure anywhere invalidates the week for the comparison set."

---

## Rubric checklist (mapped to this repo)

| Practice | Meets? | Where |
|---|---|---|
| **Reproducibility** | Yes | `npm run study:build`, `docs/study/input-manifest.json`, `--offline --pin-inputs`, sealed `resultSha256`, `REGENERATION_REPORT.md` |
| **Leakage control** | Yes (clean path) | `projections.snapshotBefore`, schedule opponents, `synthetic-prior-season@1`; shipped slate look-ahead **disclosed** and not in the clean pool |
| **Validation / data integrity** | Strong | Scoring missing≠0; inactive vs missing status; publish config equality checks; CSV required columns |
| **Separation of concerns** | Strong | Pipeline vs domain vs UI; solver API shared; study page reads published JSON only |
| **Testability** | Strong | `tests/domain/*` (solver oracle, projections, runner, publish); `docs-agreement.test.ts` pins README; `test:ui` + Playwright e2e |
| **Observability / honesty** | Strong | Proven vs heuristic labels; feed freshness status; README What failed; exclusion reasons on weeks |
| **Uncertainty communication** | Good | Percentile bootstrap over **weeks** (not players); explicitly "descriptive, not a significance test" |
| **Interview explainability** | Improved by this doc | Still: mega-routes and long `IMPLEMENTATION_PROGRESS` are chronical, not a pitch—use this notebook first |
| **Miss: true holdout** | Gap | 2025 is retrospective; no sealed future season yet. Say so. |
| **Miss: market salaries** | Gap | Synthetic bands from prior PPG—fine for method comparison, not for DFS edge claims. |
| **Miss: stack in exact DP** | Gap | Documented; UI fallback labelled heuristic. |

---

## Files and commands to open in an interview

### Narrative / results
- `README.md` — Result tables + What failed (lead with this)
- `docs/DESIGN_NOTEBOOK.md` — this file
- `docs/study/REGENERATION_REPORT.md` — only if asked how numbers moved after bugfixes
- `docs/perf/optimizer-worker.md` — only if asked about main-thread / worker tradeoffs

### Pipeline (offline)
- `scripts/lib/study/runner.ts` — policies + week loop + strict solver
- `scripts/lib/study/projections.ts` — cutoff snapshot + methods
- `scripts/lib/study/universe.ts` — synthetic vs legacy
- `scripts/lib/study/models.ts` — presets, `opp@2`, EWMA sweep labelling
- `scripts/lib/study/inputs.ts` — content-addressed acquire
- `scripts/lib/study/publish.ts` — seasons file + manifest

### Domain (shared)
- `src/lib/optimizer.ts` — exact DP + heuristics contract
- `src/lib/football/scoring.ts` — versioned ruleset
- `src/lib/football/lineup-validation.ts` — input/roster checks
- `src/lib/lineup/worker-protocol.ts` + `src/workers/optimizer.worker.ts`

### App surface
- `src/routes/study.tsx` — published study UI
- `src/routes/optimizer.tsx` — interactive solve (large; skim with `use-lineup-solver.ts`)

### Proof
- `tests/domain/docs-agreement.test.ts`
- `tests/domain/optimizer-oracle.test.ts` / `optimizer.test.ts`
- `tests/domain/study-*.test.ts`

### Commands
```bash
npm run typecheck
npm run test:domain          # solver + study + docs agreement
npm run study:build -- --help
npm run study:build -- --offline --pin-inputs docs/study/input-manifest.json ...
npm run test:e2e             # after build + playwright chromium
```

---

## Prioritized review (resume / interview readiness)

### Must-fix (for the pitch)
1. **Missing short design notebook** — addressed by this file; README should link it.
2. **Lead with failures, not just wins** — already in README; practice the oral version (see below).
3. **Don't claim holdout or DFS edge** — roles and synthetic salaries are correct in docs; keep language tight in interviews.

### Should-improve (follow-up — data science, not UI chrome)
1. **Mega-route split is done.** Further `QbLab` extraction is optional demo hygiene — skip unless a live screen-share needs it.
2. **If claiming market edge later:** real salaries and/or a sealed holdout season. Until then, keep calling 2025 retrospective and salaries synthetic.
3. **Keep the diary demoted:** `IMPLEMENTATION_PROGRESS.md` is history; this notebook + README Result stay the resume path.

### Nice-to-have
1. Collapse older `IMPLEMENTATION_PROGRESS` sections under History so reviewers don't mistake the diary for the architecture.
2. A one-page PDF "study abstract" for applications that want a paper-like artifact (same claims as the 60s track).
3. Optional short recording of `/study` only if an application asks for media — not required for the DS claim.

---

## Practice lines (from README "What failed")

Use these almost verbatim—they signal senior judgment:

- **Synthetic salaries:** "Pools and prices are frozen from the prior season. That removes salary-API noise so methods are comparable, but it misses rookies and cuts. I would never pitch this as a live DFS edge."
- **Shipped slate look-ahead:** "The original 114-player file was built from full-season 2025 stats. Only 66 overlap the clean pool. It stays as a comparison row, never as the historical claim."
- **Broken first DP:** "The first exact solver sometimes returned nothing; hill-climb filled in while results were still labelled exact. I fixed the DP, made the study strict—no substitute method—and documented that the old page was wrong."
- **Opponent-adjust bug:** "Version 1 divided an all-player opponent mean by the *pool's* position mean—different populations—so skill players sat on the 0.7 clamp. `opp@2` uses one population; the published claim softened accordingly."
- **Inactive = 0:** "No stat row in a final game scores zero in the lineup, but nflverse also omits active zeros. Trailing-mean lineups used 49 such slots over 51 weeks."
- **Headline humility:** "Exact beats greedy by +1.4/week pooled, but the range includes zero. Cap-optimal on a weak projection is still a weak lineup. The interesting failure mode is selection: player-level bias ≈ 0 while lineup projection overshot every week."

---


## Resume framing (copy-paste)

**Title-ish:** Causal evaluation of salary-cap lineup policies on NFL player-week data (TypeScript).

**Bullets:**
- Designed a leakage-controlled multi-season backtest: prior-season universes, pre-week projection cutoffs, schedule-based opponents, common-week drops when the exact solver cannot prove.
- Compared exact DP vs greedy baselines with week-level bootstrap intervals; reported null-friendly results (exact vs proj-greedy CI includes 0) alongside large gaps vs pts/$.
- Shipped content-addressed inputs, versioned scoring (`gridiron-lab-ppr-dst@1`), and CI that regenerates README study numbers from sealed artifacts.
- Documented and fixed evaluation bugs (broken DP mislabelled as exact, DST XP double-count, opponent-adjust population mismatch, look-ahead slate).

**What not to claim:** Live DraftKings edge; that 2025 is a sealed holdout; that trailing mean is a strong forecast.

## Glossary (quick)

| Term | Meaning here |
|---|---|
| **Proven** | Exact DP found the optimal roster under stated constraints |
| **Heuristic** | Greedy / hill-climb; not a proof |
| **Look-ahead** | Universe or features used information from after the prediction cutoff |
| **Common weeks** | Weeks where every compared model produced a complete lineup actual |
| **Development / retrospective** | Tuned-on vs examined-before; neither is a sealed holdout |
