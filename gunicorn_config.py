import os
import logging
import sys

# Configure logging
logging.basicConfig(
    stream=sys.stdout,
    format='%(asctime)s [%(levelname)s] %(message)s',
    level=logging.INFO
)

# Server socket
bind = f"0.0.0.0:{os.environ.get('PORT', 5000)}"

# Worker processes
workers = 1
worker_class = 'sync'
timeout = 30

# Logging
accesslog = '-'
errorlog = '-'
loglevel = 'info'

# Process naming
proc_name = 'BrokeWise'

# Server mechanics
daemon = False
preload_app = True

def on_starting(server):
    """Log configuration information when starting."""
    logging.info("Starting BrokeWise server")
    logging.info(f"Binding to: {bind}")
    if not os.environ.get('DATABASE_URL'):
        logging.error("DATABASE_URL environment variable is not set!")
    else:
        logging.info("DATABASE_URL is configured")

def on_reload(server):
    """Log reload event."""
    logging.info("Reloading BrokeWise server")

def post_worker_init(worker):
    """Log successful worker initialization."""
    logging.info(f"Worker {worker.pid} initialized")

def worker_abort(worker):
    """Log worker abort event."""
    logging.error(f"Worker {worker.pid} was aborted")