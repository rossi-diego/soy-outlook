import { describe, expect, it } from "vitest";

import { timeAxisLabel, type Tokens } from "./chart";
import { monthAbbr } from "./format";

const tk = { muted: "#777" } as unknown as Tokens;
const local = (y: number, m: number, d = 1) => new Date(y, m - 1, d).getTime();

describe("timeAxisLabel", () => {
  it("names months in the page's language (pt-BR never shows 'Apr' or 'Oct')", () => {
    const pt = timeAxisLabel(tk, (m) => monthAbbr(m, "pt-BR")).formatter;
    expect(pt(local(2026, 4))).toBe("abr");
    expect(pt(local(2026, 10))).toBe("out");
    const en = timeAxisLabel(tk, (m) => monthAbbr(m, "en")).formatter;
    expect(en(local(2026, 4))).toBe("Apr");
  });

  it("shows the year, in bold, on a January tick and the day on a mid-month tick", () => {
    const f = timeAxisLabel(tk, (m) => monthAbbr(m, "pt-BR")).formatter;
    expect(f(local(2027, 1))).toBe("{y|2027}");
    expect(f(local(2026, 11, 15))).toBe("15 nov");
  });
});
