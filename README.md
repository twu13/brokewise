# BrokeWise

[![Tests CI](https://github.com/tonywu/brokewise/actions/workflows/ci.yml/badge.svg)](https://github.com/tonywu/brokewise/actions/workflows/ci.yml)
[![Ruff](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/astral-sh/ruff/main/assets/badge/v2.json)](https://github.com/astral-sh/ruff)

Share expenses, split bills, and manage group finances with ease across multiple currencies.

## Features

- Create expense groups to track shared expenses
- Add participants and record expenses with flexible payment splitting
- Support for multiple currencies with automatic exchange rate conversion
- Calculate settlement balances to easily see who owes what
- Export expense data to JSON or PDF formats
- Responsive design that works on mobile and desktop

## Development Setup

1. Make sure you have Python 3.x installed (recommended: Python 3.12.8)
2. Install required packages using [uv](https://github.com/astral-sh/uv):
   ```bash
   uv sync
   ```
   This will install all dependencies specified in `pyproject.toml` and lock them via `uv.lock`.

3. Set up environment variables (you can use a `.env` file in the project root):
   - `DATABASE_URL`: PostgreSQL database connection URL
   - `FLASK_SECRET_KEY`: Secret key for Flask session management (optional, defaults to a development key)

4. Run the development server:
   ```bash
   python run.py
   ```
   The application will be available at `http://localhost:5001`

### Using the Makefile (Recommended)

Common development tasks are available via the Makefile:

- Install dependencies:
  ```bash
  make install
  ```
- Start the PostgreSQL database (via Docker Compose):
  ```bash
  make up
  ```
- Run the development server (and start the database if needed):
  ```bash
  make dev
  ```
- Stop the database:
  ```bash
  make down
  ```

## Production Deployment

The application is configured to run with Gunicorn in production:

```bash
gunicorn -c gunicorn_config.py 'app:app'
```

By default, Gunicorn will bind to port 5000 unless overridden by the `PORT` environment variable.
