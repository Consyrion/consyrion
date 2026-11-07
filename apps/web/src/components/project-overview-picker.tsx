"use client";

import { usePathname, useRouter } from "next/navigation";
import { Select } from "./ui/select";

/** Which council the project overview graphic shows: a session or "all sessions" (kept in the URL, ?session=…). */
export function ProjectOverviewPicker({ value, options, label }: { value: string; options: Array<{ value: string; label: string }>; label: string }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <Select
      aria-label={label}
      size="sm"
      align="end"
      value={value}
      onChange={(e) => router.push(`${pathname}?session=${encodeURIComponent(e.target.value)}`, { scroll: false })}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}
