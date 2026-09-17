import { memo } from "react";
import { Lock, Ban } from "lucide-react";
import { Headshot } from "@/components/Headshot";
import type { FantasyPlayer } from "@/data/types";
import type { LineupMode } from "@/lib/lineup/selection";
import { teamNick } from "@/lib/nfl";
import { cn, formatNum } from "@/lib/utils";

type PlayerRowsProps = {
  rows: FantasyPlayer[];
  lockedIds: ReadonlySet<string>;
  excludedIds: ReadonlySet<string>;
  actuals: ReadonlyMap<string, number> | null;
  notFinal: ReadonlySet<string>;
  mode: LineupMode;
  onLock: (id: string) => void;
  onBench: (id: string) => void;
};

/** Memoized so solve status changes re-render the sidebar, not the page of player rows. */
export const PlayerRows = memo(function PlayerRows({ rows, lockedIds, excludedIds, actuals, notFinal, mode, onLock, onBench }: PlayerRowsProps) {
  return (
    <tbody>
      {rows.map((p) => {
        const isL = lockedIds.has(p.id);
        const isX = excludedIds.has(p.id);
        const val = p.proj / (p.salary / 1000);
        const act = actuals?.get(p.id);
        const lockUnusable = isL && mode === "actual" && act == null;
        return (
          <tr
            key={p.id}
            data-player-id={p.id}
            className={cn(
              "border-b border-border/70",
              isX && "opacity-40",
              isL && "bg-elevated",
            )}
          >
            <td className="px-4 py-2">
              <div className="flex items-center gap-2.5">
                <Headshot src={p.headshot} name={p.name} team={p.team} className="size-8" />
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="text-xs text-muted">{teamNick(p.team)}</p>
                </div>
              </div>
            </td>
            <td className="px-2 py-2 text-muted">{p.pos}</td>
            <td className="px-2 py-2 text-right font-mono tabular-nums">{p.proj.toFixed(1)}</td>
            <td
              className={cn(
                "px-2 py-2 text-right font-mono tabular-nums",
                act == null ? "text-subtle" : act >= p.proj ? "text-sage" : "text-muted",
              )}
            >
              {act == null ? "—" : act.toFixed(1)}
              {act != null && notFinal.has(p.id) ? <span className="text-subtle">*</span> : null}
            </td>
            <td className="px-2 py-2 text-right font-mono tabular-nums text-muted">
              ${formatNum(p.salary)}
            </td>
            <td className="px-2 py-2 text-right font-mono tabular-nums text-subtle">
              {val.toFixed(2)}
            </td>
            <td className="px-3 py-2">
              <div className="flex justify-end gap-1">
                <button
                  type="button"
                  aria-label={isL ? "Unlock" : "Lock into lineup"}
                  aria-pressed={isL}
                  title={
                    lockUnusable
                      ? "Locked, but no actual score yet, so hindsight can’t use him"
                      : isL
                        ? "Locked — always in the lineup"
                        : "Lock: force this player into the lineup"
                  }
                  onClick={() => onLock(p.id)}
                  className={cn(
                    "grid size-9 place-items-center rounded-sm",
                    lockUnusable
                      ? "bg-rust/20 text-rust"
                      : isL
                        ? "bg-sage/20 text-sage"
                        : "text-subtle hover:bg-elevated hover:text-fg",
                  )}
                >
                  <Lock className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={isX ? "Include" : "Bench / exclude"}
                  aria-pressed={isX}
                  title={isX ? "Benched — tap to put back in the pool" : "Bench: never pick this player"}
                  onClick={() => onBench(p.id)}
                  className={cn(
                    "grid size-9 place-items-center rounded-sm",
                    isX ? "bg-rust/20 text-rust" : "text-subtle hover:bg-elevated hover:text-fg",
                  )}
                >
                  <Ban className="size-3.5" />
                </button>
              </div>
            </td>
          </tr>
        );
      })}
    </tbody>
  );
});
