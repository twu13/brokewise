from app import db
from datetime import datetime

class ExpenseGroup(db.Model):
    id = db.Column(db.String(12), primary_key=True)  # Using nanoid
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_accessed = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    participants = db.Column(db.JSON)  # Store participants as JSON array
    expenses = db.relationship('Expense', backref='group', lazy=True, cascade='all, delete-orphan')

class Expense(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    group_id = db.Column(db.String(12), db.ForeignKey('expense_group.id'), nullable=False)
    description = db.Column(db.String(200), nullable=False)
    display_currency = db.Column(db.String(3), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    payers = db.relationship('ExpensePayer', backref='expense', lazy=True, cascade='all, delete-orphan')
    splits = db.relationship('ExpenseSplit', backref='expense', lazy=True, cascade='all, delete-orphan')

class ExpensePayer(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    expense_id = db.Column(db.Integer, db.ForeignKey('expense.id'), nullable=False)
    person = db.Column(db.String(100), nullable=False)
    amount = db.Column(db.Float, nullable=False)
    currency = db.Column(db.String(3), nullable=False)

class ExpenseSplit(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    expense_id = db.Column(db.Integer, db.ForeignKey('expense.id'), nullable=False)
    person = db.Column(db.String(100), nullable=False)
    amount = db.Column(db.Float, nullable=False)
    currency = db.Column(db.String(3), nullable=False)