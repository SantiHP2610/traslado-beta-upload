# Activate the virtual environment and start the FastAPI server.
# Run this script instead of manually activating venv each time:
#   .\run.ps1

venv\Scripts\activate
uvicorn main:app --reload
