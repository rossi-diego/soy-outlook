# 🌾 SARIMAX Brazilian Soybean Forecasting

[![CI/CD](https://github.com/YOUR_USERNAME/sarimax-brazilian-soybean-forecasting/workflows/CI%2FCD%20Pipeline/badge.svg)](https://github.com/YOUR_USERNAME/sarimax-brazilian-soybean-forecasting/actions)
[![Python 3.9+](https://img.shields.io/badge/python-3.9+-blue.svg)](https://www.python.org/downloads/)
[![Code style: black](https://img.shields.io/badge/code%20style-black-000000.svg)](https://github.com/psf/black)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Streamlit App](https://static.streamlit.io/badges/streamlit_badge_black_white.svg)](https://share.streamlit.io/)

> **A production-ready, state-of-the-art time series forecasting system for Brazilian soybean and commodity markets using SARIMAX models with interactive web dashboard.**

---

## 🎯 Overview

This project implements an enterprise-grade forecasting pipeline for Brazilian Paranaguá soybean prices and other agricultural commodities. It combines advanced time series analysis (SARIMAX), feature engineering, and scenario-based forecasting with a modern, interactive web interface built on Streamlit.

### Key Highlights

- **📊 Interactive Dashboard**: Beautiful, responsive Streamlit web app for exploring data and forecasts
- **🤖 Advanced ML**: SARIMAX models with automatic hyperparameter tuning using pmdarima
- **🔧 Production-Ready**: Complete with Docker, CI/CD, logging, testing, and monitoring
- **📈 Real-Time Data**: Integration with Yahoo Finance and USDA WASDE APIs
- **🎨 Rich Visualizations**: Interactive Plotly charts with confidence intervals
- **🧪 Comprehensive Testing**: 70%+ test coverage with pytest
- **📦 Model Versioning**: Built-in model serialization and version management

---

## 📈 Model Performance

### SARIMAX(1,0,1)(1,0,1,12) Results

| Metric | Value | Benchmark (Naive) |
|--------|-------|-------------------|
| **MAE** | 5.96 | 54.06 |
| **RMSE** | 7.15 | 57.52 |
| **MAPE** | 1.46% | 13.59% |
| **SMAPE** | 1.46% | - |
| **R²** | 0.8677 | - |

### Top Predictive Features

1. **corn_soy_price_interaction** (74.37%) - Primary driver
2. **corn_soy_price_interaction_lag1** (16.99%)
3. **exports_corn_cy_unitedstates** (0.63%)
4. **production_corn_oy_unitedstates** (0.58%)
5. **log_corn_quote** (0.41%)

### Scenario Analysis

| Scenario | Price Range | Mean Change | Volatility |
|----------|-------------|-------------|------------|
| **Base Case** | $403-$407 | -2.02% | Low (σ=1.25) |
| **Optimistic** | $423-$426 | +2.70% | Low (σ=1.25) |
| **Pessimistic** | $383-$386 | -7.00% | Very Low (σ=0.81) |

---

## 🚀 Quick Start

### Option 1: Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/sarimax-brazilian-soybean-forecasting.git
cd sarimax-brazilian-soybean-forecasting

# Create .env file
cp .env.example .env
# Edit .env and add your WASDE_JWT token

# Run with Docker Compose
docker-compose up -d

# Access the app at http://localhost:8501
```

### Option 2: Local Installation

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/sarimax-brazilian-soybean-forecasting.git
cd sarimax-brazilian-soybean-forecasting

# Create virtual environment (Python 3.9+)
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install --upgrade pip
pip install -r requirements.txt

# Set up environment variables
cp .env.example .env
# Edit .env and add your WASDE_JWT token

# Run the Streamlit app
streamlit run app.py
```

### Option 3: Jupyter Notebooks

```bash
# Install dev dependencies
pip install -r requirements-dev.txt

# Start Jupyter
jupyter notebook

# Open notebooks in the notebooks/ directory
```

---

## 📁 Project Structure

```
sarimax-brazilian-soybean-forecasting/
│
├── 📱 app.py                          # Streamlit web application (MAIN ENTRY)
├── 📋 requirements.txt                # Production dependencies
├── 📋 requirements-dev.txt            # Development dependencies
├── 🐳 Dockerfile                      # Docker container configuration
├── 🐳 docker-compose.yml              # Docker Compose orchestration
├── ⚙️ pytest.ini                      # Pytest configuration
├── 📄 .env.example                    # Environment variables template
├── 📖 README.md                       # This file
│
├── 📂 src/                            # Source code
│   ├── __init__.py
│   ├── config.py                      # Project configuration & paths
│   ├── logging_config.py              # Logging setup (loguru)
│   ├── yfinance_utils.py              # Yahoo Finance data fetching (IMPROVED)
│   ├── model_utils.py                 # SARIMAX modeling utilities
│   ├── model_manager.py               # Model serialization & versioning (NEW)
│   ├── eda_utils.py                   # Exploratory data analysis
│   └── wasde_functions.py             # WASDE data processing
│
├── 📂 tests/                          # Test suite (NEW)
│   ├── __init__.py
│   ├── test_yfinance_utils.py         # Unit tests for data fetching
│   ├── test_model_utils.py            # Unit tests for modeling
│   └── test_model_manager.py          # Unit tests for model management
│
├── 📂 notebooks/                      # Jupyter notebooks
│   ├── 01-wasde_exploration.ipynb     # WASDE data exploration
│   ├── 03-eda.ipynb                   # Exploratory Data Analysis
│   └── 04-sarimax.ipynb               # SARIMAX modeling
│
├── 📂 data/                           # Data directory
│   ├── raw_data/                      # Raw datasets
│   ├── processed_data/                # Processed datasets
│   └── wasde_files/                   # WASDE reports
│
├── 📂 models/                         # Saved models (NEW)
│   ├── artifacts/                     # Model files (.joblib)
│   └── metadata/                      # Model metadata (.json)
│
├── 📂 logs/                           # Application logs (NEW)
│   ├── app.log                        # General logs
│   └── errors.log                     # Error logs
│
├── 📂 .github/                        # GitHub Actions (NEW)
│   └── workflows/
│       └── ci.yml                     # CI/CD pipeline
│
└── 📂 output/                         # Generated outputs
    └── images/                        # Visualizations
```

---

## 🎨 Features

### 🌐 Interactive Web Dashboard

- **📊 Market Overview**: Real-time prices, statistics, and correlations
- **📈 Historical Analysis**: Interactive time series charts with moving averages
- **🔮 Forecasting**: Generate forecasts with customizable horizons (3-24 months)
- **📉 Model Diagnostics**: Residual analysis and performance metrics
- **💾 Export**: Download forecasts as CSV

### 🤖 Advanced Modeling

- **SARIMAX Implementation**: Full seasonal ARIMA with exogenous variables
- **Auto Parameter Selection**: Using pmdarima's auto_arima
- **Walk-Forward Validation**: Robust out-of-sample testing
- **Feature Engineering**: Automated lag features and interactions
- **Feature Selection**: Random Forest importance ranking
- **Scenario Analysis**: Optimistic, base, and pessimistic forecasts

### 🔧 Production Features

- **Logging**: Structured logging with loguru (console + file)
- **Model Versioning**: Automatic model serialization with metadata
- **Type Hints**: Full type annotations for better IDE support
- **Input Validation**: Comprehensive error handling
- **Docker Support**: Containerized deployment
- **CI/CD**: Automated testing and linting via GitHub Actions
- **Testing**: 70%+ code coverage with pytest

---

## 📊 Data Sources

### USDA WASDE Reports
- **Source**: Cornell USDA API
- **Frequency**: Monthly
- **Coverage**: Global agricultural supply/demand estimates
- **Authentication**: Requires JWT token (see Configuration)

### Yahoo Finance
- **Source**: yfinance library
- **Coverage**: Commodity futures prices (ZS=F, ZC=F, ZW=F, etc.)
- **Frequency**: Daily
- **Historical**: From 2000-01-01 to present

---

## ⚙️ Configuration

### Environment Variables

Create a `.env` file in the project root:

```ini
# Required: WASDE API Token
WASDE_JWT=your_jwt_token_here

# Optional: Streamlit Configuration
STREAMLIT_SERVER_PORT=8501
STREAMLIT_SERVER_ADDRESS=0.0.0.0
STREAMLIT_SERVER_HEADLESS=true
```

### Obtaining WASDE JWT Token

1. Visit [Cornell USDA API Portal](https://apps.ams.usda.gov/)
2. Register for an account
3. Generate API token from dashboard
4. Copy token to `.env` file

---

## 🧪 Development

### Running Tests

```bash
# Run all tests with coverage
pytest

# Run specific test file
pytest tests/test_yfinance_utils.py -v

# Run with coverage report
pytest --cov=src --cov-report=html

# View coverage report
open htmlcov/index.html
```

### Code Quality

```bash
# Format code with black
black src/ tests/ app.py

# Sort imports with isort
isort src/ tests/ app.py

# Lint with flake8
flake8 src/ tests/ app.py --max-line-length=120

# Type checking with mypy
mypy src/
```

### Pre-commit Hooks

```bash
# Install pre-commit hooks
pre-commit install

# Run manually
pre-commit run --all-files
```

---

## 🐳 Docker Deployment

### Build and Run

```bash
# Build image
docker build -t sarimax-forecasting .

# Run container
docker run -p 8501:8501 --env-file .env sarimax-forecasting

# Or use Docker Compose
docker-compose up -d
```

### Docker Commands

```bash
# View logs
docker-compose logs -f

# Stop services
docker-compose down

# Rebuild after changes
docker-compose up -d --build
```

---

## 📚 Usage Examples

### Running the Web App

```bash
streamlit run app.py
```

Then navigate to `http://localhost:8501`

### Using the Model Manager (Python)

```python
from src.model_manager import ModelManager
from src.model_utils import walk_forward_forecast

# Initialize manager
manager = ModelManager()

# Train model
y_true, y_pred, dates = walk_forward_forecast(
    y=prices,
    exog=features,
    order=(1, 0, 1),
    seasonal_order=(1, 0, 1, 12)
)

# Save model
version = manager.save_model(
    model=model_results,
    commodity='soybean',
    metadata={
        'rmse': 7.15,
        'mae': 5.96,
        'r2': 0.8677
    }
)

# Load model
model, metadata = manager.load_model('soybean', version='latest')
```

### Fetching Data

```python
from src.yfinance_utils import yahoo_quotes, get_latest_price

# Fetch historical data
df, first_date = yahoo_quotes(
    start_date='2020-01-01',
    end_date='2023-12-31'
)

# Get latest price
current_price = get_latest_price('ZS=F')  # Soybean futures
```

---

## 📖 API Documentation

### Core Modules

#### `yfinance_utils.py`
- `yahoo_quotes()`: Fetch commodity price data from Yahoo Finance
- `get_latest_price()`: Get most recent price for a ticker
- `get_commodity_info()`: Retrieve ticker information

#### `model_utils.py`
- `walk_forward_forecast()`: Perform walk-forward validation
- `print_model_evaluation()`: Display model metrics
- `print_forecast_summary()`: Show forecast statistics

#### `model_manager.py`
- `ModelManager.save_model()`: Serialize trained models
- `ModelManager.load_model()`: Load saved models
- `ModelManager.list_models()`: View all saved models
- `ModelManager.delete_model()`: Remove old models

#### `logging_config.py`
- `get_logger()`: Create configured logger instance

---

## 🔍 Methodology

### SARIMAX Model

**Components:**
- **AR (p)**: Autoregressive - uses past values
- **I (d)**: Integration - differencing for stationarity
- **MA (q)**: Moving Average - uses past errors
- **Seasonal (P,D,Q,s)**: Seasonal patterns
- **X**: Exogenous variables (external features)

**Parameter Selection:**
- Automated using `pmdarima.auto_arima`
- AIC/BIC information criteria
- Walk-forward validation for confirmation

### Feature Engineering

1. **Lag Features**: 1-3 month lags of key variables
2. **Interactions**: Price ratios and multiplicative terms
3. **Transformations**: Log prices, squared terms
4. **Selection**: Random Forest feature importance

### Validation Strategy

- **Train/Test Split**: 175 observations
- **Walk-Forward**: Rolling 6-12 month windows
- **Metrics**: MAE, RMSE, MAPE, SMAPE, R²
- **Benchmark**: Naive forecast comparison

---

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Make your changes** and add tests
4. **Run tests**: `pytest` (must pass)
5. **Format code**: `black . && isort .`
6. **Commit**: `git commit -m 'Add amazing feature'`
7. **Push**: `git push origin feature/amazing-feature`
8. **Open a Pull Request**

### Development Guidelines

- Write tests for new features (maintain 70%+ coverage)
- Follow PEP 8 style guidelines (enforced by black/flake8)
- Add type hints to all functions
- Update documentation for API changes
- Keep commits atomic and descriptive

---

## 🐛 Troubleshooting

### Common Issues

**Issue**: `ModuleNotFoundError: No module named 'src'`
```bash
# Solution: Add src to PYTHONPATH
export PYTHONPATH="${PYTHONPATH}:${PWD}/src"
```

**Issue**: `EnvironmentError: Missing WASDE_JWT in your .env file`
```bash
# Solution: Create .env file with token
echo "WASDE_JWT=your_token_here" > .env
```

**Issue**: Docker container exits immediately
```bash
# Solution: Check logs
docker-compose logs streamlit-app
# Ensure .env file exists and has valid token
```

**Issue**: Streamlit app shows "No data available"
```bash
# Solution: Check internet connectivity and API access
# Verify Yahoo Finance is accessible
# Fall back to demo data if needed
```

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- **USDA WASDE**: Agricultural market data
- **Yahoo Finance**: Historical commodity prices
- **Streamlit**: Interactive web framework
- **statsmodels**: SARIMAX implementation
- **pmdarima**: Automated parameter selection

---

## 📞 Contact & Support

- **Issues**: [GitHub Issues](https://github.com/YOUR_USERNAME/sarimax-brazilian-soybean-forecasting/issues)
- **Discussions**: [GitHub Discussions](https://github.com/YOUR_USERNAME/sarimax-brazilian-soybean-forecasting/discussions)
- **Email**: your.email@example.com

---

## 🎓 Citation

If you use this project in your research, please cite:

```bibtex
@software{sarimax_soybean_2026,
  author = {Your Name},
  title = {SARIMAX Brazilian Soybean Forecasting},
  year = {2026},
  url = {https://github.com/YOUR_USERNAME/sarimax-brazilian-soybean-forecasting}
}
```

---

## 📊 Project Status

- ✅ Core modeling functionality
- ✅ Interactive web dashboard
- ✅ Docker deployment
- ✅ CI/CD pipeline
- ✅ Comprehensive testing
- ✅ Model versioning
- 🚧 Real-time model retraining (In Progress)
- 🚧 Multi-commodity ensemble models (Planned)
- 🚧 REST API endpoints (Planned)

---

**Version**: 1.0.0
**Last Updated**: January 22, 2026
**Status**: Production-Ready

Made with ❤️ for the agricultural commodities community
