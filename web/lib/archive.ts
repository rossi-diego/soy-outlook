import type { ArchiveIndex } from "@/lib/types";

/** The archive as the track-record page embeds it: the tally, without the rows (they grow by
 * one outlook per session; the page reads them from /data/archive/index.json in the browser). */
export type ArchiveSummary = Omit<ArchiveIndex, "entries"> & { scored: number };

export function archiveSummary(a: ArchiveIndex): ArchiveSummary {
  const { entries, ...rest } = a;
  // The tally scores each outlook once, on its first-published record; revisions are shown, not re-scored.
  const scored = entries.filter((e) => e.revision === 1).reduce((n, e) => n + e.horizons.length, 0);
  return { ...rest, scored };
}
