import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { pageItems } from "@/lib/paging";
import { cn } from "@/lib/utils";

export function Pager({
  page,
  pages,
  pageSize,
  total,
  onPage,
  noun,
  where,
  className,
}: {
  page: number;
  pages: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  noun: string;
  where: "top" | "bottom";
  className?: string;
}) {
  if (pages <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const step =
    "grid h-9 min-w-8 place-items-center rounded-sm px-2 text-sm text-muted transition-colors hover:bg-elevated hover:text-fg disabled:pointer-events-none disabled:opacity-35 sm:min-w-9";
  return (
    <nav
      aria-label={`${noun} pages, ${where}`}
      data-testid={`pager-${where}`}
      className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2", className)}
    >
      <p className="text-xs text-muted tabular-nums">
        {from}–{to} of {total} {noun}
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" className={cn(step, "hidden sm:grid")} onClick={() => onPage(1)} disabled={page === 1} aria-label="First page">
          <ChevronsLeft className="size-4" />
        </button>
        <button type="button" className={step} onClick={() => onPage(page - 1)} disabled={page === 1} aria-label="Previous page">
          <ChevronLeft className="size-4" />
        </button>
        {pageItems(page, pages).map((p, i) =>
          p === null ? (
            <span key={`gap-${i}`} aria-hidden className="px-1 text-subtle">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onPage(p)}
              aria-label={`Page ${p}`}
              aria-current={p === page ? "page" : undefined}
              className={cn(step, "font-mono tabular-nums", p === page && "bg-accent text-accent-fg hover:bg-accent hover:text-accent-fg")}
            >
              {p}
            </button>
          ),
        )}
        <button type="button" className={step} onClick={() => onPage(page + 1)} disabled={page === pages} aria-label="Next page">
          <ChevronRight className="size-4" />
        </button>
        <button type="button" className={cn(step, "hidden sm:grid")} onClick={() => onPage(pages)} disabled={page === pages} aria-label="Last page">
          <ChevronsRight className="size-4" />
        </button>
      </div>
    </nav>
  );
}
