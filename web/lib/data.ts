import "server-only";

import fs from "node:fs";
import path from "node:path";

import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";

import type { ArchiveIndex, Meta, Outlook, TrackRecord, Wasde } from "./types";

// Build-time loaders: the static export embeds the latest pipeline output in every page.
// Each file is validated against the JSON Schema exported from the pydantic contract
// (lib/schema, `soyforecast export-schema`), so a wrong schema_version or shape fails `next build`
// instead of shipping a page that renders NaN or crashes in the browser.
const DATA = path.join(process.cwd(), "public", "data");
const SCHEMAS = path.join(process.cwd(), "lib", "schema");

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validators = new Map<string, ValidateFunction>();

function validatorFor(rel: string): ValidateFunction {
  let v = validators.get(rel);
  if (!v) {
    const schemaFile = rel.replace("archive/", "archive_").replace(/\.json$/, ".schema.json");
    v = ajv.compile(JSON.parse(fs.readFileSync(path.join(SCHEMAS, schemaFile), "utf-8")));
    validators.set(rel, v);
  }
  return v;
}

function describe(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .slice(0, 10)
    .map((e) => `  ${e.instancePath || "(root)"} ${e.message ?? ""}`)
    .join("\n");
}

/** Read and validate one published file; throws (failing the build) on any mismatch. */
export function readValidated<T>(rel: string, dir: string = DATA): T {
  const data: unknown = JSON.parse(fs.readFileSync(path.join(dir, rel), "utf-8"));
  const validate = validatorFor(rel);
  if (!validate(data)) {
    throw new Error(
      `public/data/${rel} does not match lib/schema (re-run the pipeline, or re-export the schema ` +
        `and regenerate types after a contract change):\n${describe(validate.errors)}`,
    );
  }
  return data as T;
}

export const getMeta = () => readValidated<Meta>("meta.json");
export const getOutlook = () => readValidated<Outlook>("outlook.json");
export const getTrackRecord = () => readValidated<TrackRecord>("track_record.json");
export const getWasde = () => readValidated<Wasde>("wasde.json");

const EMPTY_ARCHIVE: ArchiveIndex = {
  archive_schema_version: 1,
  prices_through: "",
  n_outlooks: 0,
  n_revisions: 0,
  n_resolved: 0,
  inside80: 0,
  inside95: 0,
  entries: [],
};

/** The outlook archive index; empty before the first archived outlook. */
export const getArchive = (): ArchiveIndex =>
  fs.existsSync(path.join(DATA, "archive", "index.json")) ? readValidated<ArchiveIndex>("archive/index.json") : EMPTY_ARCHIVE;
