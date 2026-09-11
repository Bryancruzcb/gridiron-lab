import { useState } from "react";
import { initials, teamColor } from "@/lib/nfl";
import { cn } from "@/lib/utils";

export function Headshot({
  src,
  name,
  team,
  className,
}: {
  src: string | null;
  name: string;
  team: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div
        className={cn(
          "grid shrink-0 place-items-center rounded-full text-[10px] font-semibold text-fg",
          className ?? "size-9",
        )}
        style={{ background: teamColor(team) }}
        aria-hidden
      >
        {initials(name)}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      className={cn("shrink-0 rounded-full bg-elevated object-cover object-top", className ?? "size-9")}
      onError={() => setFailed(true)}
    />
  );
}
