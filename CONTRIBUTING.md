# Contributing to SARIMAX Brazilian Soybean Forecasting

Thank you for considering contributing to this project! We welcome contributions from the community.

## Code of Conduct

This project adheres to a Code of Conduct that all contributors are expected to follow. Please be respectful and professional in all interactions.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues to avoid duplicates. When creating a bug report, include:

- **Clear title and description**
- **Steps to reproduce** the issue
- **Expected behavior** vs actual behavior
- **Screenshots** if applicable
- **Environment details** (OS, Python version, etc.)

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, include:

- **Clear use case** - why is this enhancement needed?
- **Detailed description** of the proposed functionality
- **Possible implementation** approach (if you have ideas)

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Make your changes** following our coding standards
3. **Add tests** for any new functionality
4. **Ensure all tests pass**: `pytest`
5. **Update documentation** if needed
6. **Follow the style guide** (black, isort, flake8)
7. **Write a clear commit message**

## Development Setup

```bash
# Clone your fork
git clone https://github.com/rossi-diego/sarimax-brazilian-soybean-forecasting.git
cd sarimax-brazilian-soybean-forecasting

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
pip install -r requirements-dev.txt

# Install pre-commit hooks
pre-commit install
```

## Coding Standards

### Python Style Guide

We follow PEP 8 with some modifications:

- **Line length**: 120 characters max
- **Formatter**: Black (automatic formatting)
- **Import sorting**: isort
- **Linter**: flake8
- **Type hints**: Required for all functions

### Code Formatting

Before committing, run:

```bash
# Format code
black src/ tests/ app.py

# Sort imports
isort src/ tests/ app.py

# Check linting
flake8 src/ tests/ app.py --max-line-length=120
```

Or use pre-commit hooks (automatically runs on commit):

```bash
pre-commit run --all-files
```

### Type Hints

All functions must have type hints:

```python
def process_data(df: pd.DataFrame, column: str) -> pd.Series:
    """Process data and return series."""
    return df[column]
```

### Docstrings

Use NumPy-style docstrings:

```python
def calculate_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    """
    Calculate forecast evaluation metrics.

    Parameters
    ----------
    y_true : np.ndarray
        True values
    y_pred : np.ndarray
        Predicted values

    Returns
    -------
    dict
        Dictionary with MAE, RMSE, etc.

    Examples
    --------
    >>> metrics = calculate_metrics(y_true, y_pred)
    >>> print(metrics['mae'])
    """
    pass
```

## Testing

### Writing Tests

- Place tests in `tests/` directory
- Name test files `test_*.py`
- Use descriptive test names: `test_function_name_expected_behavior`
- Aim for 70%+ code coverage

Example:

```python
import pytest
from src.yfinance_utils import yahoo_quotes

def test_yahoo_quotes_with_valid_dates():
    """Test that yahoo_quotes returns data with valid dates."""
    df, first_date = yahoo_quotes(
        start_date='2023-01-01',
        end_date='2023-01-31'
    )
    assert not df.empty
    assert first_date is not None
```

### Running Tests

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=src --cov-report=html

# Run specific test file
pytest tests/test_yfinance_utils.py -v

# Run specific test
pytest tests/test_yfinance_utils.py::test_yahoo_quotes_with_valid_dates
```

## Git Workflow

### Branch Naming

- **Feature**: `feature/description-of-feature`
- **Bug fix**: `fix/description-of-bug`
- **Documentation**: `docs/description-of-docs`
- **Refactor**: `refactor/description`

### Commit Messages

Follow conventional commits format:

```
<type>(<scope>): <subject>

<body>

<footer>
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

Example:

```
feat(forecasting): add confidence intervals to forecasts

- Implement bootstrap method for uncertainty quantification
- Add visualization of prediction intervals
- Update tests for new functionality

Closes #123
```

## Pull Request Process

1. **Update documentation** for any new features
2. **Add tests** to maintain or improve coverage
3. **Update CHANGELOG** (if applicable)
4. **Ensure CI passes** - all tests and linting must pass
5. **Request review** from maintainers
6. **Address feedback** promptly and professionally

### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix (non-breaking change fixing an issue)
- [ ] New feature (non-breaking change adding functionality)
- [ ] Breaking change (fix or feature causing existing functionality to break)
- [ ] Documentation update

## Testing
- [ ] Tests added/updated
- [ ] All tests passing locally
- [ ] Coverage maintained/improved

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] No breaking changes (or documented)
```

## Project Structure Guidelines

### Adding New Modules

Place new modules in appropriate directories:

- **Data processing**: `src/`
- **Tests**: `tests/`
- **Notebooks**: `notebooks/`
- **Documentation**: Root or `docs/`

### Adding Dependencies

1. Add to `requirements.txt` (production) or `requirements-dev.txt` (development)
2. Include version constraints: `package>=1.0.0,<2.0.0`
3. Document why the dependency is needed

## Documentation

### Code Documentation

- All functions/classes need docstrings
- Complex logic needs inline comments
- Public APIs must be documented

### User Documentation

- Update README.md for user-facing changes
- Add examples for new features
- Keep QUICKSTART.md up to date

## Questions?

- Open a [Discussion](https://github.com/rossi-diego/sarimax-brazilian-soybean-forecasting/discussions)
- Ask in pull request comments
- Check existing documentation

## Recognition

Contributors will be:
- Listed in CONTRIBUTORS.md
- Mentioned in release notes
- Acknowledged in documentation

Thank you for contributing! 🎉
