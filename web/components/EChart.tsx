"use client";

// The only module that imports ECharts. Load it through components/Chart.tsx (next/dynamic),
// never directly from a page, so the library stays out of the first-load bundle.
import { BarChart, LineChart } from "echarts/charts";
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

import { type OptionBuilder, useTokens } from "@/lib/chart";

// MarkLine and MarkArea draw the hero chart's today/next-WASDE lines and whiskers, and the
// track record's holdout shading (P4, P21).
echarts.use([
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  MarkAreaComponent,
  AriaComponent,
  SVGRenderer,
]);

export type EChartProps = {
  option: OptionBuilder;
  height?: number;
  ariaLabel: string;
};

export default function EChart({ option, height = 320, ariaLabel }: EChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const tokens = useTokens();

  useEffect(() => {
    if (!ref.current) return;
    const c = echarts.init(ref.current, undefined, { renderer: "svg" });
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    if (chart.current && tokens) chart.current.setOption(option(tokens) as echarts.EChartsCoreOption, { notMerge: true });
  }, [option, tokens]);

  return <div ref={ref} role="img" aria-label={ariaLabel} data-chart="ready" data-height={height} style={{ height: "100%", width: "100%" }} />;
}
