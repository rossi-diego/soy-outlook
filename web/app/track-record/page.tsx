import type { Metadata } from "next";

import TrackRecordView from "@/components/TrackRecordView";
import { getArchive, getMeta, getTrackRecord } from "@/lib/data";
import { pageMetadata } from "@/lib/site";
import { buildTrackView } from "@/lib/trackView";

export const metadata: Metadata = pageMetadata(
  "/track-record/",
  "Track record",
  "Did any model beat 'no change' for CBOT soybeans after a WASDE? Out-of-sample errors by horizon, range hit rates, past forecasts against actual prices and the statistical tests.",
);

export default function TrackRecordPage() {
  const meta = getMeta();
  // Only the slim view model reaches the client (3 path models x 3 horizons, rounded USD/t),
  // not the whole track_record.json: it keeps the HTML of this page under 100 KB.
  const view = buildTrackView(getTrackRecord(), meta.consts.bu_per_t);
  return <TrackRecordView meta={meta} view={view} archive={getArchive()} />;
}
