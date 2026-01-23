# 🚀 Quick Start Guide

Get up and running with the SARIMAX Brazilian Soybean Forecasting application in 5 minutes!

## Prerequisites

- Python 3.9 or higher
- pip (Python package manager)
- Git
- (Optional) Docker Desktop

## Installation Methods

### Method 1: Quick Local Setup (Recommended for Development)

```bash
# 1. Clone the repository
git clone https://github.com/YOUR_USERNAME/sarimax-brazilian-soybean-forecasting.git
cd sarimax-brazilian-soybean-forecasting

# 2. Create virtual environment
python -m venv venv

# 3. Activate virtual environment
# On Windows:
venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate

# 4. Install dependencies
pip install --upgrade pip
pip install -r requirements.txt

# 5. Set up environment variables
cp .env.example .env
# Edit .env and add your WASDE_JWT token

# 6. Run the application
streamlit run app.py
```

The app will automatically open in your browser at `http://localhost:8501`

### Method 2: Docker (Recommended for Production)

```bash
# 1. Clone the repository
git clone https://github.com/YOUR_USERNAME/sarimax-brazilian-soybean-forecasting.git
cd sarimax-brazilian-soybean-forecasting

# 2. Set up environment variables
cp .env.example .env
# Edit .env and add your WASDE_JWT token

# 3. Run with Docker Compose
docker-compose up -d

# 4. Access the application
# Navigate to http://localhost:8501
```

## Getting Your WASDE JWT Token

The application requires a JWT token to access USDA WASDE data:

1. Visit [Cornell USDA API Portal](https://apps.ams.usda.gov/)
2. Click "Sign Up" and create an account
3. Log in and navigate to "API Keys"
4. Click "Generate New Key"
5. Copy the token
6. Paste it into your `.env` file:
   ```
   WASDE_JWT=your_actual_token_here
   ```

## Using Demo Data (No Token Required)

If you want to try the app without setting up a WASDE token:

1. Open the app: `streamlit run app.py`
2. In the sidebar, select "Demo Data" as the data source
3. Explore all features with sample data

## First Steps in the App

Once the application is running:

1. **Select Data Source**: Choose between "Demo Data" or "Live Data" in the sidebar
2. **Pick a Commodity**: Select soybean, corn, or wheat
3. **Explore Historical Data**: Navigate to the "Historical Analysis" tab
4. **Generate Forecast**: Go to "Forecast" tab and click "Generate Forecast"
5. **View Results**: Examine forecasts with confidence intervals

## Running Jupyter Notebooks

To explore the analysis notebooks:

```bash
# Install Jupyter (if not already installed)
pip install jupyter

# Start Jupyter Notebook
jupyter notebook

# Open any notebook in the notebooks/ directory:
# - 01-wasde_exploration.ipynb: Data exploration
# - 03-eda.ipynb: Exploratory data analysis
# - 04-sarimax.ipynb: SARIMAX modeling
```

## Troubleshooting

### "ModuleNotFoundError: No module named 'src'"

**Solution**: Ensure you're in the project root directory and the virtual environment is activated.

### "EnvironmentError: Missing WASDE_JWT in your .env file"

**Solution**:
- Verify `.env` file exists in the project root
- Check that `WASDE_JWT=...` is present and not empty
- Or use "Demo Data" mode in the app

### Streamlit not opening in browser

**Solution**:
```bash
# Manually open the URL shown in the terminal
# Usually: http://localhost:8501
```

### Docker container won't start

**Solution**:
```bash
# Check logs
docker-compose logs

# Ensure .env file exists
ls -la .env

# Rebuild containers
docker-compose down
docker-compose up --build
```

## Next Steps

- 📖 Read the [full README](README.md) for detailed documentation
- 🧪 Run tests: `pytest`
- 🎨 Customize the dashboard in `app.py`
- 📊 Add new features or commodities
- 🚀 Deploy to cloud (Streamlit Cloud, Heroku, AWS)

## Support

Need help?
- Open an [Issue](https://github.com/YOUR_USERNAME/sarimax-brazilian-soybean-forecasting/issues)
- Check existing [Discussions](https://github.com/YOUR_USERNAME/sarimax-brazilian-soybean-forecasting/discussions)

---

**Happy Forecasting! 🌾**
