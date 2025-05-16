from app import app
import os

if __name__ == "__main__":
    # Run the app with development server
    app.run(host='0.0.0.0', port=5000)