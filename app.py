import logging
import os
import random
from datetime import UTC, datetime, timedelta

import requests
from dotenv import load_dotenv
from flask import Flask, abort, jsonify, redirect, render_template, request, url_for
from flask_sqlalchemy import SQLAlchemy
from nanoid import generate
from sqlalchemy import select
from sqlalchemy.orm import DeclarativeBase, selectinload
from werkzeug.exceptions import BadRequest, HTTPException

load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
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
exchange_rates_cache = {"rates": None, "timestamp": None, "last_updated": None}


def get_exchange_rates(base_currency="USD"):
    global exchange_rates_cache

    now = datetime.now(UTC)
    if (
        exchange_rates_cache["last_updated"] is None
        or now - exchange_rates_cache["last_updated"] > timedelta(hours=1)
        or exchange_rates_cache["rates"] is None
        or base_currency != exchange_rates_cache.get("base_currency")
    ):
        try:
            response = requests.get(
                f"https://api.exchangerate-api.com/v4/latest/{base_currency}", timeout=5
            )
            response.raise_for_status()
            data = response.json()
            exchange_rates_cache = {
                "rates": data["rates"],
                "timestamp": data["time_last_updated"],
                "last_updated": now,
                "base_currency": base_currency,
            }
        except Exception as e:
            logger.error(f"Error fetching exchange rates: {e}")
            if exchange_rates_cache["rates"] is None:
                return {
                    "rates": {curr: 1.0 for curr in ["USD", "EUR", "JPY", "GBP"]},
                    "timestamp": now.timestamp(),
                    "error": str(e),
                }
            logger.warning("Using cached exchange rates due to API error")

    return exchange_rates_cache


def get_group_with_expenses(group_id):
    from models import Expense, ExpenseGroup

    return db.session.execute(
        select(ExpenseGroup)
        .where(ExpenseGroup.id == group_id)
        .options(
            selectinload(ExpenseGroup.expenses).selectinload(Expense.payers),
            selectinload(ExpenseGroup.expenses).selectinload(Expense.splits),
        )
    ).scalar_one_or_none()


def serialize_expense(expense):
    return {
        "id": expense.id,
        "description": expense.description,
        "displayCurrency": expense.display_currency,
        "date": expense.created_at.isoformat(),
        "payers": [
            {"person": p.person, "amount": p.amount, "currency": p.currency} for p in expense.payers
        ],
        "splits": [
            {"person": s.person, "amount": s.amount, "currency": s.currency} for s in expense.splits
        ],
    }


def validate_expense_payload(exp_data):
    if not isinstance(exp_data, dict):
        raise BadRequest("Expense payload must be a JSON object.")

    description = exp_data.get("description")
    if not isinstance(description, str) or not description.strip():
        raise BadRequest("Expense description is required.")

    display_currency = exp_data.get("displayCurrency")
    if not isinstance(display_currency, str) or not display_currency.strip():
        raise BadRequest("Expense displayCurrency is required.")

    return {
        "description": description.strip(),
        "displayCurrency": display_currency.strip().upper(),
        "payers": validate_expense_entries(exp_data.get("payers"), "payers"),
        "splits": validate_expense_entries(exp_data.get("splits"), "splits"),
    }


def validate_expense_entries(entries, field_name):
    if not isinstance(entries, list) or not entries:
        raise BadRequest(f"Expense {field_name} must be a non-empty list.")

    validated_entries = []
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise BadRequest(f"Expense {field_name}[{index}] must be a JSON object.")

        person = entry.get("person")
        if not isinstance(person, str) or not person.strip():
            raise BadRequest(f"Expense {field_name}[{index}].person is required.")

        try:
            amount = float(entry["amount"])
        except (KeyError, TypeError, ValueError) as exc:
            raise BadRequest(f"Expense {field_name}[{index}].amount must be numeric.") from exc

        currency = entry.get("currency")
        if not isinstance(currency, str) or not currency.strip():
            raise BadRequest(f"Expense {field_name}[{index}].currency is required.")

        validated_entries.append(
            {
                "person": person.strip(),
                "amount": amount,
                "currency": currency.strip().upper(),
            }
        )

    return validated_entries


def update_expense_from_payload(expense, exp_data):
    from models import ExpensePayer, ExpenseSplit

    validated_expense = validate_expense_payload(exp_data)
    expense.description = validated_expense["description"]
    expense.display_currency = validated_expense["displayCurrency"]

    expense.payers.clear()
    for payer in validated_expense["payers"]:
        expense.payers.append(
            ExpensePayer(
                person=payer["person"],
                amount=payer["amount"],
                currency=payer["currency"],
            )
        )

    expense.splits.clear()
    for split in validated_expense["splits"]:
        expense.splits.append(
            ExpenseSplit(
                person=split["person"],
                amount=split["amount"],
                currency=split["currency"],
            )
        )


def cleanup_old_groups():
    """Remove expense groups that haven't been accessed in 90 days"""
    try:
        from models import ExpenseGroup

        cutoff_date = datetime.now(UTC) - timedelta(days=90)
        old_groups = (
            db.session.query(ExpenseGroup).filter(ExpenseGroup.last_accessed < cutoff_date).all()
        )
        for group in old_groups:
            db.session.delete(group)
        db.session.commit()
    except Exception as e:
        logger.error(f"Error during cleanup: {e}")
        db.session.rollback()


@app.route("/")
def index():
    group_id = generate(size=12)
    return redirect(url_for("expense_group", group_id=group_id))


@app.route("/g/<group_id>")
def expense_group(group_id):
    from models import ExpenseGroup

    # Run cleanup occasionally (1% chance per request)
    if random.random() < 0.01:
        cleanup_old_groups()

    group = db.session.get(ExpenseGroup, group_id)
    if not group:
        group = ExpenseGroup(id=group_id, participants=[])
        db.session.add(group)
        db.session.commit()
    else:
        group.last_accessed = datetime.now(UTC)
        db.session.commit()
    return render_template("index.html", group_id=group_id, has_people=bool(group.participants))


@app.route("/api/g/<group_id>", methods=["GET"])
def get_expenses(group_id):
    group = get_group_with_expenses(group_id)
    if group is None:
        abort(404)

    expenses_data = [serialize_expense(expense) for expense in group.expenses]

    return jsonify({"participants": group.participants, "expenses": expenses_data})


@app.route("/api/g/<group_id>/participants", methods=["PATCH"])
def update_participants(group_id):
    try:
        from models import ExpenseGroup

        data = request.json or {}
        group = db.session.get(ExpenseGroup, group_id)
        if not group:
            group = ExpenseGroup(id=group_id)
            db.session.add(group)

        group.participants = data.get("participants", [])
        db.session.commit()
        return jsonify({"participants": group.participants})
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        logger.error(f"Error updating participants: {e}")
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/g/<group_id>/expenses", methods=["POST"])
def create_expense(group_id):
    try:
        from models import Expense, ExpenseGroup

        data = request.json or {}
        group = db.session.get(ExpenseGroup, group_id)
        if not group:
            group = ExpenseGroup(id=group_id, participants=[])
            db.session.add(group)

        expense = Expense(group=group)
        update_expense_from_payload(expense, data)
        db.session.add(expense)
        db.session.commit()
        return jsonify({"expense": serialize_expense(expense)}), 201
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        logger.error(f"Error creating expense: {e}")
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/g/<group_id>/expenses/<int:expense_id>", methods=["PUT"])
def update_expense(group_id, expense_id):
    try:
        from models import Expense

        expense = db.session.get(Expense, expense_id)
        if expense is None or expense.group_id != group_id:
            abort(404)

        update_expense_from_payload(expense, request.json or {})
        db.session.commit()
        return jsonify({"expense": serialize_expense(expense)})
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        logger.error(f"Error updating expense: {e}")
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/g/<group_id>/expenses/<int:expense_id>", methods=["DELETE"])
def delete_expense(group_id, expense_id):
    try:
        from models import Expense

        expense = db.session.get(Expense, expense_id)
        if expense is None or expense.group_id != group_id:
            abort(404)

        db.session.delete(expense)
        db.session.commit()
        return jsonify({"status": "success"})
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        logger.error(f"Error deleting expense: {e}")
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/g/<group_id>", methods=["POST"])
def save_expenses(group_id):
    try:
        from models import Expense, ExpenseGroup, ExpensePayer, ExpenseSplit

        data = request.json
        group = db.session.get(ExpenseGroup, group_id)
        if not group:
            group = ExpenseGroup(id=group_id)
            db.session.add(group)

        group.participants = data.get("participants", [])

        # Clear existing expenses
        for expense in group.expenses:
            db.session.delete(expense)

        # Add new expenses
        for exp_data in data.get("expenses", []):
            expense = Expense(
                group=group,
                description=exp_data["description"],
                display_currency=exp_data["displayCurrency"],
            )
            db.session.add(expense)

            # Add payers
            for payer in exp_data["payers"]:
                db.session.add(
                    ExpensePayer(
                        expense=expense,
                        person=payer["person"],
                        amount=payer["amount"],
                        currency=payer["currency"],
                    )
                )

            # Add splits
            for split in exp_data["splits"]:
                db.session.add(
                    ExpenseSplit(
                        expense=expense,
                        person=split["person"],
                        amount=split["amount"],
                        currency=split["currency"],
                    )
                )

        db.session.commit()
        return jsonify({"status": "success"})
    except Exception as e:
        logger.error(f"Error saving expenses: {e}")
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/exchange-rate", methods=["GET"])
def exchange_rate():
    from_currency = request.args.get("from", "USD")
    to_currency = request.args.get("to", "USD")
    rate_data = get_exchange_rate(from_currency, to_currency)
    return jsonify(rate_data)


def get_exchange_rate(from_currency, to_currency="USD"):
    rates_data = get_exchange_rates(from_currency)
    try:
        return {
            "rate": rates_data["rates"][to_currency],
            "timestamp": rates_data["timestamp"],
            "source": "exchangerate-api.com",
        }
    except Exception as e:
        logger.error(f"Error getting exchange rate: {e}")
        return {"rate": 1.0, "timestamp": datetime.now(UTC).timestamp(), "error": str(e)}


@app.route("/calculate", methods=["POST"])
def calculate():
    data = request.json
    participants = data["participants"]
    expenses = data["expenses"]
    base_currency = data["baseCurrency"]

    # Initialize total amounts for each participant
    total_paid = {p: 0 for p in participants}
    total_should_pay = {p: 0 for p in participants}
    conversion_rates = {}

    def convert_amount(amount, from_currency):
        if from_currency == base_currency:
            return amount

        cache_key = (from_currency, base_currency)
        if cache_key not in conversion_rates:
            conversion_rates[cache_key] = get_exchange_rate(from_currency, base_currency)["rate"]
        return amount * conversion_rates[cache_key]

    # Process each expense
    for expense in expenses:
        # Calculate payments
        for payer in expense["payers"]:
            amount = float(payer["amount"])
            amount = convert_amount(amount, payer["currency"])
            total_paid[payer["person"]] += amount

        # Calculate splits
        for split in expense["splits"]:
            amount = float(split["amount"])
            amount = convert_amount(amount, split["currency"])
            total_should_pay[split["person"]] += amount

    # Calculate net amounts
    settlements = {}
    for person in participants:
        net = total_paid[person] - total_should_pay[person]
        settlements[person] = round(net, 2)

    # Get current exchange rate info
    rate_info = get_exchange_rates(base_currency)

    return jsonify(
        {
            "settlements": settlements,
            "exchangeRateInfo": {
                "timestamp": rate_info["timestamp"],
                "source": "exchangerate-api.com",
                "baseCurrency": base_currency,
            },
        }
    )


@app.route("/api/g/<group_id>/export", methods=["GET"])
def export_group_data(group_id):
    """Export expense group data as downloadable JSON"""
    try:
        group = get_group_with_expenses(group_id)
        if group is None:
            abort(404)

        expenses_data = [serialize_expense(expense) for expense in group.expenses]

        export_data = {
            "participants": group.participants,
            "expenses": expenses_data,
            "exported_at": datetime.now(UTC).isoformat(),
            "group_id": group_id,
        }

        response = jsonify(export_data)
        response.headers["Content-Disposition"] = (
            f"attachment; filename=expense_group_{group_id}.json"
        )
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
