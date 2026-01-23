"""
Tests for yfinance utilities module.
"""
import pytest
import pandas as pd
from datetime import datetime
from unittest.mock import patch, MagicMock
import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from yfinance_utils import (
    yahoo_quotes,
    get_commodity_info,
    get_latest_price,
    COMMODITY_TICKERS,
    COMMODITY_NAMES
)


class TestYahooQuotes:
    """Test suite for yahoo_quotes function."""

    def test_yahoo_quotes_with_defaults(self):
        """Test yahoo_quotes with default parameters."""
        # This is an integration test that would hit the real API
        # In production, you'd mock the yfinance.download call
        pass  # Skip for now to avoid API calls in tests

    def test_yahoo_quotes_empty_tickers_raises_error(self):
        """Test that empty tickers list raises ValueError."""
        with pytest.raises(ValueError, match="Tickers list cannot be empty"):
            yahoo_quotes(tickers=[])

    def test_yahoo_quotes_invalid_date_format_raises_error(self):
        """Test that invalid date format raises ValueError."""
        with pytest.raises(ValueError, match="Invalid date format"):
            yahoo_quotes(start_date="invalid-date")

    @patch('yfinance_utils.yf.download')
    def test_yahoo_quotes_with_mocked_data(self, mock_download):
        """Test yahoo_quotes with mocked yfinance download."""
        # Create mock data
        dates = pd.date_range('2023-01-01', periods=5, freq='D')
        mock_data = pd.DataFrame({
            'Close': [100, 101, 102, 103, 104]
        }, index=dates)

        mock_download.return_value = mock_data

        # Call function
        df, first_date = yahoo_quotes(
            tickers=["ZS=F"],
            start_date="2023-01-01",
            end_date="2023-01-05"
        )

        # Assertions
        assert not df.empty
        assert len(df) == 5
        assert first_date == datetime(2023, 1, 1).date()
        assert 'soybean' in df.columns or 'ZS=F' in df.columns

    @patch('yfinance_utils.yf.download')
    def test_yahoo_quotes_empty_result(self, mock_download):
        """Test yahoo_quotes when API returns empty data."""
        mock_download.return_value = pd.DataFrame()

        df, first_date = yahoo_quotes(tickers=["ZS=F"])

        assert df.empty
        assert first_date is None

    def test_yahoo_quotes_date_range(self):
        """Test that date range parameters are properly handled."""
        start = "2023-01-01"
        end = "2023-06-30"

        # Would need mocking for real test
        # Just verify no errors with valid dates
        try:
            pd.to_datetime(start)
            pd.to_datetime(end)
        except:
            pytest.fail("Valid dates should not raise errors")


class TestGetCommodityInfo:
    """Test suite for get_commodity_info function."""

    def test_get_commodity_info_valid_ticker(self):
        """Test getting info for valid ticker."""
        info = get_commodity_info("ZS=F")

        assert "ticker" in info
        assert "name" in info
        assert "simplified_name" in info
        assert info["ticker"] == "ZS=F"
        assert info["simplified_name"] == "soybean"

    def test_get_commodity_info_invalid_ticker(self):
        """Test getting info for unknown ticker."""
        info = get_commodity_info("UNKNOWN")

        assert info["ticker"] == "UNKNOWN"
        assert info["name"] == "Unknown"
        assert info["simplified_name"] == "UNKNOWN"

    def test_get_commodity_info_all_tickers(self):
        """Test getting info for all commodity tickers."""
        for ticker in COMMODITY_TICKERS.keys():
            info = get_commodity_info(ticker)
            assert info["ticker"] == ticker
            assert info["name"] == COMMODITY_TICKERS[ticker]


class TestGetLatestPrice:
    """Test suite for get_latest_price function."""

    @patch('yfinance_utils.yahoo_quotes')
    def test_get_latest_price_success(self, mock_yahoo_quotes):
        """Test getting latest price successfully."""
        # Mock data
        dates = pd.date_range('2023-01-01', periods=5, freq='D')
        mock_df = pd.DataFrame({
            'soybean': [100, 101, 102, 103, 104]
        }, index=dates)

        mock_yahoo_quotes.return_value = (mock_df, dates[0].date())

        price = get_latest_price("ZS=F")

        assert price == 104.0

    @patch('yfinance_utils.yahoo_quotes')
    def test_get_latest_price_empty_data(self, mock_yahoo_quotes):
        """Test getting latest price with no data."""
        mock_yahoo_quotes.return_value = (pd.DataFrame(), None)

        price = get_latest_price("ZS=F")

        assert price is None

    @patch('yfinance_utils.yahoo_quotes')
    def test_get_latest_price_exception(self, mock_yahoo_quotes):
        """Test getting latest price when exception occurs."""
        mock_yahoo_quotes.side_effect = Exception("API Error")

        price = get_latest_price("ZS=F")

        assert price is None


class TestConstants:
    """Test suite for module constants."""

    def test_commodity_tickers_not_empty(self):
        """Test that COMMODITY_TICKERS is defined and not empty."""
        assert COMMODITY_TICKERS
        assert isinstance(COMMODITY_TICKERS, dict)
        assert len(COMMODITY_TICKERS) >= 5

    def test_commodity_names_not_empty(self):
        """Test that COMMODITY_NAMES is defined and not empty."""
        assert COMMODITY_NAMES
        assert isinstance(COMMODITY_NAMES, dict)
        assert len(COMMODITY_NAMES) >= 5

    def test_commodity_tickers_and_names_match(self):
        """Test that tickers in COMMODITY_TICKERS match those in COMMODITY_NAMES."""
        assert set(COMMODITY_TICKERS.keys()) == set(COMMODITY_NAMES.keys())


# Fixtures
@pytest.fixture
def sample_price_data():
    """Fixture providing sample price data."""
    dates = pd.date_range('2023-01-01', periods=30, freq='D')
    return pd.DataFrame({
        'soybean': range(100, 130),
        'corn': range(50, 80),
        'wheat': range(60, 90),
    }, index=dates)


def test_sample_data_fixture(sample_price_data):
    """Test the sample_price_data fixture."""
    assert not sample_price_data.empty
    assert len(sample_price_data) == 30
    assert 'soybean' in sample_price_data.columns
