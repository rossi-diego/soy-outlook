// The site contract. Every type comes from the pydantic models in
// src/soyforecast/publish/schema.py, via `soyforecast export-schema` (lib/schema/*.schema.json)
// and `npm run gen:types` (lib/types.generated.ts). CI fails when either is out of date, and
// lib/data.ts validates the JSON against the same schema at build time.
export type * from "./types.generated";

import type { Horizon } from "./types.generated";

export type ModelId = Horizon["model"];
