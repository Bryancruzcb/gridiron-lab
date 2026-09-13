import { useMemo, useRef, useState } from "react";

/** Page numbers to show: first, last, the current page and its neighbours; null marks a gap. */
export function pageItems(page: number, pages: number): (number | null)[] {
  const keep = new Set<number>([1, pages, page - 1, page, page + 1]);
  // Near either end, show a few more pages so the row keeps a steady width.
  if (page <= 3) for (let p = 2; p <= 4; p++) keep.add(p);
  if (page >= pages - 2) for (let p = pages - 3; p < pages; p++) keep.add(p);
  const out: (number | null)[] = [];
  let prev = 0;
  for (const p of [...keep].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b)) {
    if (p - prev === 2) out.push(p - 1);
    else if (p - prev > 2) out.push(null);
    out.push(p);
    prev = p;
  }
  return out;
}

/** Slices `items` into pages; the page goes back to 1 whenever `resetKey` (the filters) changes. */
export function usePaged<T>(items: readonly T[], pageSize: number, resetKey: string) {
  const [state, setState] = useState({ key: resetKey, page: 1 });
  const topRef = useRef<HTMLDivElement | null>(null);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(state.key === resetKey ? state.page : 1, pages);
  const start = (page - 1) * pageSize;
  const rows = useMemo(() => items.slice(start, start + pageSize), [items, start, pageSize]);
  const goTo = (next: number) => {
    setState({ key: resetKey, page: Math.min(Math.max(1, next), pages) });
    // Paging from the bottom lands on the new page's first row, not halfway down it.
    const top = topRef.current?.getBoundingClientRect().top;
    if (top !== undefined && top < 0) topRef.current?.scrollIntoView({ block: "start" });
  };
  return { page, pages, pageSize, total: items.length, rows, goTo, topRef };
}
