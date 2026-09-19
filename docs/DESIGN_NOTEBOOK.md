# Design notebook (interview-facing)

**Audience:** you, explaining Gridiron Lab in 60 seconds or 5 minutes.  
**Not this file:** the long build diary in [`IMPLEMENTATION_PROGRESS.md`](IMPLEMENTATION_PROGRESS.md), or the deep change log in [`study/REGENERATION_REPORT.md`](study/REGENERATION_REPORT.md).

**Rule:** keep the story simple. Only claim what is real. **Synthetic DraftKings salaries / a $50k cap are out of the pitch.**

**One-line resume angle:** Leakage-controlled multi-season evaluation of NFL fantasy point projections — prior-season player pools, no future-data cheating, player MAE published in CI, failures written up honestly.

**Core claim:** Projection quality under a fair information cutoff. `/study` publishes the numbers; lead with README Result (MAE) + What failed — not the optimizer demo.

---

## 60-second talk track

> I evaluated fantasy point projections on NFL data with no look-ahead. For 2023–2025 I freeze a 114-player pool from the *prior* season only and project using only earlier weeks, then measure player MAE against real points. Shrinkage to position has the best MAE; trailing mean is second; last-week alone is worst. I do **not** claim DraftKings salaries or a $50k lineup edge — an older cap experiment used synthetic prices, so I dropped that from the pitch. README What failed covers look-ahead slates, opponent-adjust bugs, and scoring mistakes. CI rebuilds the README numbers from saved study files.

**Ideas worth saying:** don’t peek at the future · same pools/weeks for every method · publish MAE · admit failures · no fake market prices.

**Open first:** `README.md` Result + What failed. **Optional demo:** `/study` for numbers; skip `/optimizer` in a DS interview.

---

## 5-minute talk track

1. **Problem.** Can you compare projection methods fairly? Many projects peek at future stats or paste numbers by hand.
2. **Where the science lives.** Study scripts pin data → build pools → project → score player error → publish into the README. Spend interview time on that, not UI.
3. **No future peeking.** For week *w*, projections only see weeks before *w*. Clean pools use last season only. The old shipped slate used future info — labelled, not clean history. 2025 is retrospective, not a secret holdout.
4. **What I measure.** Player MAE on played slate player-weeks. Shrinkage wins MAE; I don’t oversell EWMA from an old lineup experiment.
5. **What I don’t claim.** Live DraftKings salaries, a $50k salary-cap edge, or that trailing mean is a strong forecast.
6. **I publish mistakes.** Bye-week slate bug, DST scoring bug, opponent-adjust using the wrong group, look-ahead shipped slate.
7. **Rebuildable numbers.** Inputs hashed/pinned; CI fails if README study numbers don’t match the saved runs.

---

## How the pieces fit

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
| **projections** | Only use data from before the week, so every method sees the same information. Method defs are versioned (`opp@2`, `ewma@1`, …). | Methods are simple (trail, EWMA, shrink, …)—deliberately explainable, not a black-box ML stack. |
| **runner** | One common slate per week; every model must solve or the week is excluded for all; summaries from week records + week-level bootstrap. | Strictness drops weeks under incomplete actuals; small *n* → wide intervals. |
| **publish** | Page never hand-edits numbers; publish verifies artifact hashes and refuses mixed configs / attribution-only scoring. | Two-step workflow (run → publish) before README/CI agree. |
| **optimizer + validation** | Exact solver for DK-like roster under salary; guesses labelled; stack is a separate concern. | Exact DP does not encode QB stack; UI may hill-climb and must say so. |
| **UI (optional demo)** | `/study` and labs make the study tangible. | Interview time stays on pipeline + README Result — not routes or product chrome. |

### App surface (only if they ask to click around)

Skip in a DS interview. If someone wants a demo: open `/study` first; other labs are optional. Do not spend pitch time on worker protocol, QbLab extraction, or route layout.


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
| **No future peeking** | Yes (clean path) | `projections.snapshotBefore`, schedule opponents, `synthetic-prior-season@1`; shipped slate used future info — **labelled** and not in the clean pool |
| **Validation / data integrity** | Strong | Scoring missing≠0; inactive vs missing status; publish config equality checks; CSV required columns |
| **Separation of concerns** | Strong | Pipeline vs domain vs UI; solver API shared; study page reads published JSON only |
| **Testability** | Strong | `tests/domain/*` (solver oracle, projections, runner, publish); `docs-agreement.test.ts` pins README; `test:ui` + Playwright e2e |
| **Observability / honesty** | Strong | Proven vs heuristic labels; feed freshness status; README What failed; exclusion reasons on weeks |
| **Uncertainty / honesty about noise** | Good | Percentile bands over **weeks** (not players); labelled as descriptive, not a formal significance test |
| **Interview explainability** | Improved by this doc | Still: mega-routes and long `IMPLEMENTATION_PROGRESS` are chronical, not a pitch—use this notebook first |
| **Miss: sealed future season** | Gap | 2025 was already looked at; not a secret holdout. Say so. |
| **Miss: market salaries** | Gap | Synthetic bands from prior PPG—fine for method comparison, not for DFS edge claims. |
| **Miss: stack constraint in exact solver** | Gap | Documented; UI fallback labelled as a guess, not a proof. |

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
- `scripts/lib/study/inputs.ts` — download + SHA-256 pin so reruns use the same files
- `scripts/lib/study/publish.ts` — seasons file + manifest

### Domain (shared)
- `src/lib/optimizer.ts` — exact solver + labelled guesses
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

0. **No fake DK prices in the pitch.** Salary-cap / Pts-per-dollar / exact-vs-greedy-under-synthetic-cap are retired from the claim.
1. **Missing short design notebook** — addressed by this file; README should link it.
2. **Lead with failures, not just wins** — already in README; practice the oral version (see below).
3. **Don't claim holdout or DFS edge** — roles and synthetic salaries are correct in docs; keep language tight in interviews.

### Should-improve (follow-up — data science, not UI chrome)
1. **UI follow-ups: won’t-do for the DS pitch.** Mega-route split already landed. Further `QbLab` extraction / UI polish is out of scope unless Bryan asks — interview time stays on study rules, Result, and What failed.
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

**Title-ish:** Leakage-controlled multi-season evaluation of NFL fantasy projections (TypeScript).

**Bullets:**
- Built a multi-season projection eval with no future-data cheating: prior-season player pools, projections from earlier weeks only, same weeks for every method.
- Compared simple explainable projection methods on player MAE; shrinkage best, trailing mean second — without claiming market salaries or a salary-cap edge.
- Pinned study inputs and made CI rebuild the README numbers from those runs.
- Wrote up and fixed real evaluation bugs (scoring mistake, opponent adjustment using the wrong group, a look-ahead slate kept only as a comparison); dropped synthetic-price cap framing from the pitch.

**What not to claim:** Live DraftKings salaries or $50k edge; that 2025 is a sealed holdout; that a simple average is a strong forecast.

## Glossary (quick)

| Term | Meaning here |
|---|---|
| **Proven** | Exact solver found the true best roster under the stated rules |
| **Heuristic** | Greedy / hill-climb; not a proof |
| **Look-ahead** | Universe or features used information from after the prediction cutoff |
| **Common weeks** | Weeks where every compared model produced a complete lineup actual |
| **Development / retrospective** | Tuned-on vs looked-at-before; neither is a secret future holdout |
