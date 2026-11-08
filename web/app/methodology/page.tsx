import type { Metadata } from "next";

import MethodologyView from "@/components/MethodologyView";
import { getMeta } from "@/lib/data";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata(
  "/methodology/",
  "Methodology",
  "How Soy Outlook forecasts CBOT soybeans after each WASDE: point-in-time data, purging by date, a pre-registered model ladder, empirical-quantile ranges, units, data licences and the audit of the first version.",
);

export default function Methodology() {
  return <MethodologyView meta={getMeta()} />;
}
