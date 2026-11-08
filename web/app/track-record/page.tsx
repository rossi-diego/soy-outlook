import type { Metadata } from "next";

import TrackRecordView from "@/components/TrackRecordView";
import { getMeta, getTrackRecord } from "@/lib/data";

export const metadata: Metadata = { title: "Track record · Soy Outlook" };

export default function TrackRecordPage() {
  return <TrackRecordView meta={getMeta()} track={getTrackRecord()} />;
}
