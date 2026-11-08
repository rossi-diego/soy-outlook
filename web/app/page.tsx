import type { Metadata } from "next";

import OutlookView from "@/components/OutlookView";
import { getMeta, getOutlook } from "@/lib/data";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata(
  "/",
  null,
  "Price-risk ranges for Brazilian export soybeans 1, 3 and 6 months after each USDA WASDE report, for budgeting and hedging: CBOT ranges labelled by the hit rate they achieved, an illustrative downside-vs-selling-today panel, and the premium and exchange rate as your inputs.",
);

export default function Home() {
  // Hit rates now come with each horizon (outlook.json `coverage`), so the copy cannot drift from the data.
  return <OutlookView meta={getMeta()} outlook={getOutlook()} />;
}
