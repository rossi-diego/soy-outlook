"""
Utilities for fetching commodity price data from Yahoo Finance.
"""
import logging
from typing import Dict, List, Optional, Tuple
from datetime import datetime

import pandas as pd
import yfinance as yf

logger = logging.getLogger(__name__)

# Commodity ticker symbols for Yahoo Finance
COMMODITY_TICKERS = {
    "ZS=F": "Soybean Futures",
    "ZC=F": "Corn Futures",
    "ZW=F": "Wheat Futures",
    "ZL=F": "Soybean Oil Futures",
    "ZM=F": "Soybean Meal Futures",
}

# Simplified column names
COMMODITY_NAMES = {
    "ZS=F": "soybean",
    "ZC=F": "corn",
    "ZW=F": "wheat",
    "ZL=F": "soybean_oil",
    "ZM=F": "soybean_meal",
}


def yahoo_quotes(
    tickers: Optional[List[str]] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    use_simplified_names: bool = True,
) -> Tuple[pd.DataFrame, Optional[datetime.date]]:
    """
    Fetch commodity price quotes from Yahoo Finance.

    Parameters
    ----------
    tickers : List[str], optional
        List of Yahoo Finance ticker symbols. If None, uses default commodity tickers.
    start_date : str, optional
        Start date in 'YYYY-MM-DD' format. Defaults to '2000-01-01'.
    end_date : str, optional
        End date in 'YYYY-MM-DD' format. Defaults to today.
    use_simplified_names : bool, default=True
        If True, renames columns to simplified commodity names.

    Returns
    -------
    Tuple[pd.DataFrame, Optional[datetime.date]]
        - DataFrame with commodity prices indexed by date
        - First available date in the dataset (or None if empty)

    Raises
    ------
    ValueError
        If tickers list is empty or invalid date format provided.
    RuntimeError
        If data download fails.

    Examples
    --------
    >>> df, first_date = yahoo_quotes()
    >>> print(df.head())
    >>> print(f"Data available from: {first_date}")
    """
    # Set default values
    if tickers is None:
        tickers = list(COMMODITY_TICKERS.keys())

    if not tickers:
        raise ValueError("Tickers list cannot be empty")

    if start_date is None:
        start_date = "2000-01-01"

    if end_date is None:
        end_date = pd.Timestamp.today().strftime('%Y-%m-%d')

    # Validate date formats
    try:
        pd.to_datetime(start_date)
        pd.to_datetime(end_date)
    except Exception as e:
        raise ValueError(f"Invalid date format. Use 'YYYY-MM-DD'. Error: {e}")

    logger.info(f"Downloading data for tickers: {tickers} from {start_date} to {end_date}")

    try:
        # Download data - specify group_by to handle single ticker case
        if len(tickers) == 1:
            df_raw = yf.download(tickers[0], start=start_date, end=end_date, progress=False)
            if not df_raw.empty:
                df = pd.DataFrame({tickers[0]: df_raw["Close"]})
            else:
                df = pd.DataFrame()
        else:
            df_raw = yf.download(tickers, start=start_date, end=end_date, group_by='column', progress=False)
            df = df_raw["Close"] if "Close" in df_raw.columns.get_level_values(0) else df_raw

    except Exception as e:
        logger.error(f"Failed to download data from Yahoo Finance: {e}")
        raise RuntimeError(f"Data download failed: {e}")

    # Drop rows where all values are NaN
    df = df.dropna(how="all")

    # Rename columns to simplified names if requested
    if use_simplified_names:
        df = df.rename(columns=COMMODITY_NAMES)

    # Ensure datetime index
    df.index = pd.to_datetime(df.index)
    df.index.name = "date"

    # Get first available date
    first_available_date = df.index.min().date() if not df.empty else None

    if df.empty:
        logger.warning("No data retrieved from Yahoo Finance")
    else:
        logger.info(f"Successfully retrieved {len(df)} rows of data from {first_available_date}")

    return df, first_available_date


def get_commodity_info(ticker: str) -> Dict[str, str]:
    """
    Get information about a commodity ticker.

    Parameters
    ----------
    ticker : str
        Yahoo Finance ticker symbol

    Returns
    -------
    Dict[str, str]
        Dictionary with commodity information
    """
    return {
        "ticker": ticker,
        "name": COMMODITY_TICKERS.get(ticker, "Unknown"),
        "simplified_name": COMMODITY_NAMES.get(ticker, ticker),
    }


def get_latest_price(ticker: str) -> Optional[float]:
    """
    Get the latest available price for a commodity.

    Parameters
    ----------
    ticker : str
        Yahoo Finance ticker symbol

    Returns
    -------
    Optional[float]
        Latest price or None if unavailable
    """
    try:
        df, _ = yahoo_quotes(tickers=[ticker], start_date=(pd.Timestamp.today() - pd.Timedelta(days=7)).strftime('%Y-%m-%d'))
        if not df.empty:
            return float(df.iloc[-1, 0])
        return None
    except Exception as e:
        logger.error(f"Failed to get latest price for {ticker}: {e}")
        return None
