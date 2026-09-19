import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import {
  BetterGuesses,
  DidItHelp,
  EwmaSweep,
  HotQbs,
  TooOptimistic,
  WhatWentWrong,
  developmentSeasons,
  lag,
  lastSeasonYear,
  lookBackSeasons,
  main,
  mainLabel,
  seasonList,
  study,
  views,
} from "@/components/study";

export const Route = createFileRoute("/study")({ component: StudyPage });

function StudyPage() {
  const [viewKey, setViewKey] = useState(views.find((v) => v.key === String(lastSeasonYear))?.key ?? views[0]?.key ?? "");
  const view = views.find((v) => v.key === viewKey) ?? views[0];
  const ready = Boolean(main && view && lag.n > 0);

  return (
    <AppShell>
      <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <p className="text-sm text-muted">
          <Link to="/" className="hover:text-fg">
            Home
          </Link>
        </p>
        <h1 className="mt-3 font-display text-5xl uppercase tracking-[0.03em]">Study</h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
          A leakage-controlled check on past seasons: how well do pregame point projections miss
          player by player, and does last week’s QB number predict this week? Salary-cap lineups are
          not the study claim.
        </p>

        {!ready || !main || !view ? (
          <p className="mt-10 text-sm text-muted">Loading the study…</p>
        ) : (
          <>
            <section className="mt-10">
              <h2 className="font-display text-2xl uppercase tracking-[0.04em]">What this is</h2>
              <p className="mt-3 text-sm leading-relaxed">
                This page publishes a leakage-controlled evaluation of{" "}
                <strong className="font-medium text-fg">fantasy point projections</strong> on NFL
                player-week data ({seasonList}). The science claim is projection quality — player MAE
                and honesty about failures — not a salary cap or DraftKings result. The Lineup page is
                a separate demo that uses illustrative synthetic salaries; those prices are{" "}
                <strong className="font-medium text-fg">not</strong> part of this study claim.
              </p>
            </section>

            <section className="mt-10">
              <h2 className="font-display text-2xl uppercase tracking-[0.04em]">Two questions</h2>
              <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm leading-relaxed">
                <li>
                  Which projection methods miss less player by player (MAE), and do “smarter” guesses
                  actually help on the same weeks and pools?
                </li>
                <li>
                  If a quarterback looked good last week (EPA or CPOE), did he look good this week
                  too?
                </li>
              </ol>
            </section>

            <section className="mt-10">
              <h2 className="font-display text-2xl uppercase tracking-[0.04em]">How we tested</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
                <li>
                  Weeks {view.row.weeks.from}–{view.row.weeks.to} of each season. Week 1 is skipped:
                  nobody has a game to average yet.
                </li>
                <li>
                  Each season gets its own pool of players built only from the season before (top
                  players by points per game, frozen before week 1). Rookies and offseason trades are
                  missing. Older committed runs may still carry synthetic salary bands for
                  archaeology; those prices are not real DraftKings salaries and are not part of the
                  study claim.
                </li>
                <li>
                  A player’s guess uses only games before that week. His opponent comes from the
                  schedule, not from the box score after the game.
                </li>
                <li>
                  The computer must prove its team is the best one for the guesses. If it can’t, or
                  a picked player’s score is missing, that week is thrown out for every method.
                  {main.excludedWeeks.length === 0 ? " No week was thrown out." : ` ${main.excludedWeeks.length} weeks were thrown out.`}
                </li>
                <li>
                  {developmentSeasons.length ? `${developmentSeasons.join(" and ")} came first. ` : ""}
                  We changed no setting after seeing them.{" "}
                  {lookBackSeasons.length
                    ? `${lookBackSeasons.join(" and ")} is a look back, not a fresh test: we had already studied it.`
                    : ""}
                </li>
                <li>
                  Scoring is our simplified DraftKings-style PPR. A defense’s points allowed is the
                  other team’s final score.
                </li>
              </ul>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                Three kinds of numbers show up in this app. A <em>forecast</em> is the guess before
                kickoff. A <em>look back</em> (this page) scores those guesses after the fact.{" "}
                <em>Hindsight</em> on the Lineup demo rebuilds a team from points already scored, so
                it is not a forecast at all — and that demo’s salaries are not the study claim.
              </p>
            </section>

            <DidItHelp view={view} setViewKey={setViewKey} summary={main} label={mainLabel} />

            <TooOptimistic view={view} summary={main} label={mainLabel} />

            <BetterGuesses summary={main} label={mainLabel} />

            <EwmaSweep />

            <HotQbs />

            <WhatWentWrong />

            <p className="mt-10 text-xs leading-relaxed text-muted">
              Every number on this page is read from files the study pipeline writes: runs{" "}
              {[...study.seasons, ...(study.shippedSlate ? [study.shippedSlate] : [])]
                .map((s) => `${s.season}${s.universe.lookAhead ? " shipped" : ""} ${s.runId}`)
                .join(", ")}
              . The README lists the commands. docs/study/REGENERATION_REPORT.md explains how these
              numbers differ from earlier versions of this page.
            </p>
          </>
        )}
      </article>
    </AppShell>
  );
}
