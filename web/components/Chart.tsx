"use client";

import dynamic from "next/dynamic";
import type { CSSProperties } from "react";

import type { EChartProps } from "@/components/EChart";

/** Fixed-height placeholder, so the page does not jump when ECharts arrives. */
export function ChartSkeleton({ ariaLabel }: { ariaLabel?: string }) {
  return (
    <div
      className="chart-skeleton"
      style={{ height: "100%", width: "100%" }}
      role="img"
      aria-label={ariaLabel ? `${ariaLabel} (loading)` : "Chart loading"}
      aria-busy="true"
      data-chart="loading"
    />
  );
}

const Lazy = dynamic(() => import("@/components/EChart"), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});

/**
 * The chart every page uses: ECharts is code-split and fetched after hydration. While it
 * loads, the skeleton holds the exact height of the chart. Below the sm breakpoint every chart
 * is capped at 260 px (P27, `.chart-box` in globals.css), so a phone sees the chart and its
 * controls on one screen.
 */
export default function Chart(props: EChartProps) {
  return (
    <div className="chart-box" style={{ "--chart-h": `${props.height ?? 320}px` } as CSSProperties}>
      <Lazy {...props} />
    </div>
  );
}
