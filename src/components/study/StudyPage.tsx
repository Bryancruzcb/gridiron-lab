import { FileWarning, Inbox, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { BetterGuesses } from "./BetterGuesses";
import { DidItHelp } from "./DidItHelp";
import { EwmaSweep } from "./EwmaSweep";
import { FairRules } from "./FairRules";
import { Hero } from "./Hero";
import { HotQbs } from "./HotQbs";
import { buildStudyHome, type StudyHome } from "./home.ts";
import { Block, Eyebrow, SectionTitle } from "./parts";
import { lastSeasonYear, main, mainLabel, study, views } from "./shared";
import { TooOptimistic } from "./TooOptimistic";
import { WhatWentWrong } from "./WhatWentWrong";

/** Computed once: the study files ship with the page, so there is nothing to fetch. */
const homeState = buildStudyHome(study);

/** Published projection study. This is the first screen and `/study`. */
export function StudyPage() {
  return (
    <AppShell>
      {homeState.kind === "ready" ? (
        <StudyHomeView home={homeState.home} />
      ) : homeState.kind === "empty" ? (
        <StateBox icon={<Inbox />} title="No study runs published yet">
          <p>The results appear here once the study pipeline writes its season files. The README lists the commands that build them.</p>
        </StateBox>
      ) : (
        <StateBox icon={<FileWarning />} title="The study files could not be read" alert>
          <p>Error: {homeState.message}. No numbers are shown, and nothing on this page is guessed in their place.</p>
        </StateBox>
      )}
    </AppShell>
  );
}

function StateBox({ icon, title, alert, children }: { icon: ReactNode; title: string; alert?: boolean; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <div
        role={alert ? "alert" : undefined}
        className="mx-auto my-16 max-w-[560px] rounded-[24px] bg-surface px-7 py-10 text-center shadow-[var(--shadow-border)] sm:my-[72px]"
      >
        <span
          className={
            alert
              ? "inline-grid size-[52px] place-items-center rounded-2xl bg-rust-soft text-rust [&_svg]:size-6"
              : "inline-grid size-[52px] place-items-center rounded-2xl bg-panel [&_svg]:size-6"
          }
          aria-hidden
        >
          {icon}
        </span>
        <h1 className="mt-[18px] font-display text-[32px] leading-[1.1]">{title}</h1>
        <div className="mt-2.5 space-y-2.5 text-muted">
          {children}
          <p>The $50k lineup in this app is a demo with synthetic salaries. It is not part of this study.</p>
        </div>
      </div>
    </div>
  );
}

function StudyHomeView({ home }: { home: StudyHome }) {
  const [viewKey, setViewKey] = useState(views.find((v) => v.key === String(lastSeasonYear))?.key ?? views[0]?.key ?? "");
  const view = views.find((v) => v.key === viewKey) ?? views[0];
  const shrinkK = study.models.find((m) => m.method === "shrink")?.params.k;
  const ewmaLabel = study.models.find((m) => m.method === "ewma")?.label ?? "EWMA";

  return (
    <>
      <Hero home={home} />
      <FairRules />
      <BetterGuesses home={home} />
      <HotQbs />

      <Block id="archive">
        <Eyebrow>Archive</Eyebrow>
        <SectionTitle>The old lineup experiment, kept for the record.</SectionTitle>
        <div className="mt-2 rounded-[22px] bg-panel-2 px-4 py-6 sm:rounded-[28px] sm:p-10">
          <p className="flex max-w-[52em] items-start gap-2.5 rounded-[14px] bg-surface px-4 py-3.5 text-[15px] shadow-[var(--shadow-border)]">
            <TriangleAlert className="mt-0.5 size-[18px] shrink-0 text-warn" aria-hidden />
            <span>
              <b className="font-semibold">Not the study claim.</b> These lineup comparisons used a demo $50k salary cap
              and synthetic prices, not real DraftKings salaries. The pitch is projection miss per player, above.
            </span>
          </p>
          {main ? <DidItHelp summary={main} label={mainLabel} /> : null}
          {main && view ? <TooOptimistic view={view} setViewKey={setViewKey} summary={main} label={mainLabel} /> : null}
          <EwmaSweep />
        </div>
      </Block>

      <WhatWentWrong />

      <Block id="words">
        <Eyebrow>Words used on this page</Eyebrow>
        <dl className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <Term name="Miss per player (MAE)">
            Mean absolute error: the average of |guess − real points| over every played player-week.
          </Term>
          <Term name="Shrink to position">
            A player’s average so far, pulled toward the pool’s average for his position
            {shrinkK != null ? ` as if he had ${shrinkK} extra average games` : ""}.
          </Term>
          <Term name="Trailing mean">
            The player’s average over every earlier week this season. “The computer” on this page uses it.
          </Term>
          <Term name={ewmaLabel.replace(/=.*$/, "").trim() + " α"}>
            A weighted average where α sets how much last week counts. α near 1 means mostly last week.
          </Term>
          <Term name="EPA per throw">Expected points added: how much each pass changed the team’s expected score.</Term>
          <Term name="CPOE">Completion percentage over expected, given how hard each throw was.</Term>
        </dl>
      </Block>

      <div className="border-t border-border">
        <p className="mx-auto max-w-6xl px-4 pt-8 pb-2 text-sm break-words text-muted sm:px-6">
          Every number on this page is read from files the study pipeline writes: runs{" "}
          {[...study.seasons, ...(study.shippedSlate ? [study.shippedSlate] : [])]
            .map((s) => `${s.season}${s.universe.lookAhead ? " shipped" : ""} ${s.runId}`)
            .join(", ")}
          . The README lists the commands. docs/study/REGENERATION_REPORT.md explains how these numbers differ from
          earlier versions of this page.
        </p>
      </div>
    </>
  );
}

function Term({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[15px] font-semibold">{name}</dt>
      <dd className="mt-1 text-sm text-muted">{children}</dd>
    </div>
  );
}
