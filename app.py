import os
import random
import logging
from flask import Flask, render_template, request, jsonify, redirect, url_for
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.orm import DeclarativeBase
import requests
from nanoid import generate
from datetime import datetime, timedelta
from sqlalchemy import text

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s'
)
logger = logging.getLogger(__name__)

class Base(DeclarativeBase):
    pass

db = SQLAlchemy(model_class=Base)
app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY") or "expense_tracker_secret"

# Configure database
database_url = os.environ.get("DATABASE_URL")
if not database_url:
    error_msg = "DATABASE_URL environment variable is not set!"
    logger.critical(error_msg)
    raise RuntimeError(error_msg)

app.config["SQLALCHEMY_DATABASE_URI"] = database_url
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
    "pool_recycle": 300,
    "pool_pre_ping": True,
}

db.init_app(app)

with app.app_context():
    import models  # noqa: F401
    db.create_all()

# Cache for exchange rates
exchange_rates_cache = {
    'rates': None,
    'timestamp': None,
    'last_updated': None
}

def get_exchange_rates(base_currency="USD"):
    global exchange_rates_cache

    now = datetime.utcnow()
    if (exchange_rates_cache['last_updated'] is None or 
        now - exchange_rates_cache['last_updated'] > timedelta(hours=1) or
        exchange_rates_cache['rates'] is None or
        base_currency != exchange_rates_cache.get('base_currency')):
        try:
            response = requests.get(f"https://api.exchangerate-api.com/v4/latest/{base_currency}")
            data = response.json()
            exchange_rates_cache = {
                'rates': data['rates'],
                'timestamp': data['time_last_updated'],
                'last_updated': now,
                'base_currency': base_currency
            }
        except Exception as e:
            logger.error(f"Error fetching exchange rates: {e}")
            if exchange_rates_cache['rates'] is None:
                return {
                    'rates': {curr: 1.0 for curr in ['USD', 'EUR', 'JPY', 'GBP']},
                    'timestamp': now.timestamp(),
                    'error': str(e)
                }
            logger.warning("Using cached exchange rates due to API error")

    return exchange_rates_cache

def cleanup_old_groups():
    """Remove expense groups that haven't been accessed in 90 days"""
    try:
        from models import ExpenseGroup
        cutoff_date = datetime.utcnow() - timedelta(days=90)
        old_groups = ExpenseGroup.query.filter(ExpenseGroup.last_accessed < cutoff_date).all()
        for group in old_groups:
            db.session.delete(group)
        db.session.commit()
    except Exception as e:
        logger.error(f"Error during cleanup: {e}")
        db.session.rollback()

@app.route("/")
def index():
    group_id = generate(size=12)
    return redirect(url_for('expense_group', group_id=group_id))

@app.route("/g/<group_id>")
def expense_group(group_id):
    from models import ExpenseGroup
    # Run cleanup occasionally (1% chance per request)
    if random.random() < 0.01:
        cleanup_old_groups()

    group = ExpenseGroup.query.get(group_id)
    if not group:
        group = ExpenseGroup(id=group_id, participants=[])
        db.session.add(group)
        db.session.commit()
    else:
        group.last_accessed = datetime.utcnow()
        db.session.commit()
    return render_template("index.html", group_id=group_id)

@app.route("/api/g/<group_id>", methods=["GET"])
def get_expenses(group_id):
    from models import ExpenseGroup, Expense
    group = ExpenseGroup.query.get_or_404(group_id)

    expenses_data = []
    for expense in group.expenses:
        expense_dict = {
            'id': expense.id,
            'description': expense.description,
            'displayCurrency': expense.display_currency,
            'date': expense.created_at.isoformat(),
            'payers': [{'person': p.person, 'amount': p.amount, 'currency': p.currency} 
                      for p in expense.payers],
            'splits': [{'person': s.person, 'amount': s.amount, 'currency': s.currency} 
                      for s in expense.splits]
        }
        expenses_data.append(expense_dict)

    return jsonify({
        'participants': group.participants,
        'expenses': expenses_data
    })

@app.route("/api/g/<group_id>", methods=["POST"])
def save_expenses(group_id):
    try:
        from models import ExpenseGroup, Expense, ExpensePayer, ExpenseSplit

        data = request.json
        group = ExpenseGroup.query.get(group_id)
        if not group:
            group = ExpenseGroup(id=group_id)
            db.session.add(group)

        group.participants = data.get('participants', [])

        # Clear existing expenses
        for expense in group.expenses:
            db.session.delete(expense)

        # Add new expenses
        for exp_data in data.get('expenses', []):
            expense = Expense(
                group=group,
                description=exp_data['description'],
                display_currency=exp_data['displayCurrency']
            )
            db.session.add(expense)

            # Add payers
            for payer in exp_data['payers']:
                db.session.add(ExpensePayer(
                    expense=expense,
                    person=payer['person'],
                    amount=payer['amount'],
                    currency=payer['currency']
                ))

            # Add splits
            for split in exp_data['splits']:
                db.session.add(ExpenseSplit(
                    expense=expense,
                    person=split['person'],
                    amount=split['amount'],
                    currency=split['currency']
                ))

        db.session.commit()
        return jsonify({"status": "success"})
    except Exception as e:
        logger.error(f"Error saving expenses: {e}")
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/api/exchange-rate", methods=["GET"])
def exchange_rate():
    from_currency = request.args.get('from', 'USD')
    to_currency = request.args.get('to', 'USD')
    rate_data = get_exchange_rate(from_currency, to_currency)
    return jsonify(rate_data)

def get_exchange_rate(from_currency, to_currency="USD"):
    rates_data = get_exchange_rates(from_currency)
    try:
        return {
            'rate': rates_data['rates'][to_currency],
            'timestamp': rates_data['timestamp'],
            'source': 'exchangerate-api.com'
        }
    except Exception as e:
        logger.error(f"Error getting exchange rate: {e}")
        return {
            'rate': 1.0,
            'timestamp': datetime.utcnow().timestamp(),
            'error': str(e)
        }

@app.route("/calculate", methods=["POST"])
def calculate():
    data = request.json
    participants = data["participants"]
    expenses = data["expenses"]
    base_currency = data["baseCurrency"]

    # Initialize total amounts for each participant
    total_paid = {p: 0 for p in participants}
    total_should_pay = {p: 0 for p in participants}

    # Process each expense
    for expense in expenses:
        # Calculate payments
        for payer in expense["payers"]:
            amount = float(payer["amount"])
            if payer["currency"] != base_currency:
                rate_data = get_exchange_rate(payer["currency"], base_currency)
                amount *= rate_data['rate']
            total_paid[payer["person"]] += amount

        # Calculate splits
        for split in expense["splits"]:
            amount = float(split["amount"])
            if split["currency"] != base_currency:
                rate_data = get_exchange_rate(split["currency"], base_currency)
                amount *= rate_data['rate']
            total_should_pay[split["person"]] += amount

    # Calculate net amounts
    settlements = {}
    for person in participants:
        net = total_paid[person] - total_should_pay[person]
        settlements[person] = round(net, 2)

    # Get current exchange rate info
    rate_info = get_exchange_rates(base_currency)

    return jsonify({
        "settlements": settlements,
        "exchangeRateInfo": {
            "timestamp": rate_info['timestamp'],
            "source": "exchangerate-api.com",
            "baseCurrency": base_currency
        }
    })

@app.route("/api/g/<group_id>/export", methods=["GET"])
def export_group_data(group_id):
    """Export expense group data as downloadable JSON"""
    from models import ExpenseGroup, Expense
    try:
        group = ExpenseGroup.query.get_or_404(group_id)

        expenses_data = []
        for expense in group.expenses:
            expense_dict = {
                'id': expense.id,
                'description': expense.description,
                'displayCurrency': expense.display_currency,
                'date': expense.created_at.isoformat(),
                'payers': [{'person': p.person, 'amount': p.amount, 'currency': p.currency} 
                          for p in expense.payers],
                'splits': [{'person': s.person, 'amount': s.amount, 'currency': s.currency} 
                          for s in expense.splits]
            }
            expenses_data.append(expense_dict)

        export_data = {
            'participants': group.participants,
            'expenses': expenses_data,
            'exported_at': datetime.utcnow().isoformat(),
            'group_id': group_id
        }

        response = jsonify(export_data)
        response.headers['Content-Disposition'] = f'attachment; filename=expense_group_{group_id}.json'
        return response

    except Exception as e:
        logger.error(f"Error exporting group data: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

# Add health check endpoint
@app.route("/health")
def health_check():
    try:
        # Test database connection using properly formatted SQL
        from sqlalchemy import text
        db.session.execute(text("SELECT 1"))
        return jsonify({"status": "healthy", "database": "connected"})
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return jsonify({"status": "unhealthy", "error": str(e)}), 500