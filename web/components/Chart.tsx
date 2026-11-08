"use client";

import dynamic from "next/dynamic";

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
 * loads, the skeleton holds the exact height of the chart.
 */
export default function Chart(props: EChartProps) {
  return (
    <div style={{ height: props.height ?? 320 }}>
      <Lazy {...props} />
    </div>
  );
}
