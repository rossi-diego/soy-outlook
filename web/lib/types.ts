// Mirrors src/soyforecast/publish/web_json.py (schema_version 2). Prices are US cents per bushel.

export type ModelId = "rw" | "drift" | "arima" | "ridge";

export type Meta = {
  schema_version: number;
  version: string;
  generated_at: string;
  as_of_close: string;
  latest_wasde: { month: string; release_date: string };
  /** Calendar days from the latest WASDE release to the as-of close. */
  days_since_report: number;
  origin_note: string;
  next_wasde: string | null;
  freshness: Freshness;
  wasde_source: { tag: string | null; sha256: string | null; reports: number | null };
  consts: { bu_per_t: number; sack_kg: number };
  fx_default: { value: number; date: string; source: string };
  premium_source: PremiumSource;
  splits: { oos_start: string; validation: [string, string]; holdout_start: string };
  champion: Record<string, ModelId>;
  champion_alpha: number;
  calibration_window: number;
  intervals: {
    method: string;
    centring: string;
    candidates: string[];
    baseline: string;
    rule: string;
    nominal_levels: number[];
    coverage_warn_pp: number;
  };
  models: Record<ModelId, string>;
  features: { id: string; label: string; unit: string }[];
};

export type SourceStatus = {
  /** live: downloaded this run; offline: cache on purpose; cache: a download failed and the cache was used. */
  status: "live" | "offline" | "cache";
  last: string | null;
  detail: string | null;
};

export type Freshness = {
  as_of_close: string;
  generated_at: string;
  mode: "live" | "offline";
  stale_after_bdays: number;
  bdays_close_to_generated: number;
  next_wasde: string | null;
  sources: Record<string, SourceStatus>;
  degraded: boolean;
  degraded_sources: string[];
};

export type ArchivedHorizon = {
  h: number;
  model: ModelId;
  target_date: string;
  central: number;
  low80: number;
  high80: number;
  low95: number;
  high95: number;
  status: "pending" | "resolved";
  actual: number | null;
  actual_date: string | null;
  inside80: boolean | null;
  inside95: boolean | null;
};

/** web/public/data/archive/index.json: every published outlook, scored once its targets pass. */
export type ArchiveIndex = {
  archive_schema_version: number;
  prices_through: string;
  n_outlooks: number;
  n_resolved: number;
  inside80: number;
  inside95: number;
  entries: { as_of_close: string; latest_wasde: string; p0_c_bu: number; horizons: ArchivedHorizon[] }[];
};

export type PremiumSource = {
  kind: string;
  name: string;
  unit: string;
  contract_convention: string;
  method: string;
  licence: string;
  first: string;
  last: string;
  valid_until: string;
  days_since_last: number;
  stale_after_days: number;
  stale: boolean;
};

export type PremiumMonth = {
  month: number;
  median: number;
  p10: number;
  p90: number;
  /** e.g. "2015-2024", derived from the data. */
  years: string;
  n_years: number;
};

export type CoverageSplit = {
  years: string;
  n: number;
  cover80: number;
  cover95: number;
  calibration_n_eff: number | null;
};

export type Coverage = {
  nominal: { "80": number; "95": number };
  validation: CoverageSplit | null;
  holdout: CoverageSplit | null;
  /** Validation hit rate more than coverage_warn_pp below nominal. */
  warn80: boolean;
  warn95: boolean;
};

export type Horizon = {
  h: number;
  model: ModelId;
  target_date: string;
  mean_logret: number;
  calibration_n: number;
  calibration_n_eff: number;
  tail_obs_95: number;
  central: number;
  q025: number;
  q100: number;
  q500: number;
  q900: number;
  q975: number;
  coverage: Coverage;
  /** Reference text only ("historical median, not validated"); never used as the default. */
  premium_reference: PremiumMonth & { note: string };
};

export type Outlook = {
  as_of_close: string;
  last: { date: string; c_bu: number };
  horizons: Horizon[];
  history: { date: string; c_bu: number }[];
  premium_last: { date: string; c_bu: number };
  /** The one premium used for the headline and every horizon until the user enters a quote. */
  premium_now_default: PremiumMonth & {
    basis: string;
    source_last: string;
    stale: boolean;
    illustrative: boolean;
  };
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
  fob_illustrative_note: string | null;
  interval_choice: { centring: string; split: string; score_ratio: number | null; cells: number; chosen: boolean }[];
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

export type CoefCheck = { feature: string; usd_t_per_unit: number; se_usd_t: number; p_value: number; p_holm: number };

export type Reaction = {
  n_reports: number;
  years: string;
  r2: number;
  joint_p: number;
  abs_move_usd_t_median: number;
  alpha: number;
  adjustment: string;
  headline_feature: string | null;
  items: (Sensitivity & CoefCheck & { expected_sign: number; wrong_sign: boolean; weak: boolean })[];
  features: string[];
  /** HC1 covariance of the coefficients, (USD/t per unit) squared, in `features` order. */
  cov_usd_t: number[][];
  resid_sd_usd_t: number;
  release_move: { n: number; typical_usd_t: number; one_in_ten_usd_t: number };
  robustness: {
    placebo: { lag_sessions: number; n_reports: number; r2: number; joint_p: number; items: CoefCheck[] };
    split_sample: {
      break: string;
      early: { years: string; n_reports: number };
      late: { years: string; n_reports: number };
      items: {
        feature: string;
        early_usd_t: number;
        early_se_usd_t: number;
        late_usd_t: number;
        late_se_usd_t: number;
        diff_p: number;
      }[];
    };
    roll_excluded: {
      bdays: number;
      n_excluded: number;
      n_reports: number;
      r2: number;
      joint_p: number;
      items: CoefCheck[];
    };
  };
};

export type Wasde = {
  report_month: string;
  release_date: string;
  previous_month: string;
  market_year: string;
  lines: { id: string; label: string; unit: string; value: number; previous: number | null; change: number | null }[];
  reaction: Reaction;
  next_release: string | null;
  forward: (Sensitivity & { h: number; n: number })[];
};
