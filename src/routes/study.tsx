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
          A check on past seasons. Did the Lineup computer actually help, and does last week’s QB
          number predict this week?
        </p>

        {!ready || !main || !view ? (
          <p className="mt-10 text-sm text-muted">Loading the study…</p>
        ) : (
          <>
            <section className="mt-10">
              <h2 className="font-display text-2xl uppercase tracking-[0.04em]">What this is</h2>
              <p className="mt-3 text-sm leading-relaxed">
                Fantasy lineups here have a <strong className="font-medium text-fg">$50,000 budget</strong>,
                like DraftKings. You pick 9 players. Stars cost more. The Lineup page has a computer
                that builds a team under that budget. This page is not a live tool. It replays the{" "}
                {seasonList} seasons: before each week we guessed every player’s points, let the
                computer pick, then scored the team on the points the players actually got that week.
              </p>
            </section>

            <section className="mt-10">
              <h2 className="font-display text-2xl uppercase tracking-[0.04em]">Two questions</h2>
              <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm leading-relaxed">
                <li>
                  After the games, did the computer’s $50k team score more points than just taking
                  the highest-projected names that still fit the budget?
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
                  Each season gets its own pool of players and fake prices, built only from the
                  season before: the top players by points per game, priced on a straight line of
                  that average. Frozen before week 1. Rookies and offseason trades are missing.
                  These are not real DraftKings salaries.
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
                kickoff. A <em>look back</em> (this page) scores those guesses after the fact. <em>Hindsight</em>{" "}
                on the Lineup page rebuilds a team from points already scored, so it is not a forecast
                at all.
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
