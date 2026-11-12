import { describe, expect, it } from "vitest";

import { archiveSummary } from "@/lib/archive";
import type { ArchiveIndex } from "@/lib/types";

const h = { status: "pending" } as ArchiveIndex["entries"][number]["horizons"][number];
const entry = (revision: number) => ({ revision, horizons: [h, h, h] }) as unknown as ArchiveIndex["entries"][number];

describe("archiveSummary", () => {
  it("drops the rows and counts only first-published records as scored", () => {
    const a = { n_outlooks: 2, n_revisions: 1, entries: [entry(1), entry(2), entry(1)] } as unknown as ArchiveIndex;
    const s = archiveSummary(a);
    expect(s.scored).toBe(6);
    expect("entries" in s).toBe(false);
    expect(s.n_outlooks).toBe(2);
  });
});
