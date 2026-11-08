import type { Metadata } from "next";

import TrackRecordView from "@/components/TrackRecordView";
import { getArchive, getMeta, getTrackRecord } from "@/lib/data";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata(
  "/track-record/",
  "Track record",
  "Did any model beat 'no change' for CBOT soybeans after a WASDE? Out-of-sample errors by horizon, range hit rates, past forecasts against actual prices and the statistical tests.",
);

export default function TrackRecordPage() {
  return <TrackRecordView meta={getMeta()} track={getTrackRecord()} archive={getArchive()} />;
}
