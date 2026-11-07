import OutlookView from "@/components/OutlookView";
import { getMeta, getOutlook, getTrackRecord } from "@/lib/data";

export default function Home() {
  const meta = getMeta();
  const outlook = getOutlook();
  const track = getTrackRecord();
  // Validation hit rate of the champion's 80% range, per horizon, for the cards.
  const hitRates: Record<string, { cover80: number | null; n: number | null }> = {};
  for (const h of outlook.horizons) {
    const row = track.metrics.find(
      (m) => m.subset === "all" && m.split === "validation" && m.model === h.model && m.h === h.h,
    );
    hitRates[String(h.h)] = { cover80: row?.cover80 ?? null, n: row?.n_interval ?? null };
  }
  return <OutlookView meta={meta} outlook={outlook} hitRates={hitRates} />;
}
