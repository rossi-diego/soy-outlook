# 🚀 How to Run the SARIMAX Forecasting Application

## Quick Commands Reference

### Method 1: Run Streamlit App Locally (Fastest)

```bash
# Navigate to project directory
cd /c/Users/d1eg0/Desktop/python/github/sarimax-brazilian-soybean-forecasting

# Install dependencies (first time only)
pip install -r requirements.txt

# Run the application
streamlit run app.py

# Application will open at: http://localhost:8501
```

### Method 2: Run with Docker

```bash
# Navigate to project directory
cd /c/Users/d1eg0/Desktop/python/github/sarimax-brazilian-soybean-forecasting

# Build and run
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

### Method 3: Run Tests

```bash
# Install dev dependencies
pip install -r requirements-dev.txt

# Run all tests
pytest

# Run with coverage
pytest --cov=src --cov-report=html

# Open coverage report
start htmlcov/index.html  # Windows
```

## 📱 Using the Web Application

Once the app is running, you'll see:

### Main Interface Features

1. **Sidebar (Left)**
   - 📊 Data Source Selection (Demo/Live)
   - 🌾 Commodity Selection
   - 📅 Forecast Horizon
   - ⚙️ SARIMAX Parameters

2. **Main Tabs (Center)**
   - **📊 Overview**: Market statistics and correlations
   - **📈 Historical Analysis**: Time series charts
   - **🔮 Forecast**: Generate predictions
   - **📉 Model Diagnostics**: Residual analysis
   - **ℹ️ About**: Documentation

### Step-by-Step Usage

#### Step 1: Select Data Source
```
Sidebar → Data Source → Choose "Demo Data" or "Live Data"
```
- **Demo Data**: No setup required, works immediately
- **Live Data**: Requires internet, fetches real Yahoo Finance data

#### Step 2: Choose Commodity
```
Sidebar → Select Commodity → Choose "soybean", "corn", or "wheat"
```

#### Step 3: Explore Historical Data
```
Click "Historical Analysis" tab → Review price charts
```
- View price history with moving averages
- Analyze returns distribution
- Filter by date range

#### Step 4: Generate Forecast
```
Click "Forecast" tab → Click "🚀 Generate Forecast" button
```
- Model trains automatically
- Forecast displayed with confidence intervals
- Download results as CSV

#### Step 5: Review Diagnostics
```
Click "Model Diagnostics" tab → Review metrics
```
- View MAE, RMSE, MAPE, SMAPE
- Analyze residual plots
- Check model assumptions

## 🎯 Demo Mode (No Setup Required)

For immediate testing without configuration:

```bash
streamlit run app.py
```

Then in the app:
1. Select "Demo Data" in sidebar
2. All features work with sample data
3. No API keys or tokens needed

## 🔧 Configuration (For Live Data)

To use real market data:

1. **Create .env file**
   ```bash
   cp .env.example .env
   ```

2. **Add WASDE JWT token** (optional)
   ```ini
   # Edit .env file
   WASDE_JWT=your_token_here
   ```

3. **Get token from**: https://apps.ams.usda.gov/

Note: WASDE token only needed for USDA agricultural data. Yahoo Finance works without it.

## 📊 Key Features to Showcase

### Interactive Visualizations
- Plotly-powered interactive charts
- Zoom, pan, hover for details
- Professional styling

### Real-Time Forecasting
- SARIMAX model with configurable parameters
- Confidence intervals (95%)
- Multiple forecast horizons (3-24 months)

### Data Export
- Download forecasts as CSV
- Save charts as PNG
- Export model metrics

### Professional UI
- Responsive design
- Clean, modern interface
- Intuitive navigation

## 🐛 Troubleshooting

### Issue: "ModuleNotFoundError"
```bash
# Solution: Install dependencies
pip install -r requirements.txt
```

### Issue: "Port already in use"
```bash
# Solution: Use different port
streamlit run app.py --server.port 8502
```

### Issue: "No data available"
```bash
# Solution: Use Demo Data mode
# In app sidebar, select "Demo Data"
```

### Issue: Docker not working
```bash
# Check logs
docker-compose logs

# Rebuild
docker-compose down
docker-compose up --build
```

## 🎨 Customization

### Change Default Settings
Edit `app.py` around lines 100-120:
```python
# Default forecast horizon
forecast_horizon = st.sidebar.slider(
    "Forecast Horizon (months):",
    min_value=3,
    max_value=24,
    value=12,  # Change this default
    step=3,
)
```

### Add New Commodities
Edit `src/yfinance_utils.py`:
```python
COMMODITY_TICKERS = {
    "ZS=F": "Soybean Futures",
    "ZC=F": "Corn Futures",
    "YOUR_TICKER": "Your Commodity",  # Add here
}
```

### Customize Colors
Edit CSS in `app.py` around lines 40-60:
```python
st.markdown("""
<style>
    .main-header {
        color: #1f77b4;  # Change color
    }
</style>
""", unsafe_allow_html=True)
```

## 📈 Performance Tips

### Faster Loading
```python
# Use caching in Streamlit
@st.cache_data
def load_data():
    # Your data loading code
    pass
```

### Optimize Docker
```bash
# Use multi-stage builds (already configured)
# Reduce image size with .dockerignore
```

### Parallel Testing
```bash
# Run tests in parallel
pytest -n auto
```

## 🚀 Deployment Options

### Streamlit Cloud (Free)
1. Push to GitHub
2. Visit https://share.streamlit.io/
3. Connect repository
4. Deploy automatically

### Heroku
```bash
# Add files: Procfile, setup.sh
echo "web: streamlit run app.py" > Procfile
git push heroku main
```

### AWS/GCP/Azure
- Use Docker image
- Deploy to container service
- Configure load balancer

## 📚 Additional Resources

- **README_NEW.md**: Complete documentation
- **QUICKSTART.md**: 5-minute setup guide
- **CONTRIBUTING.md**: Development guidelines
- **PROJECT_IMPROVEMENTS.md**: What was improved

## 🎓 Learning Resources

### Understanding SARIMAX
- Seasonal patterns: (P,D,Q,s)
- Exogenous variables: External factors
- Walk-forward validation: Time series CV

### Streamlit Documentation
- https://docs.streamlit.io/
- Components: st.sidebar, st.tabs, st.plotly_chart

### Testing with Pytest
- https://docs.pytest.org/
- Fixtures, mocking, coverage

## ✨ Next Steps

After running the app:

1. ✅ Explore demo mode
2. ✅ Generate first forecast
3. ✅ Review model diagnostics
4. ✅ Customize parameters
5. ✅ Export results
6. ✅ Try live data mode
7. ✅ Run tests locally
8. ✅ Deploy to cloud

## 🎯 Interview Demo Script

**1. Introduction (1 min)**
"This is a production-ready time series forecasting system for commodity markets."

**2. Architecture Overview (2 min)**
- Show Docker setup
- Explain CI/CD pipeline
- Highlight testing infrastructure

**3. Live Demo (5 min)**
- Run application
- Generate forecast
- Explain SARIMAX model
- Show interactive features
- Export results

**4. Code Quality (2 min)**
- Show type hints
- Demonstrate logging
- Run tests live
- Highlight documentation

**5. Conclusion (1 min)**
"This project demonstrates full-stack data science: modeling, engineering, deployment, and UX."

---

**Ready to run!** 🌾

Choose your method and start exploring Brazilian soybean forecasts!
