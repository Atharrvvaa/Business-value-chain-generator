# backend/main.py
"""
Business Architect AI — FastAPI Backend
Serves the value chain generation API backed by Ollama (llama3.2).

Run:
    uvicorn backend.main:app --reload --port 8000
"""
import logging
import logging.config
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.config import settings
from backend.routers.api import router

logging.config.dictConfig({
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "default": {
            "format": "%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
            "datefmt": "%Y-%m-%d %H:%M:%S",
        }
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "default",
        }
    },
    "root": {"level": "INFO", "handlers": ["console"]},
    "loggers": {
        "backend": {"level": "DEBUG", "propagate": True},
        "uvicorn.access": {"level": "INFO", "propagate": True},
    },
})

app = FastAPI(
    title="Business Architect AI",
    description="Value Chain & Capability Mapping API powered by Ollama (llama3.2)",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS — allow the React dev server ─────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routes ────────────────────────────────────────────────────────────────────
app.include_router(router)


@app.get("/", tags=["Root"])
async def root():
    return {
        "service": "Business Architect AI",
        "version": "2.0.0",
        "docs": "/docs",
        "health": "/api/health",
        "model": settings.ollama_model,
        "ollama": settings.ollama_base_url,
    }
