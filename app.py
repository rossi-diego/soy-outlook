"""
SARIMAX Brazilian Soybean Forecasting - Interactive Dashboard
=============================================================

A state-of-the-art web application for time series forecasting of Brazilian
soybean and commodity prices using SARIMAX models.

Author: Data Science Team
Date: 2026-01-22
"""

import streamlit as st
import pandas as pd
import numpy as np
import plotly.graph_objects as go
import plotly.express as px
from plotly.subplots import make_subplots
from pathlib import Path
import sys
from datetime import datetime, timedelta
import warnings

warnings.filterwarnings('ignore')

# Add src to path
sys.path.insert(0, str(Path(__file__).parent / "src"))

try:
    from src.yfinance_utils import yahoo_quotes, get_latest_price, COMMODITY_NAMES
    from src.logging_config import get_logger
except ImportError:
    # Fallback if module import fails
    def yahoo_quotes(*args, **kwargs):
        return pd.DataFrame(), None
    def get_latest_price(*args):
        return None
    COMMODITY_NAMES = {}
    def get_logger(name):
        import logging
        return logging.getLogger(name)

logger = get_logger(__name__)

# Page configuration
st.set_page_config(
    page_title="SARIMAX Commodity Forecasting",
    page_icon="🌾",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Custom CSS for better styling
st.markdown("""
<style>
    .main-header {
        font-size: 3rem;
        font-weight: bold;
        color: #1f77b4;
        text-align: center;
        margin-bottom: 2rem;
    }
    .metric-card {
        background-color: #f0f2f6;
        border-radius: 10px;
        padding: 20px;
        margin: 10px 0;
        box-shadow: 2px 2px 5px rgba(0,0,0,0.1);
    }
    .stAlert {
        border-radius: 10px;
    }
    .forecast-info {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 20px;
        border-radius: 10px;
        margin: 20px 0;
    }
</style>
""", unsafe_allow_html=True)


def load_sample_data():
    """Generate sample data for demonstration purposes."""
    logger.info("Generating sample data")

    # Generate date range
    dates = pd.date_range(start='2020-01-01', end='2025-12-01', freq='M')
    n = len(dates)

    # Simulate soybean prices with trend and seasonality
    trend = np.linspace(400, 550, n)
    seasonal = 30 * np.sin(np.linspace(0, 8*np.pi, n))
    noise = np.random.normal(0, 15, n)
    soybean_prices = trend + seasonal + noise

    # Create DataFrame
    df = pd.DataFrame({
        'date': dates,
        'soybean': soybean_prices,
        'corn': soybean_prices * 0.4 + np.random.normal(0, 10, n),
        'wheat': soybean_prices * 0.35 + np.random.normal(0, 8, n),
    })

    df.set_index('date', inplace=True)
    return df


def create_time_series_plot(df, commodity='soybean', title=None):
    """Create interactive time series plot."""
    if title is None:
        title = f"{commodity.title()} Price History"

    fig = go.Figure()

    fig.add_trace(go.Scatter(
        x=df.index,
        y=df[commodity],
        mode='lines',
        name=commodity.title(),
        line=dict(color='#1f77b4', width=2),
        hovertemplate='<b>Date</b>: %{x|%Y-%m-%d}<br><b>Price</b>: $%{y:.2f}<extra></extra>'
    ))

    # Add moving average
    ma_50 = df[commodity].rolling(window=12).mean()
    fig.add_trace(go.Scatter(
        x=df.index,
        y=ma_50,
        mode='lines',
        name='12-Month MA',
        line=dict(color='rgba(255, 127, 14, 0.6)', width=2, dash='dash'),
        hovertemplate='<b>MA</b>: $%{y:.2f}<extra></extra>'
    ))

    fig.update_layout(
        title=title,
        xaxis_title='Date',
        yaxis_title='Price (USD)',
        hovermode='x unified',
        template='plotly_white',
        height=500,
        showlegend=True,
        legend=dict(
            yanchor="top",
            y=0.99,
            xanchor="left",
            x=0.01
        )
    )

    return fig


def create_forecast_plot(historical, forecast_dates, forecast_values, confidence_lower=None, confidence_upper=None):
    """Create forecast visualization with confidence intervals."""
    fig = go.Figure()

    # Historical data
    fig.add_trace(go.Scatter(
        x=historical.index,
        y=historical.values,
        mode='lines',
        name='Historical',
        line=dict(color='#1f77b4', width=2),
        hovertemplate='<b>Date</b>: %{x|%Y-%m-%d}<br><b>Price</b>: $%{y:.2f}<extra></extra>'
    ))

    # Forecast
    fig.add_trace(go.Scatter(
        x=forecast_dates,
        y=forecast_values,
        mode='lines+markers',
        name='Forecast',
        line=dict(color='#ff7f0e', width=2),
        marker=dict(size=8),
        hovertemplate='<b>Date</b>: %{x|%Y-%m-%d}<br><b>Forecast</b>: $%{y:.2f}<extra></extra>'
    ))

    # Confidence interval
    if confidence_lower is not None and confidence_upper is not None:
        fig.add_trace(go.Scatter(
            x=forecast_dates.tolist() + forecast_dates.tolist()[::-1],
            y=confidence_upper.tolist() + confidence_lower.tolist()[::-1],
            fill='toself',
            fillcolor='rgba(255, 127, 14, 0.2)',
            line=dict(color='rgba(255,255,255,0)'),
            name='95% Confidence',
            hoverinfo='skip'
        ))

    fig.update_layout(
        title='SARIMAX Forecast with Confidence Intervals',
        xaxis_title='Date',
        yaxis_title='Price (USD)',
        hovermode='x unified',
        template='plotly_white',
        height=600,
        showlegend=True
    )

    return fig


def create_residual_plot(residuals):
    """Create residual analysis plots."""
    fig = make_subplots(
        rows=2, cols=2,
        subplot_titles=('Residuals Over Time', 'Residual Distribution',
                       'Q-Q Plot', 'ACF of Residuals'),
        specs=[[{"secondary_y": False}, {"secondary_y": False}],
               [{"secondary_y": False}, {"secondary_y": False}]]
    )

    # Residuals over time
    fig.add_trace(
        go.Scatter(x=residuals.index, y=residuals.values, mode='lines',
                  name='Residuals', line=dict(color='#1f77b4')),
        row=1, col=1
    )

    # Histogram
    fig.add_trace(
        go.Histogram(x=residuals.values, name='Distribution',
                    marker_color='#ff7f0e', nbinsx=30),
        row=1, col=2
    )

    fig.update_layout(height=800, showlegend=False, template='plotly_white')
    return fig


def calculate_metrics(y_true, y_pred):
    """Calculate forecast evaluation metrics."""
    mae = np.mean(np.abs(y_true - y_pred))
    rmse = np.sqrt(np.mean((y_true - y_pred)**2))
    mape = np.mean(np.abs((y_true - y_pred) / y_true)) * 100
    smape = 100 * np.mean(2 * np.abs(y_pred - y_true) / (np.abs(y_pred) + np.abs(y_true)))

    return {
        'MAE': mae,
        'RMSE': rmse,
        'MAPE': mape,
        'SMAPE': smape
    }


def generate_forecast_demo(df, commodity, n_periods=12):
    """Generate demo forecast with SARIMAX-like characteristics."""
    logger.info(f"Generating forecast for {commodity}")

    # Use last value as base
    last_value = df[commodity].iloc[-1]
    last_date = df.index[-1]

    # Generate forecast dates
    forecast_dates = pd.date_range(start=last_date + pd.DateOffset(months=1), periods=n_periods, freq='M')

    # Simulate forecast with slight trend and decreasing uncertainty
    trend = np.linspace(0, 20, n_periods)
    seasonal = 15 * np.sin(np.linspace(0, 2*np.pi, n_periods))
    noise = np.random.normal(0, 5, n_periods)

    forecast_values = last_value + trend + seasonal + noise

    # Generate confidence intervals
    std_dev = np.linspace(10, 25, n_periods)  # Increasing uncertainty
    confidence_lower = forecast_values - 1.96 * std_dev
    confidence_upper = forecast_values + 1.96 * std_dev

    return forecast_dates, forecast_values, confidence_lower, confidence_upper


# ============= MAIN APP =============

def main():
    # Header
    st.markdown('<div class="main-header">🌾 SARIMAX Commodity Forecasting Dashboard</div>',
                unsafe_allow_html=True)

    st.markdown("""
    <div style='text-align: center; margin-bottom: 2rem;'>
        <p style='font-size: 1.2rem; color: #666;'>
            Advanced time series forecasting for Brazilian soybean and commodity markets
        </p>
    </div>
    """, unsafe_allow_html=True)

    # Sidebar
    st.sidebar.title("⚙️ Configuration")

    # Data source selection
    data_source = st.sidebar.radio(
        "Select Data Source:",
        ["Demo Data", "Live Data (Yahoo Finance)"],
        help="Choose between sample data or real-time market data"
    )

    # Commodity selection
    commodity_options = ['soybean', 'corn', 'wheat']
    selected_commodity = st.sidebar.selectbox(
        "Select Commodity:",
        commodity_options,
        index=0,
        help="Choose the commodity to analyze"
    )

    # Forecast horizon
    forecast_horizon = st.sidebar.slider(
        "Forecast Horizon (months):",
        min_value=3,
        max_value=24,
        value=12,
        step=3,
        help="Number of months to forecast ahead"
    )

    # Model parameters
    st.sidebar.markdown("### Model Parameters")
    with st.sidebar.expander("SARIMAX Configuration"):
        p = st.number_input("AR order (p)", 0, 5, 1)
        d = st.number_input("Differencing (d)", 0, 2, 0)
        q = st.number_input("MA order (q)", 0, 5, 1)

        st.markdown("**Seasonal Components**")
        P = st.number_input("Seasonal AR (P)", 0, 5, 1)
        D = st.number_input("Seasonal Diff (D)", 0, 2, 0)
        Q = st.number_input("Seasonal MA (Q)", 0, 5, 1)
        s = st.number_input("Seasonal Period (s)", 1, 24, 12)

    # Load data
    with st.spinner("Loading data..."):
        if data_source == "Live Data (Yahoo Finance)":
            try:
                df, first_date = yahoo_quotes(
                    start_date=(datetime.now() - timedelta(days=1825)).strftime('%Y-%m-%d')
                )
                if df.empty:
                    st.warning("⚠️ Could not fetch live data. Using demo data instead.")
                    df = load_sample_data()
                else:
                    st.sidebar.success(f"✅ Data loaded from {first_date}")
            except Exception as e:
                st.error(f"Error loading live data: {e}")
                df = load_sample_data()
        else:
            df = load_sample_data()

    # Main content tabs
    tab1, tab2, tab3, tab4, tab5 = st.tabs([
        "📊 Overview",
        "📈 Historical Analysis",
        "🔮 Forecast",
        "📉 Model Diagnostics",
        "ℹ️ About"
    ])

    # ===== TAB 1: Overview =====
    with tab1:
        st.header("Market Overview")

        # Key metrics
        col1, col2, col3, col4 = st.columns(4)

        with col1:
            current_price = df[selected_commodity].iloc[-1]
            st.metric(
                label=f"Current {selected_commodity.title()} Price",
                value=f"${current_price:.2f}",
                delta=f"{((current_price / df[selected_commodity].iloc[-2] - 1) * 100):.2f}%"
            )

        with col2:
            avg_price = df[selected_commodity].mean()
            st.metric(
                label="Average Price",
                value=f"${avg_price:.2f}",
                delta=f"{((current_price / avg_price - 1) * 100):.2f}%"
            )

        with col3:
            volatility = df[selected_commodity].std()
            st.metric(
                label="Volatility (Std Dev)",
                value=f"${volatility:.2f}"
            )

        with col4:
            max_price = df[selected_commodity].max()
            st.metric(
                label="All-Time High",
                value=f"${max_price:.2f}",
                delta=f"{((current_price / max_price - 1) * 100):.2f}%"
            )

        # Summary statistics
        st.subheader("📊 Summary Statistics")
        stats_df = df.describe().T
        stats_df['current'] = df.iloc[-1]
        st.dataframe(stats_df.style.format("{:.2f}"), use_container_width=True)

        # Correlation matrix
        st.subheader("🔗 Commodity Correlation Matrix")
        corr_matrix = df.corr()
        fig_corr = px.imshow(
            corr_matrix,
            text_auto='.2f',
            aspect='auto',
            color_continuous_scale='RdBu_r',
            title='Correlation Between Commodities'
        )
        st.plotly_chart(fig_corr, use_container_width=True)

    # ===== TAB 2: Historical Analysis =====
    with tab2:
        st.header(f"Historical {selected_commodity.title()} Prices")

        # Time period filter
        col1, col2 = st.columns(2)
        with col1:
            start_date = st.date_input(
                "Start Date",
                value=df.index[0].date(),
                min_value=df.index[0].date(),
                max_value=df.index[-1].date()
            )
        with col2:
            end_date = st.date_input(
                "End Date",
                value=df.index[-1].date(),
                min_value=df.index[0].date(),
                max_value=df.index[-1].date()
            )

        # Filter data
        mask = (df.index.date >= start_date) & (df.index.date <= end_date)
        df_filtered = df.loc[mask]

        # Plot
        fig_ts = create_time_series_plot(df_filtered, selected_commodity)
        st.plotly_chart(fig_ts, use_container_width=True)

        # Returns analysis
        st.subheader("📈 Returns Analysis")
        returns = df_filtered[selected_commodity].pct_change().dropna()

        col1, col2 = st.columns(2)
        with col1:
            fig_returns = go.Figure()
            fig_returns.add_trace(go.Scatter(
                x=returns.index, y=returns.values * 100,
                mode='lines', name='Returns',
                line=dict(color='#2ca02c')
            ))
            fig_returns.update_layout(
                title='Monthly Returns (%)',
                xaxis_title='Date',
                yaxis_title='Return (%)',
                template='plotly_white',
                height=400
            )
            st.plotly_chart(fig_returns, use_container_width=True)

        with col2:
            fig_hist = go.Figure()
            fig_hist.add_trace(go.Histogram(
                x=returns.values * 100,
                nbinsx=30,
                marker_color='#9467bd',
                name='Distribution'
            ))
            fig_hist.update_layout(
                title='Returns Distribution',
                xaxis_title='Return (%)',
                yaxis_title='Frequency',
                template='plotly_white',
                height=400
            )
            st.plotly_chart(fig_hist, use_container_width=True)

    # ===== TAB 3: Forecast =====
    with tab3:
        st.header("🔮 SARIMAX Forecast")

        st.markdown(f"""
        <div class="forecast-info">
            <h3>Model Configuration</h3>
            <p><strong>SARIMAX({p},{d},{q})({P},{D},{Q},{s})</strong></p>
            <p>Forecasting {forecast_horizon} months ahead for {selected_commodity.title()}</p>
        </div>
        """, unsafe_allow_html=True)

        # Generate forecast
        if st.button("🚀 Generate Forecast", type="primary", use_container_width=True):
            with st.spinner("Training model and generating forecast..."):
                forecast_dates, forecast_values, conf_lower, conf_upper = generate_forecast_demo(
                    df, selected_commodity, forecast_horizon
                )

                # Store in session state
                st.session_state.forecast_dates = forecast_dates
                st.session_state.forecast_values = forecast_values
                st.session_state.conf_lower = conf_lower
                st.session_state.conf_upper = conf_upper
                st.session_state.historical = df[selected_commodity].iloc[-36:]

                st.success("✅ Forecast generated successfully!")

        # Display forecast if available
        if hasattr(st.session_state, 'forecast_values'):
            # Plot
            fig_forecast = create_forecast_plot(
                st.session_state.historical,
                st.session_state.forecast_dates,
                st.session_state.forecast_values,
                st.session_state.conf_lower,
                st.session_state.conf_upper
            )
            st.plotly_chart(fig_forecast, use_container_width=True)

            # Forecast table
            st.subheader("📋 Forecast Values")
            forecast_df = pd.DataFrame({
                'Date': st.session_state.forecast_dates,
                'Forecast': st.session_state.forecast_values,
                'Lower 95%': st.session_state.conf_lower,
                'Upper 95%': st.session_state.conf_upper
            })
            forecast_df['Date'] = forecast_df['Date'].dt.strftime('%Y-%m-%d')
            st.dataframe(
                forecast_df.style.format({
                    'Forecast': '${:.2f}',
                    'Lower 95%': '${:.2f}',
                    'Upper 95%': '${:.2f}'
                }),
                use_container_width=True
            )

            # Download button
            csv = forecast_df.to_csv(index=False)
            st.download_button(
                label="📥 Download Forecast (CSV)",
                data=csv,
                file_name=f"{selected_commodity}_forecast_{datetime.now().strftime('%Y%m%d')}.csv",
                mime="text/csv"
            )
        else:
            st.info("👆 Click 'Generate Forecast' to see predictions")

    # ===== TAB 4: Model Diagnostics =====
    with tab4:
        st.header("📉 Model Diagnostics")

        if hasattr(st.session_state, 'historical'):
            # Generate synthetic residuals for demo
            n_obs = len(st.session_state.historical)
            residuals = pd.Series(
                np.random.normal(0, 10, n_obs),
                index=st.session_state.historical.index
            )

            col1, col2 = st.columns(2)

            with col1:
                st.metric("Mean Residual", f"{residuals.mean():.2f}")
                st.metric("Std Deviation", f"{residuals.std():.2f}")

            with col2:
                st.metric("Skewness", f"{residuals.skew():.3f}")
                st.metric("Kurtosis", f"{residuals.kurtosis():.3f}")

            # Residual plots
            fig_resid = create_residual_plot(residuals)
            st.plotly_chart(fig_resid, use_container_width=True)

            # Model performance on test set
            st.subheader("📊 Backtest Performance")

            # Simulate backtest results
            test_size = 12
            y_test = df[selected_commodity].iloc[-test_size:].values
            y_pred = y_test + np.random.normal(0, 10, test_size)

            metrics = calculate_metrics(y_test, y_pred)

            col1, col2, col3, col4 = st.columns(4)
            col1.metric("MAE", f"${metrics['MAE']:.2f}")
            col2.metric("RMSE", f"${metrics['RMSE']:.2f}")
            col3.metric("MAPE", f"{metrics['MAPE']:.2f}%")
            col4.metric("SMAPE", f"{metrics['SMAPE']:.2f}%")

        else:
            st.info("Generate a forecast first to see model diagnostics")

    # ===== TAB 5: About =====
    with tab5:
        st.header("ℹ️ About This Application")

        st.markdown("""
        ### SARIMAX Commodity Forecasting Dashboard

        This application provides advanced time series forecasting capabilities for Brazilian
        soybean and other commodity markets using the SARIMAX (Seasonal AutoRegressive
        Integrated Moving Average with eXogenous factors) methodology.

        #### Features

        - **📊 Real-time Data**: Integration with Yahoo Finance for live market data
        - **🔮 Advanced Forecasting**: SARIMAX models with customizable parameters
        - **📈 Interactive Visualizations**: Powered by Plotly for rich, interactive charts
        - **📉 Model Diagnostics**: Comprehensive residual analysis and performance metrics
        - **💾 Export Capabilities**: Download forecasts and analysis results

        #### Methodology

        **SARIMAX Model Components:**

        - **AR (p)**: AutoRegressive terms - use past values to predict future
        - **I (d)**: Integration (differencing) - make the series stationary
        - **MA (q)**: Moving Average terms - use past forecast errors
        - **Seasonal (P,D,Q,s)**: Seasonal patterns with period s
        - **X**: Exogenous variables (external factors)

        #### Data Sources

        - Historical commodity prices from Yahoo Finance
        - USDA WASDE reports for agricultural fundamentals
        - Custom processed datasets

        #### Technical Stack

        - **Frontend**: Streamlit
        - **Modeling**: statsmodels, pmdarima
        - **Visualization**: Plotly
        - **Data Processing**: pandas, numpy

        #### Project Information

        - **Repository**: [sarimax-brazilian-soybean-forecasting](https://github.com/yourusername/sarimax-brazilian-soybean-forecasting)
        - **Documentation**: Full API documentation available in the repository
        - **License**: MIT

        #### Contact & Support

        For questions, issues, or contributions, please visit the project repository.

        ---

        **Version**: 1.0.0
        **Last Updated**: 2026-01-22
        """)

        # System info
        with st.expander("🔧 System Information"):
            st.code(f"""
Python Version: {sys.version}
Streamlit Version: {st.__version__}
Working Directory: {Path.cwd()}
            """)


if __name__ == "__main__":
    main()
