import { CircleCheck, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Block, Eyebrow, SectionTitle } from "./parts";
import { backtest, firstSeason, lastSeasonYear, lookBackSeasons, study } from "./shared";

type Item = { kind: "fixed" | "limit"; status: string; title: string; body: ReactNode };

function Entry({ item }: { item: Item }) {
  const Icon = item.kind === "fixed" ? CircleCheck : TriangleAlert;
  const tone = item.kind === "fixed" ? "text-sage" : "text-warn";
  return (
    <li className="grid grid-cols-[auto_1fr] gap-3 border-t border-border py-4 text-[15px]">
      <Icon className={cn("mt-[3px] size-[18px]", tone)} aria-hidden />
      <div>
        <span className={cn("text-[13px] font-semibold", tone)}>{item.status}</span>
        <b className="block font-semibold">{item.title}</b>
        {item.body}
      </div>
    </li>
  );
}

/** Mistakes found, fixed, or still lived with. Every item keeps the page's original wording. */
export function WhatWentWrong() {
  const s = backtest.summary;
  const shipped = study.shippedSlate;
  const inactive = study.policies.some((p) => p.includes("inactive"));
  const oppFloor = study.models.find((m) => m.method === "opp")?.params.clampLow ?? null;
  const items: Item[] = [
    {
      kind: "limit",
      status: "Removed from the claim",
      title: "Synthetic salaries.",
      body: "Synthetic demo salaries (not real DraftKings) were used in older salary-cap lineup comparisons. Those prices are frozen all season, miss rookies and offseason moves, and are not part of the study claim: the pitch is projection miss, not a $50k result.",
    },
    {
      kind: "limit",
      status: "Comparison only",
      title: "The shipped slate looks ahead.",
      body: `The 114-player ${shipped?.season ?? backtest.season} slate that ships with the Lineup page was picked and priced from that whole season, including weeks 14–18. That is look-ahead, so it is shown only for comparison, not as clean history. On that slate, the exact solver averaged ${s.exactMean} vs greedy-by-projection ${s.greedyProjMean} (beat greedy in ${s.exactBeatsProj} of ${s.weeks} weeks). Points-per-dollar and cheap-picks baselines were dropped from the study path.`,
    },
    {
      kind: "fixed",
      status: "Fixed",
      title: "The old solver cut corners.",
      body: "Earlier versions of this page ruled out a bug in the picker. There was one: the old exact solver quietly handed about a third of its solves to a rough fallback and still called the result exact. The fixed solver either proves its team is the best or the week is thrown out.",
    },
    {
      kind: "fixed",
      status: "Fixed",
      title: "Bye weeks and extra points.",
      body: "The old scripts left players on a bye on the slate (they scored 0 when picked), and counted every extra point twice when estimating a defense’s points allowed. Both are fixed, and every number here was rebuilt.",
    },
    ...(oppFloor != null
      ? [
          {
            kind: "fixed" as const,
            status: "Fixed",
            title: "Opponent adjustment compared the wrong groups.",
            body: `The first opponent-adjusted guess compared what an opponent gave up to every player at a position, backups included, against the average of only the pool’s top players. Most running backs, receivers and tight ends got the full ${Math.round((1 - oppFloor) * 100)}% cut whoever they played. It now compares each opponent with every opponent over the same players, and its numbers here were rebuilt.`,
          },
        ]
      : []),
    ...(inactive
      ? [
          {
            kind: "limit" as const,
            status: "Known limit",
            title: "Inactive counts as zero.",
            body: "A player with no stat line in a final game counts 0. The data can’t tell a benched player from one who played and recorded nothing.",
          },
        ]
      : []),
    {
      kind: "limit",
      status: "Known limit",
      title: "Small sample.",
      body: `${firstSeason && lastSeasonYear ? `Three seasons (${firstSeason}–${lastSeasonYear})` : "A few seasons"} is still a small sample, and ${lookBackSeasons.join(" and ") || "the last season"} had been studied before. A good EPA week barely predicts the next one, and week 1 of 2026 is still a tiny sample in the live labs.`,
    },
  ];
  return (
    <Block id="wrong">
      <Eyebrow>What went wrong</Eyebrow>
      <SectionTitle>Mistakes we found, fixed, or still live with.</SectionTitle>
      <ul className="mt-7 grid gap-x-10 gap-y-3.5 md:grid-cols-2">
        {items.map((item) => (
          <Entry key={item.title} item={item} />
        ))}
      </ul>
    </Block>
  );
}
