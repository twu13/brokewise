import os
import sys

import pytest

# Add the parent directory to the path so we can import the app
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import app, db


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
