// Mirrors src/soyforecast/publish/web_json.py (schema_version 1). Prices are US cents per bushel.

export type ModelId = "rw" | "drift" | "arima" | "ridge";

export type Meta = {
  schema_version: number;
  version: string;
  generated_at: string;
  as_of_close: string;
  latest_wasde: { month: string; release_date: string };
  next_wasde: string | null;
  wasde_source: { tag: string | null; sha256: string | null; reports: number | null };
  consts: { bu_per_t: number; sack_kg: number };
  fx_default: { value: number; date: string; source: string };
  premium_seed: { first: string; last: string };
  splits: { oos_start: string; validation: [string, string]; holdout_start: string };
  champion: Record<string, ModelId>;
  champion_alpha: number;
  calibration_window: number;
  models: Record<ModelId, string>;
  features: { id: string; label: string; unit: string }[];
};

export type Horizon = {
  h: number;
  model: ModelId;
  target_date: string;
  mean_logret: number;
  calibration_n: number;
  central: number;
  q025: number;
  q100: number;
  q500: number;
  q900: number;
  q975: number;
  premium_default: { month: number; median: number; p10: number; p90: number; years: string };
};

export type Outlook = {
  as_of_close: string;
  last: { date: string; c_bu: number };
  horizons: Horizon[];
  history: { date: string; c_bu: number }[];
  premium_last: { date: string; c_bu: number };
  premium_now_default: { month: number; median: number };
};

export type MetricRow = {
  subset: "all" | "no_crop_roll";
  split: "validation" | "holdout";
  model: ModelId;
  h: number;
  n: number;
  mae_usd_t: number;
  rmse_usd_t: number;
  mape_pct: number;
  mase: number | null;
  dir_acc: number | null;
  dir_p: number | null;
  n_interval: number | null;
  cover80: number | null;
  cover95: number | null;
  pinball: number | null;
};

export type TestRow = {
  model: ModelId;
  h: number;
  n: number;
  dm_t: number;
  dm_p: number;
  cw_t: number;
  cw_p: number;
  cw_p_holm: number;
};

export type PathRow = {
  origin: string;
  target_date: string;
  split: "validation" | "holdout";
  crop_roll: boolean;
  p0: number;
  actual: number | null;
  forecast: number;
  q025: number | null;
  q10: number | null;
  q90: number | null;
  q975: number | null;
};

export type TrackRecord = {
  metrics: MetricRow[];
  tests: TestRow[];
  fob_illustrative: { split: string; model: ModelId; h: number; n: number; mae_usd_t: number; mape_pct: number }[];
  paths: Record<string, Partial<Record<ModelId, PathRow[]>>>;
};

export type Sensitivity = {
  feature: string;
  label: string;
  unit: string;
  usd_t_per_unit: number;
  se_usd_t: number;
  p_value: number;
};

export type Wasde = {
  report_month: string;
  release_date: string;
  previous_month: string;
  market_year: string;
  lines: { id: string; label: string; unit: string; value: number; previous: number | null; change: number | null }[];
  reaction: { n_reports: number; r2: number; abs_move_usd_t_median: number; items: Sensitivity[] };
  forward: (Sensitivity & { h: number; n: number })[];
};
