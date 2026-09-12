import { useEffect, useRef, useState } from "react";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type CopyState = { kind: "idle" } | { kind: "copied"; url: string } | { kind: "manual"; url: string };

/**
 * Copies a link to the analysis on screen. Where the clipboard is missing or refused, the link is
 * shown selected so it can be copied by hand. Feedback goes through a polite live region.
 */
export function CopyLink({ getUrl, label = "Copy link", className }: { getUrl: () => string; label?: string; className?: string }) {
  const [state, setState] = useState<CopyState>({ kind: "idle" });
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.kind === "manual") field.current?.select();
    if (state.kind !== "copied") return;
    const id = window.setTimeout(() => setState({ kind: "idle" }), 4000);
    return () => window.clearTimeout(id);
  }, [state]);

  const copy = async () => {
    const url = getUrl();
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(url);
      setState({ kind: "copied", url });
    } catch {
      setState({ kind: "manual", url });
    }
  };

  return (
    <div className={cn("flex flex-col gap-1.5", className)} data-testid="copy-link" data-url={state.kind === "idle" ? undefined : state.url}>
      <Button type="button" variant="secondary" size="sm" onClick={() => void copy()}>
        <Link2 aria-hidden />
        {label}
      </Button>
      <p role="status" aria-live="polite" className={cn("text-xs text-muted", state.kind === "idle" && "sr-only")}>
        {state.kind === "copied" ? "Link copied." : state.kind === "manual" ? "Copying isn’t available here. The link is selected below; copy it by hand." : ""}
      </p>
      {state.kind === "manual" && (
        <input
          ref={field}
          readOnly
          value={state.url}
          aria-label="Link to this view"
          data-testid="copy-link-fallback"
          onFocus={(e) => e.currentTarget.select()}
          className="h-9 w-full min-w-0 rounded-sm bg-elevated px-2 font-mono text-xs text-fg shadow-[var(--shadow-border)]"
        />
      )}
    </div>
  );
}
