# BrokeWise

Share expenses, split bills, and manage group finances with ease across multiple currencies.

## Features

- Create expense groups to track shared expenses
- Add participants and record expenses with flexible payment splitting
- Support for multiple currencies with automatic exchange rate conversion
- Calculate settlement balances to easily see who owes what
- Export expense data to JSON or PDF formats
- Responsive design that works on mobile and desktop

## Development Setup

1. Make sure you have Python 3.x installed
2. Install required packages:
   ```bash
   pip install flask flask-sqlalchemy psycopg2-binary requests nanoid email-validator gunicorn
   ```

3. Set up environment variables:
   - `DATABASE_URL`: PostgreSQL database connection URL
   - `FLASK_SECRET_KEY`: Secret key for Flask session management (optional, defaults to a development key)

4. Run the development server:
   ```bash
   python run.py
   ```
   or
   ```bash
   python main.py
   ```

The application will be available at `http://localhost:5000`

## Production Deployment

The application is configured to run with Gunicorn in production:

```bash
gunicorn -c gunicorn_config.py 'app:app'
```
