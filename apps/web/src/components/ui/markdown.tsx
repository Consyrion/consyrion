import Link from "next/link";
import { Fragment, type ReactNode } from "react";

/** Small Markdown subset (paragraphs, bullets, **bold**, `code`, links) – only app-internal links become links. */
export function Markdown({ text }: { text: string }) {
  // "# …" to "###### …" headings (live test 08.11.26: "### Summary" showed raw) become a bold line of their own.
  const blocks = text
    .replace(/^#{1,6}\s+(.+?)\s*#*$/gm, "\n\n**$1**\n\n")
    .trim()
    .split(/\n{2,}/);
  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        const isItem = (l: string) => /^\s*([-*•]|\d+\.)\s+/.test(l);
        const first = lines.findIndex(isItem);
        // "Intro sentence + list" in one block: the intro as a paragraph, the items as a list.
        if (first >= 0 && lines.slice(first).every(isItem)) {
          return (
            <div key={i} className="space-y-1">
              {first > 0 ? <p className="whitespace-pre-wrap">{inline(lines.slice(0, first).join("\n"))}</p> : null}
              <ul className="list-disc space-y-0.5 pl-4">
                {lines.slice(first).map((l, j) => (
                  <li key={j}>{inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ""))}</li>
                ))}
              </ul>
            </div>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            {inline(block)}
          </p>
        );
      })}
    </div>
  );
}

function inline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  // Link labels may contain one level of brackets, e.g. project names like "[Benchmark] Todo" (#275).
  const re = /\[((?:[^[\]\n]|\[[^[\]\n]*\])+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1] && match[2]) {
      const href = match[2];
      parts.push(
        /^\/(sessions|projects|dashboard|decisions|settings)(\/[\w-]*)*\/?$/.test(href) ? (
          <Link key={match.index} href={href} className="text-primary underline">
            {match[1]}
          </Link>
        ) : (
          <Fragment key={match.index}>{match[1]}</Fragment>
        ),
      );
    } else if (match[3]) parts.push(<strong key={match.index}>{match[3]}</strong>);
    else if (match[4])
      parts.push(
        <code key={match.index} className="rounded bg-surface px-1 text-xs">
          {match[4]}
        </code>,
      );
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
