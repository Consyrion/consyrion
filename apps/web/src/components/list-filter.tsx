import Link from "next/link";

/**
 * Search and filter chips for the long lists (QA 12.11.26: 53 projects and 58 sessions without any way to narrow them).
 * Server-rendered: a plain GET form, so it works without JavaScript and the filtered view has its own URL (the dashboard
 * links to `/decisions?status=awaiting_approval`). Chips instead of a native select (design rule: no grey browser lists).
 */
export interface FilterChip {
  value: string;
  label: string;
  count: number;
}

export function ListFilter({
  basePath,
  query,
  queryLabel,
  submitLabel,
  chips,
  active,
  keep = {},
  shown,
}: {
  basePath: string;
  query: string;
  queryLabel: string;
  submitLabel: string;
  chips: FilterChip[];
  /** The selected chip value; "" = all. */
  active: string;
  /** Other parameters that survive a search or a chip click (e.g. `archived=1`). */
  keep?: Record<string, string>;
  /** "12 of 58 shown" – only rendered while a filter narrows the list. */
  shown?: string | null;
}) {
  const href = (params: Record<string, string>) => {
    const search = new URLSearchParams(Object.entries({ ...keep, ...params }).filter(([, v]) => v !== ""));
    const qs = search.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  return (
    <div className="mb-3 space-y-2" data-testid="list-filter">
      <form action={basePath} method="get" role="search" className="flex flex-wrap gap-2">
        {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
        {active ? <input type="hidden" name="status" value={active} /> : null}
        <input
          type="search"
          name="q"
          defaultValue={query}
          aria-label={queryLabel}
          placeholder={queryLabel}
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm"
        />
        <button type="submit" className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-primary">
          {submitLabel}
        </button>
      </form>
      {chips.length > 1 ? (
        <nav aria-label={queryLabel} className="flex flex-wrap gap-1.5 text-xs">
          {chips.map((c) => (
            <Link
              key={c.value || "all"}
              href={href({ q: query, status: c.value })}
              aria-current={c.value === active ? "page" : undefined}
              className={`rounded-full border px-2.5 py-1 ${c.value === active ? "border-primary text-text" : "border-line text-muted hover:text-text"}`}
            >
              {c.label} ({c.count})
            </Link>
          ))}
        </nav>
      ) : null}
      {shown ? <p className="text-xs text-muted">{shown}</p> : null}
    </div>
  );
}

/** Case- and accent-insensitive match of a search term against one or more fields. */
export function matchesQuery(query: string, ...fields: Array<string | null | undefined>): boolean {
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = norm(fields.filter(Boolean).join(" "));
  return terms.every((term) => hay.includes(term));
}
