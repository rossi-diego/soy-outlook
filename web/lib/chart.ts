"use client";

// Chart theme helpers. Kept apart from components/EChart.tsx so that pages can build options
// without pulling ECharts into their first-load bundle: EChart itself is loaded on demand
// through components/Chart.tsx (next/dynamic, fixed-height skeleton).
import { useEffect, useState } from "react";

export type Tokens = Record<
  | "surface"
  | "ink"
  | "ink2"
  | "muted"
  | "grid"
  | "axis"
  | "series1"
  | "series2"
  | "context"
  | "up"
  | "down"
  | "neutral"
  | "barMuted"
  | "warn",
  string
>;

const VARS: Record<keyof Tokens, string> = {
  surface: "--surface",
  ink: "--ink",
  ink2: "--ink-2",
  muted: "--muted",
  grid: "--grid",
  axis: "--axis",
  series1: "--series-1",
  series2: "--series-2",
  context: "--context",
  up: "--up",
  down: "--down",
  neutral: "--neutral",
  barMuted: "--bar-muted",
  warn: "--warn",
};

function readTokens(): Tokens {
  const cs = getComputedStyle(document.documentElement);
  return Object.fromEntries(
    Object.entries(VARS).map(([k, v]) => [k, cs.getPropertyValue(v).trim()]),
  ) as Tokens;
}

/** Re-reads CSS tokens whenever the theme (OS or toggle) changes. */
export function useTokens(): Tokens | null {
  const [tokens, setTokens] = useState<Tokens | null>(null);
  useEffect(() => {
    const update = () => setTokens(readTokens());
    update();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", update);
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq.removeEventListener("change", update);
      mo.disconnect();
    };
  }, []);
  return tokens;
}

/** Shared recessive chrome: hairline solid grid, muted axis text, tooltip on surface. */
export function baseOption(t: Tokens) {
  return {
    animationDuration: 300,
    textStyle: { fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif", color: t.ink2 },
    grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
    tooltip: {
      backgroundColor: t.surface,
      borderColor: t.grid,
      borderWidth: 1,
      textStyle: { color: t.ink, fontSize: 12 },
      extraCssText: "border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);",
    },
    aria: { enabled: true },
  };
}

export const axisCommon = (t: Tokens) => ({
  axisLine: { lineStyle: { color: t.axis } },
  axisTick: { show: false },
  axisLabel: { color: t.muted, fontSize: 11 },
  splitLine: { lineStyle: { color: t.grid, width: 1, type: "solid" as const } },
});

/** An ECharts option object; typed loosely so this module never imports ECharts. */
export type ChartOption = Record<string, unknown>;
export type OptionBuilder = (t: Tokens) => ChartOption;

/**
 * True below the sm breakpoint (640 px). Option builders run in the browser only (ECharts is
 * client-side), so phones can get fewer axis labels and shorter marker text (P27).
 */
export const isNarrow = (): boolean =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 639.98px)").matches;
