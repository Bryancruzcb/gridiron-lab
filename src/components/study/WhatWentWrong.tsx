import {
  backtest,
  firstSeason,
  lastSeasonYear,
  lookBackSeasons,
  study,
} from "./shared";

export function WhatWentWrong() {
  const s = backtest.summary;
  const shipped = study.shippedSlate;
  const inactive = study.policies.some((p) => p.includes("inactive"));
  const oppFloor = study.models.find((m) => m.method === "opp")?.params.clampLow ?? null;
  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl uppercase tracking-[0.04em]">What went wrong</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
        <li>
          Synthetic demo salaries (not real DraftKings) were used in older salary-cap lineup
          comparisons. Those prices are frozen all season, miss rookies and offseason moves, and are
          not part of the study claim — the pitch is projection MAE, not a $50k result.
        </li>
        <li>
          The 114-player {shipped?.season ?? backtest.season} slate that ships with the Lineup page was
          picked and priced from that whole season, including weeks 14–18. That is look-ahead, so it
          is shown here only for comparison. On it the computer averaged {s.exactMean}, top names{" "}
          {s.greedyProjMean} and cheap picks {s.greedyValueMean}; the computer beat top names in{" "}
          {s.exactBeatsProj} of {s.weeks} weeks.
        </li>
        <li>
          Earlier versions of this page ruled out a bug in the picker. There was one: the old exact
          solver quietly handed about a third of its solves to a rough fallback and still called the
          result exact. The fixed solver either proves its team is the best or the week is thrown out.
        </li>
        <li>
          The old scripts also left players on a bye on the slate (they scored 0 when picked), and
          counted every extra point twice when estimating a defense’s points allowed. Both are fixed,
          and every number here was rebuilt.
        </li>
        {oppFloor != null ? (
          <li>
            The first opponent-adjusted guess compared the wrong groups: what an opponent gave up to
            every player at a position, backups included, against the average of only the pool’s top
            players. Most running backs, receivers and tight ends got the full{" "}
            {Math.round((1 - oppFloor) * 100)}% cut whoever they played. It now compares each opponent
            with every opponent over the same players, and its numbers here were rebuilt.
          </li>
        ) : null}
        {inactive ? (
          <li>
            A player with no stat line in a final game counts 0. The data can’t tell a benched
            player from one who played and recorded nothing.
          </li>
        ) : null}
        <li>
          {firstSeason && lastSeasonYear ? `Three seasons (${firstSeason}–${lastSeasonYear}) ` : "A few seasons "}
          is still a small sample, and {lookBackSeasons.join(" and ") || "the last season"} had been
          studied before. A good EPA week barely predicts the next one, and week 1 of 2026 is still a
          tiny sample in the live labs.
        </li>
      </ul>
    </section>
  );
}
