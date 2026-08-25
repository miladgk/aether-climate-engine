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
   ```

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
4. Check for security vulnerabilities using the custom bandit script:
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
- Update the `README.md` and `docs/` if you are adding or changing functionality.
- Provide a clear description in your Pull Request detailing the changes made and the problem they solve.

Thanks again for your contributions!
