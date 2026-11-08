import type { Metadata } from "next";

import WasdeView from "@/components/WasdeView";
import { getMeta, getOutlook, getWasde } from "@/lib/data";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata(
  "/wasde/",
  "This WASDE",
  "What the latest USDA WASDE changed for soybeans, the historical average CBOT reaction to each revision on release day, and an 80% prediction interval for your own what-if.",
);

export default function WasdePage() {
  const meta = getMeta();
  const w = getWasde();
  const p0UsdT = (getOutlook().last.c_bu / 100) * meta.consts.bu_per_t;
  return <WasdeView w={w} p0UsdT={p0UsdT} buPerT={meta.consts.bu_per_t} />;
}
