# backend/services/file_service.py
"""
File extraction service — powered by Docling.
Extracts rich, layout-aware text from uploaded documents:
PDF, PPTX, DOCX, TXT, MD, CSV, JSON.

Drop-in replacement for the original PyMuPDF/python-pptx/python-docx version.
The public interface is identical:  async def extract_text(file: UploadFile) -> str
"""
import json
import csv
import io
import tempfile
import os
from pathlib import Path

from fastapi import UploadFile, HTTPException


MAX_CHARS = 8000  # cap extracted text per file


# ── Public entry point ────────────────────────────────────────────────────────

async def extract_text(file: UploadFile) -> str:
    """
    Dispatch to the correct extractor based on file extension.
    Returns extracted plain text (capped at MAX_CHARS).
    """
    name = (file.filename or "").lower()
    content = await file.read()

    if name.endswith(".pdf"):
        return _extract_with_docling(content, file.filename, "pdf")
    elif name.endswith(".pptx"):
        return _extract_with_docling(content, file.filename, "pptx")
    elif name.endswith(".docx"):
        return _extract_with_docling(content, file.filename, "docx")
    elif name.endswith(".csv"):
        return _extract_csv(content, file.filename)
    elif name.endswith(".json"):
        return _extract_json(content, file.filename)
    elif name.endswith((".txt", ".md")):
        return _extract_plain_text(content, file.filename)
    else:
        raise HTTPException(
            status_code=415,
            detail=(
                f"Unsupported file type: {file.filename}. "
                "Supported: PDF, PPTX, DOCX, TXT, MD, CSV, JSON"
            ),
        )


# ── Helpers ───────────────────────────────────────────────────────────────────

def _cap(text: str, filename: str) -> str:
    """Trim to MAX_CHARS and prepend a file header."""
    text = text.strip()
    if len(text) > MAX_CHARS:
        text = text[:MAX_CHARS] + "\n... [truncated]"
    return f"=== {filename} ===\n{text}"


# ── Docling extractor (PDF, PPTX, DOCX) ──────────────────────────────────────

def _extract_with_docling(content: bytes, filename: str, fmt: str) -> str:
    """
    Use Docling's DocumentConverter to extract layout-aware Markdown from
    PDF, PPTX, or DOCX files.

    Docling uses ML models (DocLayNet for PDFs, TableFormer for tables) so it
    produces significantly better output than PyMuPDF/python-pptx for complex
    business documents like annual reports or slide decks.

    Strategy:
      1. Write bytes to a NamedTemporaryFile (Docling needs a file path).
      2. Convert with DocumentConverter.
      3. Export to Markdown (preserves headings, tables, lists).
      4. Cap and return.
    """
    try:
        from docling.document_converter import DocumentConverter
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail=(
                "Docling is not installed. "
                "Run: pip install docling"
            ),
        )

    # Write to a temp file — Docling operates on file paths, not byte streams
    suffix = f".{fmt}"
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            suffix=suffix, delete=False
        ) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        converter = DocumentConverter()
        result = converter.convert(tmp_path)
        markdown = result.document.export_to_markdown()

        return _cap(markdown, filename)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail=f"Docling failed to read '{filename}': {e}",
        )
    finally:
        # Always clean up the temp file
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


# ── Stdlib extractors (CSV, JSON, plain text) — unchanged ────────────────────

def _extract_csv(content: bytes, filename: str) -> str:
    try:
        text = content.decode("utf-8", errors="replace")
        reader = csv.reader(io.StringIO(text))
        rows = [", ".join(row) for row in reader if any(cell.strip() for cell in row)]
        return _cap("\n".join(rows), filename)
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail=f"Failed to read CSV '{filename}': {e}",
        )


def _extract_json(content: bytes, filename: str) -> str:
    try:
        text = content.decode("utf-8", errors="replace")
        parsed = json.loads(text)
        return _cap(json.dumps(parsed, indent=2), filename)
    except json.JSONDecodeError:
        # Not valid JSON — treat as plain text
        return _cap(content.decode("utf-8", errors="replace"), filename)
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail=f"Failed to read JSON '{filename}': {e}",
        )


def _extract_plain_text(content: bytes, filename: str) -> str:
    try:
        return _cap(content.decode("utf-8", errors="replace"), filename)
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail=f"Failed to read '{filename}': {e}",
        )
