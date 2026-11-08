import { describe, expect, it } from "vitest";

import { moneyAmount, parseTonnes } from "./decision";
import { convert, dateLabel, fmt, money, parseBasis, parseFx, pct, rangeLabel, signed } from "./format";
import { dataText, initialLocale } from "./i18n";

describe("initial locale (P20)", () => {
  it("prefers a stored choice, then the browser language, else English", () => {
    expect(initialLocale("en", "pt-BR")).toBe("en");
    expect(initialLocale("pt-BR", "en-US")).toBe("pt-BR");
    expect(initialLocale(null, "pt-BR")).toBe("pt-BR");
    expect(initialLocale(null, "pt-PT")).toBe("pt-BR");
    expect(initialLocale(null, "en-GB")).toBe("en");
    expect(initialLocale("garbage", "nl-NL")).toBe("en");
    expect(initialLocale(null, undefined)).toBe("en");
  });
});

describe("pt-BR formatting keeps the numbers", () => {
  it("uses Brazilian separators, R$/sc and compact dates", () => {
    expect(money(132.449, "brl_sack", "pt-BR")).toBe("R$ 132,45/sc");
    expect(money(1189, "c_bu", "pt-BR")).toBe("1.189¢/bu");
    expect(money(466.2, "usd_t", "pt-BR")).toBe("US$ 466/t");
    expect(dateLabel("2027-02-06", "short", "pt-BR")).toBe("6 fev 2027");
    expect(dateLabel("2027-02-06")).toBe("Feb 6, 2027");
    expect(pct(0.895, 1, "pt-BR")).toBe("89,5%");
    expect(signed(-1.24, 1, "pt-BR")).toBe("−1,2");
    expect(fmt("pt-BR").horizon(3)).toBe("3 meses");
  });

  it("translates the range label around the same hit rates", () => {
    const cov = {
      nominal: { "80": 0.8, "95": 0.95 },
      validation: { years: "2016-23", cover80: 0.708, cover95: 0.888 },
      holdout: { years: "2024+", cover80: 0.85, cover95: 1 },
    };
    expect(rangeLabel(cov, "80", "pt-BR")).toBe("faixa de 80% (acertou 71% em 2016-23, 85% em 2024+)");
  });

  it("parses locale-typed inputs to the same value", () => {
    expect(parseFx("5,50", "pt-BR")).toEqual({ ok: true, value: 5.5 });
    expect(parseTonnes("5.000", "pt-BR")).toEqual({ ok: true, value: 5000 });
    expect(parseTonnes("5,000")).toEqual({ ok: true, value: 5000 });
    expect(moneyAmount(-45_600, "brl", "pt-BR")).toBe("−R$ 46 mil");
    expect(moneyAmount(1_234_567, "usd", "pt-BR")).toBe("+US$ 1,23 mi");
  });

  it("translates published labels and leaves unknown ones as published", () => {
    expect(dataText("pt-BR", "Revision: Brazil soybean crop")).toBe("Revisão: Safra de soja do Brasil");
    expect(dataText("pt-BR", "Something new")).toBe("Something new");
    expect(dataText("en", "Trade war")).toBe("Trade war");
  });
});

describe("port-to-interior discount (P20)", () => {
  const a = { premium: 79, fx: 5.5, buPerT: 36.74371036414626, sackKg: 60 };
  it("defaults to 0 and only shifts R$/sack", () => {
    expect(parseBasis("")).toEqual({ ok: true, value: 0 });
    expect(parseBasis("12,5", "pt-BR")).toEqual({ ok: true, value: 12.5 });
    expect(parseBasis("-3").ok).toBe(false);
    expect(parseBasis("101").ok).toBe(false);
    expect(convert(1189, "brl_sack", { ...a, basis: 12.5 })).toBeCloseTo(convert(1189, "brl_sack", a) - 12.5, 10);
    expect(convert(1189, "usd_t", { ...a, basis: 12.5 })).toBe(convert(1189, "usd_t", a));
    expect(convert(1189, "c_bu", { ...a, basis: 12.5 })).toBe(1189);
  });
});
