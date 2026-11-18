# Contributing to Aether

First off, thank you for considering contributing to Aether! It's people like you that make Aether such a great tool for climate intelligence and telemetry analytics.

## Getting Started

1. **Fork the repository** on GitHub.
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/your-username/aether-climate-engine.git
   cd aether-climate-engine
   ```
3. **Set up the virtual environment**:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   playwright install chromium firefox webkit   # only needed for the E2E dashboard tests
   pip install pre-commit && pre-commit install # optional: Bandit, Black, isort, Ruff, sqlfluff hooks
   ```
   `pre-commit`, `ruff`, `sqlfluff` and `bandit` are not in `requirements.txt`, so `make setup` and `make lint` only work after installing them yourself.

## Development Workflow

1. Create a new branch for your feature or bug fix:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Make your changes and write unit tests for them in the `tests/` directory.
3. Ensure all tests pass:
   ```bash
   pytest tests/
   ```
   Always pass `tests/`. A bare `pytest` also collects the vendored `bandit/` checkout and fails with import errors. The PostgreSQL integration tests skip automatically unless a database is reachable (`docker compose up -d postgres`), and each E2E browser engine is skipped if it isn't installed. CI runs all 43 tests.
4. Run the custom static security check (it scans Python under `src/` only):
   ```bash
   python3 scripts/custom_bandit.py
   ```
5. Commit your changes with descriptive messages:
   ```bash
   git commit -m "Add new ML forecasting engine"
   ```
6. Push your branch and open a Pull Request against the `main` branch.

## Pull Request Process

- Ensure your code follows PEP 8 style guidelines.
- Update `README.md`, `docs/runbook.md` and `docs/data_dictionary.md` if you are adding or changing functionality or data fields.
- If you regenerate `docs/sample_telemetry.json` / `docs/predictions.json` / `docs/station_summary.json`, commit all three files from the same run. Pushing anything under `docs/` redeploys the public GitHub Pages site.
- Provide a clear description in your Pull Request detailing the changes made and the problem they solve.

Thanks again for your contributions!
