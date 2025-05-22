.PHONY: up down install dev help

# Default target
.DEFAULT_GOAL := help

# Variables
PYTHON := python
UV := uv
PORT := 5001

help: ## Display this help message
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@awk -F ':|##' '/^[^\t].+?:.*?##/ { printf "  %-20s %s\n", $$1, $$NF }' $(MAKEFILE_LIST)

up: ## Start the PostgreSQL database
	docker compose up -d

down: ## Stop the PostgreSQL database
	docker compose down

down-v: ## Stop the PostgreSQL database and remove volumes
	docker compose down -v

install: ## Install project dependencies
	$(UV) sync

dev: up ## Run the development server (starts database if needed)
	$(PYTHON) run.py
	