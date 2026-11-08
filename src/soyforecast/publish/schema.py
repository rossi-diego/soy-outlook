"""The site contract (P25): pydantic models of every JSON file the site reads.

This module is the single source of truth for the shape of web/public/data:
  - `publish` validates each file against its model before anything is written;
  - `soyforecast validate` (the refresh gate) re-validates the files on disk;
  - `soyforecast export-schema` writes JSON Schema to web/lib/schema/, from which
    web/lib/types.generated.ts is generated (json-schema-to-typescript) and against which the
    site validates the JSON at build time, so a mismatch fails `next build`.

Models forbid unknown keys and NaN/inf; prices are US cents per bushel unless a field name
says otherwise. Changing a model changes the contract: bump SCHEMA_VERSION when a field is
removed or changes meaning, re-export the schema and regenerate the TypeScript types.
"""

from __future__ import annotations

import itertools
import json
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.json_schema import GenerateJsonSchema

from soyforecast.config import HORIZONS

SCHEMA_VERSION = 3  # v3: range method (P2), calibration stats (P4), inference rule v2 (P16)

ModelId = Literal["rw", "drift", "arima", "ridge"]
RangeMethod = Literal["empirical", "ewma_fhs", "lognormal_rv"]
Split = Literal["validation", "holdout"]
IsoDate = Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")]
ReportMonth = Annotated[str, Field(pattern=r"^\d{4}-\d{2}$")]
Probability = Annotated[float, Field(ge=0, le=1)]


class Contract(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        allow_inf_nan=False,
        populate_by_name=True,
        json_schema_serialization_defaults_required=True,
    )


# ---------------------------------------------------------------- meta.json


class LatestWasde(Contract):
    month: ReportMonth
    release_date: IsoDate


class SourceStatus(Contract):
    """live: downloaded this run; offline: cache on purpose; cache: a download failed or was
    rejected and the cache was used."""

    status: Literal["live", "offline", "cache"]
    last: str | None
    detail: str | None


class Freshness(Contract):
    as_of_close: IsoDate
    generated_at: str
    mode: Literal["live", "offline"]
    stale_after_bdays: int
    bdays_close_to_generated: int
    next_wasde: IsoDate | None
    sources: dict[str, SourceStatus]
    degraded: bool
    degraded_sources: list[str]


class WasdeSource(Contract):
    tag: str | None
    sha256: str | None
    reports: int | None


class Consts(Contract):
    bu_per_t: float
    sack_kg: int


class FxDefault(Contract):
    value: float
    date: IsoDate
    source: str


class PremiumSource(Contract):
    kind: str
    name: str
    unit: str
    contract_convention: str
    method: str
    licence: str
    first: IsoDate
    last: IsoDate
    valid_until: IsoDate
    days_since_last: int
    stale_after_days: int
    stale: bool


class Splits(Contract):
    oos_start: IsoDate
    validation: tuple[IsoDate, IsoDate]
    holdout_start: IsoDate


class Intervals(Contract):
    method: str = Field(description="Label of the published range method (the validation winner).")
    range_method: RangeMethod
    range_candidates: list[RangeMethod]
    range_baseline: RangeMethod
    range_rule: str
    range_labels: dict[RangeMethod, str]
    centring: str
    candidates: list[str]
    baseline: str
    rule: str
    nominal_levels: list[float]
    coverage_warn_pp: float


class InferenceRule(Contract):
    """The versioned, pre-registered test and champion rule (P16)."""

    version: int
    registered: IsoDate
    primary_loss: str
    secondary_loss: str
    adjustment: str
    champion: str
    direction_test: str
    calibration: str
    v1: str


class FeatureMeta(Contract):
    id: str
    label: str
    unit: str


class Meta(Contract):
    schema_version: Literal[3]
    version: str
    generated_at: str
    as_of_close: IsoDate
    latest_wasde: LatestWasde
    days_since_report: int = Field(description="Calendar days from the WASDE release to the close.")
    origin_note: str
    next_wasde: IsoDate | None
    freshness: Freshness
    wasde_source: WasdeSource
    consts: Consts
    fx_default: FxDefault
    premium_source: PremiumSource
    splits: Splits
    champion: dict[str, ModelId]
    champion_alpha: float
    calibration_window: int
    intervals: Intervals
    inference_rule: InferenceRule
    models: dict[ModelId, str]
    features: list[FeatureMeta]


# ---------------------------------------------------------------- outlook.json


class PricePoint(Contract):
    date: IsoDate
    c_bu: float


class PremiumMonth(Contract):
    month: int = Field(ge=1, le=12)
    median: float
    p10: float
    p90: float
    years: str = Field(description='e.g. "2015-2024", derived from the data.')
    n_years: int


class PremiumReference(PremiumMonth):
    """Reference text only ("historical median, not validated"); never used as the default."""

    note: str


class PremiumNowDefault(PremiumMonth):
    """The one premium used for the headline and every horizon until the user enters a quote."""

    basis: str
    source_last: IsoDate
    stale: bool
    illustrative: bool


class Nominal(Contract):
    n80: float = Field(alias="80")
    n95: float = Field(alias="95")


class CoverageSplit(Contract):
    years: str
    n: int
    cover80: Probability
    cover95: Probability
    calibration_n_eff: float | None
    ci80: tuple[Probability | None, Probability | None] = Field(
        description="Moving-block bootstrap 95% CI of the 80% hit rate."
    )
    ci95: tuple[Probability | None, Probability | None]
    n_eff80: float | None = Field(description="Approximate number of independent outcomes.")
    n_eff95: float | None


class Coverage(Contract):
    nominal: Nominal
    validation: CoverageSplit | None
    holdout: CoverageSplit | None
    warn80: bool = Field(description="Validation hit rate more than coverage_warn_pp below 80%.")
    warn95: bool = Field(description="Validation hit rate more than coverage_warn_pp below 95%.")


QUANTILE_FIELDS = ("q025", "q100", "q500", "q900", "q975")


class ContractInfo(Contract):
    code: str = Field(pattern=r"^[FHKNQUX]\d{2}$")
    delivery_month: ReportMonth
    first_notice: IsoDate
    last_trade: IsoDate


class HorizonContract(Contract):
    """The hedge contract for a horizon (P10); prices stay the continuous front month."""

    front_at_origin: str = Field(
        pattern=r"^[FHKNQUX]\d{2}$", description="Contract ZS=F quotes at the origin close."
    )
    front_at_target: str = Field(
        pattern=r"^[FHKNQUX]\d{2}$", description="Contract ZS=F will quote on the target date."
    )
    reference: ContractInfo = Field(
        description="Hedge contract: the first whose first notice day is after the target date."
    )
    crosses_roll: bool = Field(
        description="The continuous front month rolls (at a last trading day) inside the window."
    )
    crosses_crop_roll: bool
    series: str


class Horizon(Contract):
    h: int
    model: ModelId
    target_date: IsoDate
    mean_logret: float
    calibration_n: int
    calibration_n_eff: float
    tail_obs_95: float
    contract: HorizonContract
    q025: float
    q100: float
    q500: float
    q900: float
    q975: float
    central: float
    coverage: Coverage
    premium_reference: PremiumReference

    @model_validator(mode="after")
    def _monotone(self) -> Horizon:
        qs = [getattr(self, k) for k in QUANTILE_FIELDS]
        if any(a > b for a, b in itertools.pairwise(qs)):
            raise ValueError(f"horizon {self.h}: quantiles are not monotone: {qs}")
        if not qs[0] <= self.central <= qs[-1]:
            raise ValueError(f"horizon {self.h}: central value outside the 95% range")
        return self


class StressEpisode(Contract):
    id: ReportMonth
    name: str
    rationale: str
    start: IsoDate
    end: IsoDate
    logret: float
    pct: float
    percentile: float = Field(ge=0, le=100)
    c_bu: float
    usd_t: float = Field(description="CBOT price in USD/t, no premium.")
    cbot_brl_sack: float = Field(
        description="CBOT price only (no premium) in R$ per 60 kg sack at today's PTAX."
    )


class ReturnDistribution(Contract):
    n: int
    first: IsoDate
    last_start: IsoDate
    quantiles: dict[str, float]
    bin_step: float
    bin_edges: list[float]
    counts: list[int]

    @model_validator(mode="after")
    def _bins(self) -> ReturnDistribution:
        if len(self.bin_edges) != len(self.counts) + 1 or sum(self.counts) != self.n:
            raise ValueError("histogram edges/counts do not match n")
        return self


class StressHorizon(Contract):
    h: int
    episodes: list[StressEpisode]
    distribution: ReturnDistribution


class Stress(Contract):
    """Historical stress replay (P19): illustrative scenarios, not probabilities."""

    label: str
    rule: str
    basis: str
    p0_c_bu: float
    fx: float
    horizons: list[StressHorizon]


class Outlook(Contract):
    as_of_close: IsoDate
    last: PricePoint
    horizons: list[Horizon]
    history: list[PricePoint] = Field(min_length=1)
    premium_last: PricePoint
    stress: Stress
    premium_now_default: PremiumNowDefault

    @model_validator(mode="after")
    def _all_horizons(self) -> Outlook:
        hs = [h.h for h in self.horizons]
        if hs != list(HORIZONS):
            raise ValueError(f"outlook horizons {hs} != {list(HORIZONS)}")
        return self


# ---------------------------------------------------------------- track_record.json


class MetricRow(Contract):
    subset: Literal["all", "no_crop_roll"]
    split: Split
    model: ModelId
    h: int
    n: int
    mse_logret: float | None = Field(
        description="Primary loss (rule v2): squared log-return error."
    )
    mae_usd_t: float | None
    rmse_usd_t: float | None
    mape_pct: float | None
    mase: float | None
    dir_acc: float | None
    dir_p: float | None
    n_interval: int | None
    cover80: float | None
    cover95: float | None
    pinball: float | None
    iscore80: float | None
    iscore95: float | None
    calibration_n: float | None
    calibration_n_eff: float | None
    mde_mae: float | None = Field(
        description="Minimum detectable relative MAE improvement over no change (5%, 80% power)."
    )
    cover80_se: float | None
    cover80_ci_lo: float | None
    cover80_ci_hi: float | None
    cover80_n_eff: float | None
    miss_lo80: float | None
    miss_hi80: float | None
    kupiec80_p: float | None
    christ80_p: float | None
    cover95_se: float | None
    cover95_ci_lo: float | None
    cover95_ci_hi: float | None
    cover95_n_eff: float | None
    miss_lo95: float | None
    miss_hi95: float | None
    kupiec95_p: float | None
    christ95_p: float | None


class TestRow(Contract):
    model: ModelId
    h: int
    n: int
    dm_t: float | None = Field(description="DM on the primary loss (squared log-return error).")
    dm_p: float | None
    dm_mae_t: float | None = Field(description="DM on the secondary loss (absolute USD/t error).")
    dm_mae_p: float | None
    cw_t: float | None
    cw_p: float | None
    cw_p_holm: float | None


class PathRow(Contract):
    origin: IsoDate
    target_date: IsoDate
    split: Split
    crop_roll: bool
    roll_cross: bool
    p0: float
    actual: float | None
    forecast: float
    q025: float | None
    q10: float | None
    q90: float | None
    q975: float | None

    @model_validator(mode="after")
    def _monotone(self) -> PathRow:
        qs = [q for q in (self.q025, self.q10, self.q90, self.q975) if q is not None]
        if any(a > b for a, b in itertools.pairwise(qs)):
            raise ValueError(f"path {self.origin}: quantiles are not monotone: {qs}")
        return self


class FobRow(Contract):
    split: str
    model: ModelId
    h: int
    n: int
    mae_usd_t: float
    mape_pct: float


class IntervalChoiceRow(Contract):
    centring: str
    split: str
    score_ratio: float | None
    cells: int
    chosen: bool


class RangeChoiceRow(Contract):
    method: RangeMethod
    split: Split
    score_ratio: float | None
    cells: int
    chosen: bool


class RangeDiagnosticRow(Contract):
    method: RangeMethod
    split: Split
    h: int
    model: ModelId
    n: int
    cover80: Probability
    cover95: Probability
    pinball: float
    iscore80: float
    iscore95: float
    width80_median: float
    cover80_se: float | None
    cover80_ci_lo: float | None
    cover80_ci_hi: float | None
    cover80_n_eff: float | None
    miss_lo80: float
    miss_hi80: float
    kupiec80_p: float | None
    christ80_p: float | None
    cover95_se: float | None
    cover95_ci_lo: float | None
    cover95_ci_hi: float | None
    cover95_n_eff: float | None
    miss_lo95: float
    miss_hi95: float
    kupiec95_p: float | None
    christ95_p: float | None


class RangeRegimeRow(Contract):
    method: RangeMethod
    split: Split
    h: int
    regime: Literal["low", "mid", "high"]
    n: int
    cover80: Probability | None
    cover95: Probability | None


class TrackRecord(Contract):
    metrics: list[MetricRow] = Field(min_length=1)
    tests: list[TestRow]
    fob_illustrative: list[FobRow]
    fob_illustrative_note: str | None
    interval_choice: list[IntervalChoiceRow]
    range_choice: list[RangeChoiceRow]
    range_diagnostics: list[RangeDiagnosticRow]
    range_regimes: list[RangeRegimeRow]
    paths: dict[str, dict[ModelId, list[PathRow]]] = Field(min_length=1)


# ---------------------------------------------------------------- wasde.json


class WasdeLine(Contract):
    id: str
    label: str
    unit: str
    value: float
    previous: float | None
    change: float | None


class CoefCheck(Contract):
    feature: str
    usd_t_per_unit: float
    se_usd_t: float
    p_value: Probability
    p_holm: Probability


class ReactionItem(CoefCheck):
    label: str
    unit: str
    expected_sign: int
    wrong_sign: bool
    weak: bool


class ReleaseMove(Contract):
    n: int
    typical_usd_t: float
    one_in_ten_usd_t: float


class Placebo(Contract):
    lag_sessions: int
    n_reports: int
    r2: float
    joint_p: Probability
    items: list[CoefCheck]


class SubSample(Contract):
    years: str
    n_reports: int


class SplitItem(Contract):
    feature: str
    early_usd_t: float
    early_se_usd_t: float
    late_usd_t: float
    late_se_usd_t: float
    diff_p: Probability


class SplitSample(Contract):
    break_: IsoDate = Field(alias="break")
    early: SubSample
    late: SubSample
    items: list[SplitItem]


class RollExcluded(Contract):
    bdays: int
    n_excluded: int
    n_reports: int
    r2: float
    joint_p: Probability
    items: list[CoefCheck]


class Robustness(Contract):
    placebo: Placebo
    split_sample: SplitSample
    roll_excluded: RollExcluded


class Reaction(Contract):
    n_reports: int
    years: str
    r2: float
    joint_p: Probability
    abs_move_usd_t_median: float
    alpha: float
    adjustment: str
    headline_feature: str | None
    items: list[ReactionItem]
    features: list[str]
    cov_usd_t: list[list[float]] = Field(
        description="HC1 covariance of the coefficients, (USD/t per unit) squared, in `features` order."
    )
    resid_sd_usd_t: float
    release_move: ReleaseMove
    robustness: Robustness

    @model_validator(mode="after")
    def _square_cov(self) -> Reaction:
        k = len(self.features)
        if len(self.cov_usd_t) != k or any(len(r) != k for r in self.cov_usd_t):
            raise ValueError(f"cov_usd_t is not {k}x{k}")
        return self


class ForwardRow(Contract):
    h: int
    feature: str
    label: str
    unit: str
    usd_t_per_unit: float
    se_usd_t: float
    p_value: Probability
    n: int


class Wasde(Contract):
    report_month: ReportMonth
    release_date: IsoDate
    previous_month: ReportMonth
    market_year: str
    lines: list[WasdeLine] = Field(min_length=1)
    reaction: Reaction
    next_release: IsoDate | None
    forward: list[ForwardRow]


# ---------------------------------------------------------------- archive/index.json


class ArchivedHorizon(Contract):
    h: int
    model: ModelId
    target_date: IsoDate
    central: float
    low80: float
    high80: float
    low95: float
    high95: float
    status: Literal["pending", "resolved"]
    actual: float | None
    actual_date: IsoDate | None
    inside80: bool | None
    inside95: bool | None

    @model_validator(mode="after")
    def _monotone(self) -> ArchivedHorizon:
        qs = [self.low95, self.low80, self.high80, self.high95]
        if any(a > b for a, b in itertools.pairwise(qs)):
            raise ValueError(f"archived horizon {self.h}: ranges are not nested: {qs}")
        if not self.low95 <= self.central <= self.high95:
            raise ValueError(f"archived horizon {self.h}: central value outside the 95% range")
        return self


class ArchiveEntry(Contract):
    file: str | None = Field(description="Archive file name; a WASDE-day re-publish has its own.")
    as_of_close: IsoDate
    latest_wasde: ReportMonth
    p0_c_bu: float
    horizons: list[ArchivedHorizon]


class ArchiveIndex(Contract):
    """web/public/data/archive/index.json: every published outlook, scored once targets pass."""

    archive_schema_version: Literal[1]
    prices_through: str
    n_outlooks: int
    n_resolved: int
    inside80: int
    inside95: int
    entries: list[ArchiveEntry]


# ---------------------------------------------------------------- run_manifest.json


class InputFile(Contract):
    file: str
    sha256: str | None
    bytes: int | None
    snapshot: str | None


class WasdeInput(InputFile):
    release_tag: str | None
    pin_sha256: str | None
    matches_pin: bool
    reports: int | None
    latest_report: ReportMonth


class SeriesInput(InputFile):
    rows: int
    first: IsoDate
    last: IsoDate


class RunInputs(Contract):
    wasde: WasdeInput
    prices: SeriesInput
    ptax: SeriesInput
    premium_table: InputFile
    premium_card: InputFile


class GitState(Contract):
    sha: str | None
    code_dirty: bool | None


class LockState(Contract):
    file: str
    sha256: str | None


class RunManifest(Contract):
    run_manifest_version: Literal[1]
    generated_at: str
    soyforecast_version: str
    mode: Literal["live", "offline"]
    git: GitState
    python: str
    packages: dict[str, str | None]
    lock: LockState
    inputs: RunInputs
    sources: dict[str, SourceStatus]


# ---------------------------------------------------------------- files and export

# Published file -> model. Every file here is validated before it is written.
FILES: dict[str, type[Contract]] = {
    "meta.json": Meta,
    "outlook.json": Outlook,
    "track_record.json": TrackRecord,
    "wasde.json": Wasde,
    "run_manifest.json": RunManifest,
    "archive/index.json": ArchiveIndex,
}


class SiteData(Contract):
    """Every published file at once: the root from which the TypeScript types are generated."""

    meta: Meta
    outlook: Outlook
    track_record: TrackRecord
    wasde: Wasde
    run_manifest: RunManifest
    archive_index: ArchiveIndex


def schema_name(file: str) -> str:
    return file.replace("archive/", "archive_").replace(".json", ".schema.json")


class _Generator(GenerateJsonSchema):
    """No per-field titles: they would become noise type aliases in the generated TypeScript."""

    def field_title_should_be_set(self, schema: Any) -> bool:
        return False


def json_schema(model: type[BaseModel]) -> dict[str, Any]:
    out = model.model_json_schema(by_alias=True, mode="serialization", schema_generator=_Generator)
    return {"$schema": "https://json-schema.org/draft/2020-12/schema", **out}


def export_schemas(folder: Path) -> list[Path]:
    """Write one JSON Schema per published file, plus site.schema.json for codegen."""
    folder.mkdir(parents=True, exist_ok=True)
    written = []
    targets = {schema_name(f): m for f, m in FILES.items()} | {"site.schema.json": SiteData}
    for name, model in targets.items():
        path = folder / name
        text = json.dumps(json_schema(model), indent=2, ensure_ascii=False) + "\n"
        path.write_text(text, encoding="utf-8", newline="\n")
        written.append(path)
    return written


def validate_payload(file: str, payload: Any) -> Contract:
    """Validate one file's content against its model (raises pydantic.ValidationError)."""
    return FILES[file].model_validate(payload)


def dump(model: Contract) -> Any:
    """JSON-ready content of a validated model, keyed by the published (alias) names."""
    return model.model_dump(mode="json", by_alias=True)
