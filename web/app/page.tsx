import type { Metadata } from "next";

import StoryView from "@/components/story/StoryView";
import { getMeta, getOutlook, getTrackRecord, getWasde } from "@/lib/data";
import { pageMetadata } from "@/lib/site";
import { buildStoryView, outlookCore } from "@/lib/story";

export const metadata: Metadata = pageMetadata(
  "/",
  null,
  "How far could Brazilian export soybeans move in 1, 3 and 6 months? Tested CBOT price-risk ranges for budgeting and hedging, labelled by the hit rate they achieved, a model contest against no change, and what a bad case costs your position.",
);

export default function Home() {
  const meta = getMeta();
  const outlook = getOutlook();
  // Only the compact story model reaches the client (see lib/story.ts): the home page HTML stays
  // inside its 100 KB budget although it draws the full price history and the backtest.
  const story = buildStoryView(outlook, getTrackRecord(), getWasde(), meta);
  return <StoryView meta={meta} outlook={outlookCore(outlook)} story={story} />;
}
