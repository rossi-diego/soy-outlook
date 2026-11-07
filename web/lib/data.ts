import "server-only";

import fs from "node:fs";
import path from "node:path";

import type { Meta, Outlook, TrackRecord, Wasde } from "./types";

// Build-time loaders: the static export embeds the latest pipeline output in every page.
const DATA = path.join(process.cwd(), "public", "data");

function read<T>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA, rel), "utf-8")) as T;
}

export const getMeta = () => read<Meta>("meta.json");
export const getOutlook = () => read<Outlook>("outlook.json");
export const getTrackRecord = () => read<TrackRecord>("track_record.json");
export const getWasde = () => read<Wasde>("wasde.json");
