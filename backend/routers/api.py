# backend/routers/api.py
import logging
import httpx
from fastapi import APIRouter, HTTPException, Request, UploadFile

from backend.models.schemas import GenerateRequest, ValueChainResponse, HealthResponse
from backend.services import ollama_service, file_service
from backend.config import settings
from backend.demo_data import HDFC_BANK_DEMO

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")


@router.get("/health", response_model=HealthResponse, tags=["Health"])
async def health():
    logger.info("Health check requested")
    try:
        health_data = await ollama_service.check_health()
        logger.info("Ollama connected — models: %s", health_data["available_models"])
        return HealthResponse(
            status="ok",
            ollama_connected=True,
            ollama_url=settings.ollama_base_url,
            model=settings.ollama_model,
            available_models=health_data["available_models"],
        )
    except Exception as exc:
        logger.warning("Ollama health check failed: %s", exc)
        return HealthResponse(
            status="degraded",
            ollama_connected=False,
            ollama_url=settings.ollama_base_url,
            model=settings.ollama_model,
            available_models=[],
        )


@router.post("/generate", response_model=ValueChainResponse, tags=["Generate"])
async def generate(req: GenerateRequest):
    logger.info(
        "Generate request — company=%r industry=%r has_file=%s",
        req.company_name,
        req.industry,
        bool(req.file_content),
    )
    try:
        result = await ollama_service.generate_value_chain(
            company_name=req.company_name,
            industry=req.industry,
            description=req.description,
            repo_url=req.repo_url,
            file_content=req.file_content,
        )
        logger.info("Generate succeeded for company=%r", req.company_name)
        return ValueChainResponse(**result)

    except httpx.ConnectError:
        logger.error("Cannot connect to Ollama at %s", settings.ollama_base_url)
        raise HTTPException(
            status_code=503,
            detail=(
                f"Cannot connect to Ollama at {settings.ollama_base_url}. "
                "Make sure Ollama is running: ollama serve"
            ),
        )
    except httpx.TimeoutException:
        logger.error("Ollama timed out generating response for company=%r", req.company_name)
        raise HTTPException(
            status_code=504,
            detail="Ollama took too long to respond. The model may be busy or overloaded — please try again.",
        )
    except httpx.HTTPStatusError as exc:
        logger.error("Ollama API error: %s", exc.response.text)
        raise HTTPException(status_code=502, detail=f"Ollama API error: {exc.response.text}")
    except ValueError as exc:
        logger.warning("Value chain parse/validation error: %s", exc)
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        logger.exception("Unexpected error in /generate")
        raise HTTPException(status_code=500, detail=f"Unexpected error: {exc}")


@router.post("/generate/upload", response_model=ValueChainResponse, tags=["Generate"])
async def generate_with_upload(request: Request):
    # Parse multipart form manually — bypasses Pydantic v2 form validation
    # quirks where optional fields are incorrectly treated as required.
    try:
        form = await request.form()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not parse form data: {exc}")

    company_name = (form.get("company_name") or "").strip()
    industry = (form.get("industry") or "").strip()
    description = form.get("description") or None
    repo_url = form.get("repo_url") or None

    if not company_name:
        raise HTTPException(status_code=400, detail="company_name is required")
    if not industry:
        raise HTTPException(status_code=400, detail="industry is required")

    # Accept files under either 'files' or 'file' key for broad compatibility
    raw = form.getlist("files") or form.getlist("file")
    files: list[UploadFile] = [f for f in raw if isinstance(f, UploadFile) and f.filename]

    logger.info(
        "Upload generate request — company=%r industry=%r files=%d",
        company_name,
        industry,
        len(files),
    )

    if len(files) > 3:
        raise HTTPException(status_code=400, detail="Maximum 3 files allowed.")

    max_bytes = settings.max_file_size_mb * 1024 * 1024
    extracted_parts = []

    try:
        for f in files:
            content_preview = await f.read()
            if len(content_preview) > max_bytes:
                raise HTTPException(
                    status_code=413,
                    detail=f"File '{f.filename}' exceeds {settings.max_file_size_mb} MB limit.",
                )
            await f.seek(0)

            logger.info("Extracting text from file=%r size=%d bytes", f.filename, len(content_preview))
            text = await file_service.extract_text(f)
            extracted_parts.append(text)
            logger.debug("Extracted %d chars from %r", len(text), f.filename)

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("File extraction failed")
        raise HTTPException(status_code=422, detail=f"File extraction error: {exc}")

    combined_file_content = "\n\n".join(extracted_parts) if extracted_parts else None
    logger.info(
        "All files extracted — total chars=%s",
        len(combined_file_content) if combined_file_content else 0,
    )

    try:
        result = await ollama_service.generate_value_chain(
            company_name=company_name,
            industry=industry,
            description=description,
            repo_url=repo_url,
            file_content=combined_file_content,
        )
        logger.info("Upload generate succeeded for company=%r", company_name)
        return ValueChainResponse(**result)

    except httpx.ConnectError:
        logger.error("Cannot connect to Ollama at %s", settings.ollama_base_url)
        raise HTTPException(
            status_code=503,
            detail=(
                f"Cannot connect to Ollama at {settings.ollama_base_url}. "
                "Make sure Ollama is running: ollama serve"
            ),
        )
    except httpx.TimeoutException:
        logger.error("Ollama timed out generating response for company=%r", company_name)
        raise HTTPException(
            status_code=504,
            detail="Ollama took too long to respond. The model may be busy or overloaded — please try again.",
        )
    except httpx.HTTPStatusError as exc:
        logger.error("Ollama API error: %s", exc.response.text)
        raise HTTPException(status_code=502, detail=f"Ollama API error: {exc.response.text}")
    except ValueError as exc:
        logger.warning("Value chain parse/validation error: %s", exc)
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        logger.exception("Unexpected error in /generate/upload")
        raise HTTPException(status_code=500, detail=f"Unexpected error: {exc}")


@router.get("/demo", response_model=ValueChainResponse, tags=["Demo"])
async def demo():
    """Returns a pre-built HDFC Bank value chain instantly — no Ollama required."""
    logger.info("Demo endpoint called — returning pre-built HDFC Bank data")
    return ValueChainResponse(**HDFC_BANK_DEMO)


@router.get("/models", tags=["Health"])
async def list_models():
    logger.info("Models list requested")
    models = await ollama_service.get_available_models()
    logger.info("Available models: %s", models)
    return {"models": models, "current": settings.ollama_model}
