import { CalendarDays, Check, Database, Lock, Scale, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Block, Eyebrow, SectionTitle } from "./parts";
import { developmentSeasons, lookBackSeasons, main, study, views } from "./shared";

function Rule({ icon, title, children }: { icon: ReactNode; title: ReactNode; children: ReactNode }) {
  return (
    <li className="rounded-[18px] bg-surface p-5 shadow-[var(--shadow-border)]">
      <span className="grid size-9 place-items-center rounded-[10px] bg-panel-2 text-fg [&_svg]:size-[18px]" aria-hidden>
        {icon}
      </span>
      <h3 className="mt-3.5 text-base font-semibold">{title}</h3>
      <p className="mt-1.5 text-[15px] text-muted">{children}</p>
    </li>
  );
}

/** "Why the number is fair": the study's rules, one card each. */
export function FairRules() {
  const first = views[0]?.row;
  const poolSizes = [...new Set(study.seasons.map((s) => s.universe.players))];
  const excluded = main?.excludedWeeks.length ?? 0;
  return (
    <Block id="fair">
      <Eyebrow>Why the number is fair</Eyebrow>
      <SectionTitle>No method got to see the future, and every method faced the same test.</SectionTitle>
      <p className="mt-3.5 max-w-[44em] text-[17px] text-muted">
        Two questions drive the study:{" "}
        <b className="font-semibold text-fg">which projection methods miss less, player by player</b>, and{" "}
        <b className="font-semibold text-fg">does a quarterback who looked good last week look good this week too?</b>{" "}
        These rules apply to both.
      </p>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Rule icon={<CalendarDays />} title={first ? `Weeks ${first.weeks.from}–${first.weeks.to} only` : "Week 1 skipped"}>
          Week 1 is skipped: nobody has a game to average yet.
        </Rule>
        <Rule icon={<Users />} title="Player pools from last season">
          Each season gets its own pool
          {poolSizes.length === 1 ? ` of ${poolSizes[0]} players` : ""}, built only from the season before (the top
          players by points per game, frozen before week 1). Rookies and offseason trades are missing. Older
          committed runs may still carry synthetic salary bands for archaeology; those prices are not real
          DraftKings salaries and are not part of the study claim.
        </Rule>
        <Rule icon={<Lock />} title="Only earlier games">
          A player’s guess uses only games before that week. His opponent comes from the schedule, not from the box
          score after the game.
        </Rule>
        <Rule icon={<Scale />} title="Same weeks for every method">
          The computer must prove its team is the best one for the guesses. If it can’t, or a picked player’s score
          is missing, that week is thrown out for every method.
          {excluded === 0 ? " No week was thrown out." : ` ${excluded} weeks were thrown out.`}
        </Rule>
        <Rule icon={<Check />} title="Nothing tuned after the fact">
          {developmentSeasons.length ? `${developmentSeasons.join(" and ")} came first. ` : ""}
          We changed no setting after seeing them.
          {lookBackSeasons.length
            ? ` ${lookBackSeasons.join(" and ")} is a look back, not a fresh test: we had already studied it.`
            : ""}
        </Rule>
        <Rule icon={<Database />} title="One scoring rule">
          Scoring is our simplified DraftKings-style PPR. A defense’s points allowed is the other team’s final score.
        </Rule>
      </ul>
      <p className="mt-5 max-w-[52em] text-[15px] text-muted">
        Three kinds of numbers show up in this app. A <em>forecast</em> is the guess before kickoff. A{" "}
        <em>look back</em> (this page) scores those guesses after the fact. <em>Hindsight</em> on the Lineup demo
        rebuilds a team from points already scored, so it is not a forecast at all, and that demo’s salaries are not
        the study claim.
      </p>
    </Block>
  );
}
