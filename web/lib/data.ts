import "server-only";

import fs from "node:fs";
import path from "node:path";

import type { ArchiveIndex, Meta, Outlook, TrackRecord, Wasde } from "./types";

// Build-time loaders: the static export embeds the latest pipeline output in every page.
const DATA = path.join(process.cwd(), "public", "data");

function read<T>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA, rel), "utf-8")) as T;
}

export const getMeta = () => read<Meta>("meta.json");
export const getOutlook = () => read<Outlook>("outlook.json");
export const getTrackRecord = () => read<TrackRecord>("track_record.json");
export const getWasde = () => read<Wasde>("wasde.json");

const EMPTY_ARCHIVE: ArchiveIndex = {
  archive_schema_version: 1,
  prices_through: "",
  n_outlooks: 0,
  n_resolved: 0,
  inside80: 0,
  inside95: 0,
  entries: [],
};

/** The outlook archive index; empty before the first archived outlook. */
export const getArchive = (): ArchiveIndex =>
  fs.existsSync(path.join(DATA, "archive", "index.json")) ? read<ArchiveIndex>("archive/index.json") : EMPTY_ARCHIVE;
