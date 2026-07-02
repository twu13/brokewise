import os
import sys

import pytest
from sqlalchemy import event

# Add the parent directory to the path so we can import the app
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
from app import app, db  # noqa: E402


@pytest.fixture
def client():
    # Use an in-memory SQLite database for testing
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    with app.app_context():
        db.create_all()
        yield app.test_client()
        db.session.remove()
        db.drop_all()


def test_index_redirects(client):
    """Test that the index page redirects to a new group."""
    response = client.get("/")
    assert response.status_code == 302
    assert "/g/" in response.headers["Location"]


def test_health_check(client):
    """Test the health check endpoint."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.get_json()
    assert data["status"] == "healthy"
    assert data["database"] == "connected"


def test_save_expenses(client):
    """Test saving expenses to a group."""
    # Create a new group by visiting the index (redirect)
    response = client.get("/")
    group_url = response.headers["Location"]
    group_id = group_url.split("/g/")[1]

    # Save expenses to the group
    payload = {
        "participants": ["Alice", "Bob"],
        "expenses": [
            {
                "description": "Lunch",
                "displayCurrency": "USD",
                "payers": [{"person": "Alice", "amount": 20, "currency": "USD"}],
                "splits": [
                    {"person": "Alice", "amount": 10, "currency": "USD"},
                    {"person": "Bob", "amount": 10, "currency": "USD"},
                ],
            }
        ],
    }
    response = client.post(f"/api/g/{group_id}", json=payload)
    assert response.status_code == 200
    assert response.get_json()["status"] == "success"


def test_targeted_expense_endpoints(client):
    """Test creating, updating, and deleting one expense at a time."""
    group_id = client.get("/").headers["Location"].split("/g/")[1]

    participants_response = client.patch(
        f"/api/g/{group_id}/participants",
        json={"participants": ["Alice", "Bob"]},
    )
    assert participants_response.status_code == 200
    assert participants_response.get_json()["participants"] == ["Alice", "Bob"]

    payload = {
        "description": "Lunch",
        "displayCurrency": "USD",
        "payers": [{"person": "Alice", "amount": 20, "currency": "USD"}],
        "splits": [
            {"person": "Alice", "amount": 10, "currency": "USD"},
            {"person": "Bob", "amount": 10, "currency": "USD"},
        ],
    }
    create_response = client.post(f"/api/g/{group_id}/expenses", json=payload)
    assert create_response.status_code == 201
    created_expense = create_response.get_json()["expense"]
    assert created_expense["description"] == "Lunch"

    expense_id = created_expense["id"]
    payload["description"] = "Dinner"
    update_response = client.put(f"/api/g/{group_id}/expenses/{expense_id}", json=payload)
    assert update_response.status_code == 200
    assert update_response.get_json()["expense"]["description"] == "Dinner"

    group_response = client.get(f"/api/g/{group_id}")
    group_data = group_response.get_json()
    assert len(group_data["expenses"]) == 1
    assert group_data["expenses"][0]["id"] == expense_id
    assert group_data["expenses"][0]["description"] == "Dinner"

    delete_response = client.delete(f"/api/g/{group_id}/expenses/{expense_id}")
    assert delete_response.status_code == 200
    assert client.get(f"/api/g/{group_id}").get_json()["expenses"] == []


def test_expense_payload_validation_returns_400(client):
    """Malformed targeted expense payloads should be treated as client errors."""
    group_id = client.get("/").headers["Location"].split("/g/")[1]

    response = client.post(
        f"/api/g/{group_id}/expenses",
        json={
            "description": "Lunch",
            "displayCurrency": "USD",
            "payers": [{"person": "Alice", "currency": "USD"}],
            "splits": [{"person": "Bob", "amount": 10, "currency": "USD"}],
        },
    )

    assert response.status_code == 400


def test_targeted_update_does_not_rewrite_large_group(client):
    """Updating one expense should not delete/recreate the whole expense group."""
    group_id = client.get("/").headers["Location"].split("/g/")[1]
    client.patch(f"/api/g/{group_id}/participants", json={"participants": ["Alice", "Bob"]})

    payload = {
        "description": "Expense",
        "displayCurrency": "USD",
        "payers": [{"person": "Alice", "amount": 20, "currency": "USD"}],
        "splits": [
            {"person": "Alice", "amount": 10, "currency": "USD"},
            {"person": "Bob", "amount": 10, "currency": "USD"},
        ],
    }
    expense_ids = []
    for index in range(60):
        response = client.post(
            f"/api/g/{group_id}/expenses",
            json={**payload, "description": f"Expense {index}"},
        )
        assert response.status_code == 201
        expense_ids.append(response.get_json()["expense"]["id"])

    target_id = expense_ids[30]
    statements = []

    def record_statement(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    with app.app_context():
        event.listen(db.engine, "before_cursor_execute", record_statement)
        try:
            update_response = client.put(
                f"/api/g/{group_id}/expenses/{target_id}",
                json={**payload, "description": "Updated target"},
            )
        finally:
            event.remove(db.engine, "before_cursor_execute", record_statement)

    assert update_response.status_code == 200

    group_data = client.get(f"/api/g/{group_id}").get_json()
    expenses = group_data["expenses"]
    expenses_by_id = {expense["id"]: expense for expense in expenses}
    assert set(expenses_by_id) == set(expense_ids)
    assert expenses_by_id[target_id]["description"] == "Updated target"
    assert expenses_by_id[expense_ids[29]]["description"] == "Expense 29"
    assert expenses_by_id[expense_ids[31]]["description"] == "Expense 31"

    normalized_statements = [" ".join(statement.lower().split()) for statement in statements]
    assert not any(
        statement.startswith("delete from expense ") for statement in normalized_statements
    )
    assert not any(
        statement.startswith("insert into expense ") for statement in normalized_statements
    )
    assert len(statements) < 25


def test_calculate_settlement(client):
    """Test the settlement calculation endpoint."""
    data = {
        "participants": ["Alice", "Bob"],
        "expenses": [
            {
                "description": "Lunch",
                "displayCurrency": "USD",
                "payers": [{"person": "Alice", "amount": 20, "currency": "USD"}],
                "splits": [
                    {"person": "Alice", "amount": 10, "currency": "USD"},
                    {"person": "Bob", "amount": 10, "currency": "USD"},
                ],
            }
        ],
        "baseCurrency": "USD",
    }
    response = client.post("/calculate", json=data)
    assert response.status_code == 200
    settlements = response.get_json()["settlements"]
    assert settlements["Alice"] == 10.0
    assert settlements["Bob"] == -10.0


def test_calculate_reuses_exchange_rate_lookups(client, monkeypatch):
    """Test that repeated conversions for one currency pair are cached per request."""
    calls = []

    def fake_get_exchange_rate(from_currency, to_currency="USD"):
        calls.append((from_currency, to_currency))
        return {"rate": 2.0, "timestamp": 0}

    monkeypatch.setattr("app.get_exchange_rate", fake_get_exchange_rate)
    monkeypatch.setattr(
        "app.get_exchange_rates",
        lambda base_currency: {"rates": {}, "timestamp": 0},
    )

    data = {
        "participants": ["Alice", "Bob"],
        "expenses": [
            {
                "description": "Lunch",
                "displayCurrency": "USD",
                "payers": [{"person": "Alice", "amount": 10, "currency": "EUR"}],
                "splits": [
                    {"person": "Alice", "amount": 5, "currency": "EUR"},
                    {"person": "Bob", "amount": 5, "currency": "EUR"},
                ],
            },
            {
                "description": "Dinner",
                "displayCurrency": "USD",
                "payers": [{"person": "Alice", "amount": 20, "currency": "EUR"}],
                "splits": [
                    {"person": "Alice", "amount": 10, "currency": "EUR"},
                    {"person": "Bob", "amount": 10, "currency": "EUR"},
                ],
            },
        ],
        "baseCurrency": "USD",
    }

    response = client.post("/calculate", json=data)
    assert response.status_code == 200
    assert calls == [("EUR", "USD")]
