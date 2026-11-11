import { describe, expect, it } from "vitest";

import { issuedLabel, reportGapText } from "./issued";

describe("issuedLabel", () => {
  it("names the release day when the close is on it", () => {
    expect(issuedLabel(0, "2026-11")).toBe("Issued on the Nov WASDE release day");
    expect(issuedLabel(0, "2026-11", "pt-BR")).toBe("Emitida no dia de divulgação do WASDE de nov");
  });

  it("uses the singular one day after the release", () => {
    expect(issuedLabel(1, "2026-11")).toBe("Issued from the Nov WASDE, 1 day after its release");
    expect(issuedLabel(1, "2026-11", "pt-BR")).toBe("Emitida a partir do WASDE de nov, 1 dia após a divulgação");
  });

  it("uses the plural later in the month", () => {
    expect(issuedLabel(31, "2026-10")).toBe("Issued from the Oct WASDE, 31 days after its release");
    expect(issuedLabel(31, "2026-10", "pt-BR")).toBe("Emitida a partir do WASDE de out, 31 dias após a divulgação");
  });
});

describe("reportGapText", () => {
  it("never prints 0 days or 1 days", () => {
    expect(reportGapText(0, "Nov 10, 2026")).toBe("on the day of the Nov 10, 2026 report");
    expect(reportGapText(1, "Nov 10, 2026")).toBe("1 day after the Nov 10, 2026 report");
    expect(reportGapText(31, "Oct 9, 2026")).toBe("31 days after the Oct 9, 2026 report");
  });

  it("has the same three cases in pt-BR", () => {
    expect(reportGapText(0, "10 de nov. de 2026", "pt-BR")).toBe("no próprio dia do relatório de 10 de nov. de 2026");
    expect(reportGapText(1, "10 de nov. de 2026", "pt-BR")).toBe("1 dia depois do relatório de 10 de nov. de 2026");
    expect(reportGapText(31, "9 de out. de 2026", "pt-BR")).toBe("31 dias depois do relatório de 9 de out. de 2026");
  });
});
