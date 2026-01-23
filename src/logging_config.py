"""
Logging configuration for the SARIMAX Brazilian Soybean Forecasting project.
"""
import sys
from pathlib import Path
from loguru import logger

# Remove default handler
logger.remove()

# Get project root
PROJECT_ROOT = Path(__file__).resolve().parents[1]
LOG_FOLDER = PROJECT_ROOT / "logs"
LOG_FOLDER.mkdir(exist_ok=True)

# Add console handler with custom format
logger.add(
    sys.stderr,
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
    level="INFO",
    colorize=True,
)

# Add file handler for all logs
logger.add(
    LOG_FOLDER / "app.log",
    format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function}:{line} - {message}",
    level="DEBUG",
    rotation="10 MB",
    retention="30 days",
    compression="zip",
)

# Add file handler for errors only
logger.add(
    LOG_FOLDER / "errors.log",
    format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function}:{line} - {message}",
    level="ERROR",
    rotation="10 MB",
    retention="90 days",
    compression="zip",
)


def get_logger(name: str):
    """
    Get a logger instance with the specified name.

    Parameters
    ----------
    name : str
        Name for the logger (typically __name__)

    Returns
    -------
    logger
        Configured logger instance
    """
    return logger.bind(name=name)
