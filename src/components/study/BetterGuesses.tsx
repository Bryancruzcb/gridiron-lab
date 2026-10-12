import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StudyHome } from "./home.ts";
import { Block, Caption, SectionTitle, TableCard, Tag } from "./parts";
import { td, tdR, th, thR } from "./table";
import {
  COMPUTER,
  EWMA,
  countWord,
  developmentSeasons,
  fix,
  overComputer,
  projections,
  range,
  signed,
  study,
  thousands,
  verdict,
} from "./shared";

/** Question 1 in detail: every method, ranked by player miss (the study claim). */
export function BetterGuesses({ home }: { home: StudyHome }) {
  const rows = home.methods;
  const best = home.best;
  const bestTeam = [...rows].sort((a, b) => b.team - a.team)[0]!;
  const ewmaRow = rows.find((r) => r.id === EWMA);
  const ewmaSeasons = study.seasons.filter((s) => overComputer(s.summary, EWMA).mean > 0).length;
  const shippedTrail = projections.models.find((m) => m.id === COMPUTER);
  const shippedEwma = projections.models.find((m) => m.id === EWMA);
  const shippedBestMae = [...projections.models].sort((a, b) => a.mae - b.mae)[0];
  const shippedBestTeam = [...projections.models].sort((a, b) => b.lineupMean - a.lineupMean)[0];

  return (
    <Block id="methods">
      <SectionTitle>
        {countWord(rows.length).replace(/^./, (c) => c.toUpperCase())} ways to guess next week, ranked by how far
        they missed.
      </SectionTitle>
      <p className="mt-3.5 max-w-[44em] text-[17px] text-muted">
        Same weeks and pools; only the guess changed. Team score comes from the retired salary-cap demo with
        synthetic prices and is not the claim.
      </p>
      <TableCard className="mt-8">
        <table className="w-full min-w-[560px] border-collapse text-[15px]">
          <thead>
            <tr>
              <th className={th}>Guess method ({home.label})</th>
              <th className={thR}>Miss per player</th>
              <th className={thR}>Team score</th>
              <th className={thR}>vs trailing mean</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={td}>
                  {r.label}{" "}
                  {r.id === best.id ? (
                    <Tag tone="good" icon={<Check aria-hidden />}>
                      Best miss
                    </Tag>
                  ) : null}
                </td>
                <td className={cn(tdR, r.id === best.id && "font-semibold text-sage")}>{fix(r.mae, 2)}</td>
                <td className={tdR}>{fix(r.team, 1)}</td>
                <td className={tdR}>
                  {r.gap ? (
                    <>
                      {signed(r.gap.mean)} <span className="text-[13px] text-muted">({range(r.gap)})</span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
      <Caption>
        “vs trailing mean”: the weekly team-score gap to the trailing mean, with its 95% range.
      </Caption>
      <div className="mt-6 gap-10 text-base md:columns-2 [&>p]:mb-3 [&>p]:break-inside-avoid">
        {home.bestEverywhere ? (
          <p>
            <b className="font-semibold">{best.label} was best in every season and on the shipped slate.</b>
          </p>
        ) : null}
        <p>
          Player by player the trailing mean is not biased: over {thousands(home.playerWeeks)} player-weeks its average
          miss was {signed(home.trailBias, 2)} points. That does not make it a strong forecast.
        </p>
        <p className="text-muted">
          {best.id === bestTeam.id
            ? "It also built the best teams."
            : `Missing less per player is not the same as a better team: ${best.label}’s teams averaged ${fix(best.team, 1)}, while ${bestTeam.label} built the best ones (${fix(bestTeam.team, 1)}).`}{" "}
          {bestTeam.id === EWMA && ewmaRow?.gap
            ? `EWMA beat the trailing mean in ${ewmaSeasons} of ${study.seasons.length} seasons, by ${signed(ewmaRow.gap.mean)} a week overall (range ${range(ewmaRow.gap)}; ${verdict(ewmaRow.gap)}). Its α=0.35 is a leftover default from the first 2025 scripts, not a setting we tuned on ${developmentSeasons.join(" and ") || "earlier seasons"}.`
            : ""}
        </p>
        {shippedTrail && shippedEwma && shippedBestMae && shippedBestTeam ? (
          <p className="text-muted">
            On the shipped {projections.season} slate the story shifts: {shippedBestMae.label}{" "}
            {shippedBestMae.id === best.id ? "still " : ""}missed least ({fix(shippedBestMae.mae, 2)}),{" "}
            {shippedBestTeam.label} built the best teams ({fix(shippedBestTeam.lineupMean, 1)}), and EWMA scored{" "}
            {fix(shippedEwma.lineupMean, 1)} against the trailing mean’s {fix(shippedTrail.lineupMean, 1)}. One pool
            and one season can flip a ranking.
          </p>
        ) : null}
      </div>
    </Block>
  );
}
