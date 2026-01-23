"""
Model management utilities for saving, loading, and versioning SARIMAX models.
"""
import joblib
import json
from pathlib import Path
from datetime import datetime
from typing import Any, Dict, Optional
import pandas as pd
from src.logging_config import get_logger

logger = get_logger(__name__)


class ModelManager:
    """
    Manager for SARIMAX model persistence and versioning.

    Examples
    --------
    >>> manager = ModelManager()
    >>> manager.save_model(model_results, 'soybean', metadata={'rmse': 12.5})
    >>> loaded_model = manager.load_model('soybean', version='latest')
    """

    def __init__(self, models_dir: Optional[Path] = None):
        """
        Initialize ModelManager.

        Parameters
        ----------
        models_dir : Path, optional
            Directory to store models. Defaults to PROJECT_ROOT/models
        """
        if models_dir is None:
            project_root = Path(__file__).resolve().parents[1]
            models_dir = project_root / "models"

        self.models_dir = Path(models_dir)
        self.models_dir.mkdir(exist_ok=True, parents=True)

        # Create subdirectories
        (self.models_dir / "artifacts").mkdir(exist_ok=True)
        (self.models_dir / "metadata").mkdir(exist_ok=True)

        logger.info(f"ModelManager initialized with directory: {self.models_dir}")

    def save_model(
        self,
        model: Any,
        commodity: str,
        metadata: Optional[Dict[str, Any]] = None,
        version: Optional[str] = None
    ) -> str:
        """
        Save a trained SARIMAX model with metadata.

        Parameters
        ----------
        model : Any
            Trained SARIMAX model results object
        commodity : str
            Commodity name (e.g., 'soybean', 'corn')
        metadata : Dict[str, Any], optional
            Model metadata (metrics, parameters, etc.)
        version : str, optional
            Model version string. If None, uses timestamp.

        Returns
        -------
        str
            Model version identifier

        Raises
        ------
        ValueError
            If commodity name is invalid
        IOError
            If saving fails
        """
        if not commodity or not isinstance(commodity, str):
            raise ValueError("Commodity name must be a non-empty string")

        # Generate version if not provided
        if version is None:
            version = datetime.now().strftime("%Y%m%d_%H%M%S")

        # Create filenames
        model_filename = f"{commodity}_{version}.joblib"
        metadata_filename = f"{commodity}_{version}.json"

        model_path = self.models_dir / "artifacts" / model_filename
        metadata_path = self.models_dir / "metadata" / metadata_filename

        try:
            # Save model
            joblib.dump(model, model_path)
            logger.info(f"Model saved to {model_path}")

            # Prepare metadata
            if metadata is None:
                metadata = {}

            metadata.update({
                "commodity": commodity,
                "version": version,
                "saved_at": datetime.now().isoformat(),
                "model_path": str(model_path),
            })

            # Save metadata
            with open(metadata_path, 'w') as f:
                json.dump(metadata, f, indent=2)
            logger.info(f"Metadata saved to {metadata_path}")

            # Create/update latest symlink
            latest_model_path = self.models_dir / "artifacts" / f"{commodity}_latest.joblib"
            latest_metadata_path = self.models_dir / "metadata" / f"{commodity}_latest.json"

            # For Windows compatibility, copy instead of symlink
            joblib.dump(model, latest_model_path)
            with open(latest_metadata_path, 'w') as f:
                json.dump(metadata, f, indent=2)

            logger.info(f"Updated latest model for {commodity}")

            return version

        except Exception as e:
            logger.error(f"Failed to save model: {e}")
            raise IOError(f"Model save failed: {e}")

    def load_model(
        self,
        commodity: str,
        version: str = "latest"
    ) -> tuple[Any, Dict[str, Any]]:
        """
        Load a saved SARIMAX model with metadata.

        Parameters
        ----------
        commodity : str
            Commodity name
        version : str, default='latest'
            Model version to load. Use 'latest' for most recent.

        Returns
        -------
        Tuple[Any, Dict[str, Any]]
            - Loaded model
            - Model metadata

        Raises
        ------
        FileNotFoundError
            If model file doesn't exist
        """
        model_filename = f"{commodity}_{version}.joblib"
        metadata_filename = f"{commodity}_{version}.json"

        model_path = self.models_dir / "artifacts" / model_filename
        metadata_path = self.models_dir / "metadata" / metadata_filename

        if not model_path.exists():
            raise FileNotFoundError(f"Model not found: {model_path}")

        try:
            # Load model
            model = joblib.load(model_path)
            logger.info(f"Model loaded from {model_path}")

            # Load metadata
            metadata = {}
            if metadata_path.exists():
                with open(metadata_path, 'r') as f:
                    metadata = json.load(f)
                logger.info(f"Metadata loaded from {metadata_path}")

            return model, metadata

        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            raise

    def list_models(self, commodity: Optional[str] = None) -> pd.DataFrame:
        """
        List all saved models.

        Parameters
        ----------
        commodity : str, optional
            Filter by commodity name

        Returns
        -------
        pd.DataFrame
            DataFrame with model information
        """
        metadata_dir = self.models_dir / "metadata"
        metadata_files = list(metadata_dir.glob("*.json"))

        models_info = []
        for meta_file in metadata_files:
            if meta_file.stem.endswith("_latest"):
                continue  # Skip latest symlinks

            try:
                with open(meta_file, 'r') as f:
                    metadata = json.load(f)

                if commodity is None or metadata.get("commodity") == commodity:
                    models_info.append({
                        "commodity": metadata.get("commodity"),
                        "version": metadata.get("version"),
                        "saved_at": metadata.get("saved_at"),
                        "rmse": metadata.get("rmse"),
                        "mae": metadata.get("mae"),
                    })
            except Exception as e:
                logger.warning(f"Failed to read metadata from {meta_file}: {e}")

        if not models_info:
            logger.info("No models found")
            return pd.DataFrame()

        df = pd.DataFrame(models_info)
        df['saved_at'] = pd.to_datetime(df['saved_at'])
        df = df.sort_values('saved_at', ascending=False)

        return df

    def delete_model(self, commodity: str, version: str) -> bool:
        """
        Delete a saved model and its metadata.

        Parameters
        ----------
        commodity : str
            Commodity name
        version : str
            Model version

        Returns
        -------
        bool
            True if deletion successful
        """
        model_filename = f"{commodity}_{version}.joblib"
        metadata_filename = f"{commodity}_{version}.json"

        model_path = self.models_dir / "artifacts" / model_filename
        metadata_path = self.models_dir / "metadata" / metadata_filename

        try:
            if model_path.exists():
                model_path.unlink()
                logger.info(f"Deleted model: {model_path}")

            if metadata_path.exists():
                metadata_path.unlink()
                logger.info(f"Deleted metadata: {metadata_path}")

            return True

        except Exception as e:
            logger.error(f"Failed to delete model: {e}")
            return False
