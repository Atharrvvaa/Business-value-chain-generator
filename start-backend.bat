@echo off
echo Starting Business Architect AI backend...
call venv\Scripts\activate
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
