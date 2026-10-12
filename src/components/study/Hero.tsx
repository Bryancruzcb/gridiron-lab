import { ArrowRight, Check } from "lucide-react";
import { useState } from "react";
import { DemoNote } from "@/components/DemoNote";
import { cn } from "@/lib/utils";
import { COMPUTER, fix, thousands } from "./calc.ts";
import { axisPercent, type StudyHome } from "./home.ts";

/** The finding in plain words, as the page's first line. */
function headline(home: StudyHome): string {
  if (home.best.id === "shrink") return "Pulling each guess toward the position average missed least.";
  if (home.best.id === COMPUTER) return "A plain season average missed least.";
  return `${home.best.label} missed least.`;
}

export function Hero({ home }: { home: StudyHome }) {
  const trail = home.methods.find((m) => m.id === COMPUTER);
  const last1 = home.methods.find((m) => m.id === "last1");
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <div className="grid items-center gap-9 pt-10 pb-12 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:pt-16 lg:pb-14">
        <div>
          <p className="text-sm font-semibold tracking-[0.02em] text-sage">NFL projection study, {home.label}</p>
          <h1 className="mt-3.5 font-display text-[clamp(40px,5.2vw,64px)] leading-[1.1]">{headline(home)}</h1>
          <p className="mt-5 max-w-[34em] text-[17px] text-muted sm:text-lg">
            We guessed every player’s fantasy points each week using only earlier games, then checked the
            guesses against what really happened. Over{" "}
            <b className="font-semibold text-fg tabular-nums">{thousands(home.playerWeeks)}</b> player-weeks,{" "}
            <b className="font-semibold text-fg">{home.best.label}</b> missed by{" "}
            <b className="font-semibold text-fg tabular-nums">{fix(home.best.mae, 2)}</b> points on average.
            {trail && trail.id !== home.best.id ? (
              <>
                {" "}
                A plain season average missed by <span className="tabular-nums">{fix(trail.mae, 2)}</span>.
              </>
            ) : null}
            {last1 && last1.id !== home.best.id ? (
              <>
                {" "}
                Using only last week missed by <span className="tabular-nums">{fix(last1.mae, 2)}</span>.
              </>
            ) : null}
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a
              href="#fair"
              className="inline-flex min-h-12 items-center gap-2 rounded-full bg-accent px-6 font-semibold text-accent-fg transition-transform duration-150 hover:-translate-y-px motion-reduce:transition-none"
            >
              How we kept it fair <ArrowRight className="size-[18px]" aria-hidden />
            </a>
            <a
              href="#wrong"
              className="inline-flex min-h-12 items-center rounded-full bg-surface px-6 font-semibold text-fg shadow-[var(--shadow-border)] transition-transform duration-150 hover:-translate-y-px motion-reduce:transition-none"
            >
              What went wrong
            </a>
          </div>
          <DemoNote className="mt-6" />
        </div>
        <div className="rounded-[22px] bg-panel p-3 sm:rounded-[28px] sm:p-7">
          <MissChart home={home} />
        </div>
      </div>
    </div>
  );
}

/** Average miss per player-week for every method, one season at a time. */
export function MissChart({ home }: { home: StudyHome }) {
  const [key, setKey] = useState(home.views[0]!.key);
  const view = home.views.find((v) => v.key === key) ?? home.views[0]!;
  return (
    <figure aria-labelledby="miss-title" className="m-0 rounded-[20px] bg-surface p-[18px] shadow-[var(--shadow-float)] sm:p-6">
      <h2 id="miss-title" className="text-base font-semibold">
        Average miss per player-week
      </h2>
      <p className="mt-0.5 text-sm text-muted">Fantasy points, lower is better.</p>
      <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Season for the miss chart">
        {home.views.map((v) => (
          <button
            key={v.key}
            type="button"
            aria-pressed={v.key === view.key}
            onClick={() => setKey(v.key)}
            className={cn(
              "min-h-9 rounded-full px-3.5 text-sm font-medium",
              v.key === view.key ? "bg-fg text-bg" : "text-muted shadow-[var(--shadow-border)] hover:text-fg",
            )}
          >
            {v.pill}
          </button>
        ))}
      </div>
      <ol className="mt-[18px] tabular-nums">
        {home.methods.map((m) => {
          const mae = view.mae[m.id]!;
          const best = m.id === view.bestId;
          return (
            <li
              key={m.id}
              className="grid grid-cols-[1fr_3em] items-center gap-x-2 gap-y-1 py-1.5 text-sm sm:min-h-[34px] sm:grid-cols-[12.6em_1fr_3.2em] sm:gap-3 sm:py-0"
            >
              <span className="col-start-1 row-start-1 flex items-center gap-1.5 whitespace-nowrap">
                {m.label}
                {best ? (
                  <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-sage">
                    <Check className="size-3.5" aria-hidden />
                    Best
                  </span>
                ) : null}
              </span>
              <span className="relative col-span-2 row-start-2 h-2.5 rounded-full bg-track sm:col-span-1 sm:col-start-2 sm:row-start-1" aria-hidden>
                <i
                  className={cn(
                    "dot-slide absolute top-1/2 -mt-[7px] -ml-[7px] size-3.5 rounded-full",
                    best ? "bg-accent shadow-[0_0_0_4px_var(--color-sage-soft)]" : "bg-data-soft",
                  )}
                  style={{ left: `${axisPercent(mae, home.scale)}%` }}
                />
              </span>
              <span className="col-start-2 row-start-1 text-right font-semibold sm:col-start-3">{fix(mae, 2)}</span>
            </li>
          );
        })}
      </ol>
      <div
        className="mt-1.5 grid grid-cols-[0_1fr_0] text-xs text-muted tabular-nums sm:grid-cols-[12.6em_1fr_3.2em] sm:gap-3"
        aria-hidden
      >
        <span />
        <span className="relative h-[18px]">
          {home.scale.ticks.map((t) => (
            <span key={t} className="absolute -translate-x-1/2" style={{ left: `${axisPercent(t, home.scale)}%` }}>
              {t.toFixed(1)}
            </span>
          ))}
        </span>
        <span />
      </div>
      <p className="mt-3.5 border-t border-border pt-3.5 text-sm text-muted">
        {view.title} ({view.note}): {view.weeks} weeks, {thousands(view.playerWeeks)} player-weeks.
      </p>
    </figure>
  );
}
