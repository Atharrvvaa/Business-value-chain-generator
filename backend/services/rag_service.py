# backend/services/rag_service.py
import asyncio
import re
import logging
import tempfile
from dataclasses import dataclass
from urllib.parse import urljoin, urlparse

import httpx
import numpy as np
from bs4 import BeautifulSoup

from backend.config import settings

logger = logging.getLogger(__name__)

CHUNK_SIZE = 800
CHUNK_OVERLAP = 100
MAX_CHUNKS = 60
TOP_K = 5


@dataclass
class TwoLayerContext:
    # Layer 1: industry framework reference content from the repo URL
    industry_framework: str | None
    # Layer 2: enterprise-specific content (from file, URL, or both)
    enterprise_context: str | None


# ── Text utilities ────────────────────────────────────────────────────────────

def _chunk_text(text: str) -> list[str]:
    chunks = []
    start = 0
    while start < len(text):
        end = start + CHUNK_SIZE
        chunk = text[start:end].strip()
        if len(chunk) > 60:
            chunks.append(chunk)
        start = end - CHUNK_OVERLAP
    return chunks


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    a_arr = np.array(a, dtype=np.float32)
    b_arr = np.array(b, dtype=np.float32)
    norm_a = np.linalg.norm(a_arr)
    norm_b = np.linalg.norm(b_arr)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a_arr, b_arr) / (norm_a * norm_b))


def _top_k(
    query_emb: list[float],
    chunks: list[str],
    chunk_embs: list[list[float]],
    k: int,
) -> list[str]:
    scored = sorted(
        zip(chunk_embs, chunks),
        key=lambda x: _cosine_similarity(query_emb, x[0]),
        reverse=True,
    )
    return [chunk for _, chunk in scored[:k]]


# ── Ollama embed ──────────────────────────────────────────────────────────────

async def _get_embeddings(texts: list[str], client: httpx.AsyncClient) -> list[list[float]]:
    response = await client.post(
        f"{settings.ollama_base_url}/api/embed",
        json={"model": settings.ollama_embed_model, "input": texts},
        timeout=httpx.Timeout(connect=10.0, read=180.0, write=30.0, pool=5.0),
    )
    response.raise_for_status()
    return response.json()["embeddings"]


# ── Fetchers ──────────────────────────────────────────────────────────────────

def _github_headers() -> dict:
    headers = {"Accept": "application/vnd.github.v3+json"}
    if settings.github_token:
        headers["Authorization"] = f"Bearer {settings.github_token}"
    return headers


async def _fetch_github(url: str, client: httpx.AsyncClient) -> str:
    match = re.match(r"https?://github\.com/([^/]+)/([^/#?]+)", url)
    if not match:
        return ""

    owner, repo = match.group(1), match.group(2)
    api_url = f"https://api.github.com/repos/{owner}/{repo}/git/trees/HEAD?recursive=1"

    try:
        resp = await client.get(api_url, headers=_github_headers(), timeout=15.0)

        if resp.status_code == 403:
            remaining = resp.headers.get("X-RateLimit-Remaining", "?")
            reset = resp.headers.get("X-RateLimit-Reset", "?")
            msg = resp.json().get("message", "")
            logger.warning(
                "GitHub 403 for %s — rate_limit_remaining=%s reset=%s message=%r. "
                "Set GITHUB_TOKEN in .env to raise the limit from 60 to 5000 req/hr.",
                api_url, remaining, reset, msg,
            )
            return ""

        if resp.status_code != 200:
            logger.warning("GitHub API %d for %s", resp.status_code, api_url)
            return ""

        tree = resp.json().get("tree", [])
    except Exception as exc:
        logger.warning("GitHub tree fetch failed: %s", exc)
        return ""

    text_exts = {".md", ".txt", ".rst", ".yaml", ".yml", ".json"}
    blobs = [
        f for f in tree
        if f["type"] == "blob"
        and any(f["path"].lower().endswith(ext) for ext in text_exts)
    ]
    # README and shallowest paths first; cap at 20 files
    blobs.sort(key=lambda f: (0 if "readme" in f["path"].lower() else 1, f["path"].count("/")))
    blobs = blobs[:20]

    parts = []
    for blob in blobs:
        raw_url = f"https://raw.githubusercontent.com/{owner}/{repo}/HEAD/{blob['path']}"
        try:
            r = await client.get(raw_url, headers=_github_headers(), timeout=10.0)
            if r.status_code == 403:
                logger.warning("GitHub raw 403 for %s — repo may be private", blob["path"])
                continue
            if r.status_code == 200 and r.text.strip():
                parts.append(f"[{blob['path']}]\n{r.text[:3000]}")
        except Exception:
            continue

    return "\n\n".join(parts)


# ── Google Drive / Docs fetcher ───────────────────────────────────────────────

_GDRIVE_FILE_RE = re.compile(r"drive\.google\.com/file/d/([a-zA-Z0-9_-]+)")
_GDRIVE_OPEN_RE = re.compile(r"drive\.google\.com/open\?.*?id=([a-zA-Z0-9_-]+)")
_GDRIVE_UC_RE   = re.compile(r"drive\.google\.com/uc\?.*?id=([a-zA-Z0-9_-]+)")
_GDOC_RE        = re.compile(r"docs\.google\.com/document/d/([a-zA-Z0-9_-]+)")
_GSHEET_RE      = re.compile(r"docs\.google\.com/spreadsheets/d/([a-zA-Z0-9_-]+)")
_GSLIDES_RE     = re.compile(r"docs\.google\.com/presentation/d/([a-zA-Z0-9_-]+)")
_GFOLDER_RE     = re.compile(r"drive\.google\.com/drive/folders/")


async def _download_and_extract(export_url: str, client: httpx.AsyncClient, label: str) -> str:
    """Download a Google export URL and extract plain text from the response."""
    try:
        resp = await client.get(export_url, timeout=30.0, follow_redirects=True,
                                headers={"User-Agent": "Mozilla/5.0"})
    except Exception as exc:
        logger.warning("Google Drive download error for %s: %s", label, exc)
        return ""

    if resp.status_code == 403:
        logger.warning(
            "Google Drive 403 for %s (%s) — file is not publicly shared. "
            "Go to Share → 'Anyone with the link can view' and retry.",
            label, export_url,
        )
        return ""

    if resp.status_code != 200:
        logger.warning("Google Drive export returned HTTP %d for %s", resp.status_code, label)
        return ""

    content_type = resp.headers.get("content-type", "")

    if "text/plain" in content_type or "text/csv" in content_type:
        return resp.text[:15000]

    if "application/pdf" in content_type:
        import fitz
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(resp.content)
            tmp_path = tmp.name
        doc = fitz.open(tmp_path)
        return "\n".join(p.get_text() for p in doc)[:15000]

    if "application/vnd.openxmlformats-officedocument.wordprocessingml" in content_type:
        from docx import Document
        import io
        doc = Document(io.BytesIO(resp.content))
        return "\n".join(p.text for p in doc.paragraphs if p.text.strip())[:15000]

    if "text/html" in content_type:
        # Google often redirects private files to a login/warning HTML page
        soup = BeautifulSoup(resp.text, "html.parser")
        text = soup.get_text(separator="\n", strip=True)
        if len(text) < 300:
            logger.warning(
                "Google Drive returned an HTML page for %s — "
                "file may be private or require a virus-scan confirmation. "
                "Try making it public or upload the file directly.",
                label,
            )
            return ""
        return text[:15000]

    # Fallback: treat as plain text (e.g., .txt, .md, .csv with wrong content-type)
    return resp.text[:15000]


async def _fetch_google_drive(url: str, client: httpx.AsyncClient) -> str:
    """
    Convert any Google Drive / Docs / Sheets / Slides viewer URL into a direct
    export URL and download the document content.

    Supported:
      drive.google.com/file/d/{id}/...   → PDF / Office / text download
      drive.google.com/open?id={id}      → same
      docs.google.com/document/d/{id}    → exported as plain text
      docs.google.com/spreadsheets/d/{id}→ exported as CSV
      docs.google.com/presentation/d/{id}→ exported as plain text

    Not supported (requires OAuth):
      drive.google.com/drive/folders/... → folder listing needs Drive API
      Private files without public sharing
    """
    # Folder links are not crawlable without OAuth
    if _GFOLDER_RE.search(url):
        logger.warning(
            "RAG: Google Drive folder URL detected (%s). "
            "Folder listing requires the Drive API with OAuth — "
            "share individual documents or upload them directly instead.",
            url,
        )
        return ""

    # Google Docs
    m = _GDOC_RE.search(url)
    if m:
        export = f"https://docs.google.com/document/d/{m.group(1)}/export?format=txt"
        logger.info("RAG: Google Doc → exporting as text (id=%s)", m.group(1))
        return await _download_and_extract(export, client, f"Google Doc {m.group(1)}")

    # Google Sheets
    m = _GSHEET_RE.search(url)
    if m:
        export = f"https://docs.google.com/spreadsheets/d/{m.group(1)}/export?format=csv"
        logger.info("RAG: Google Sheet → exporting as CSV (id=%s)", m.group(1))
        return await _download_and_extract(export, client, f"Google Sheet {m.group(1)}")

    # Google Slides
    m = _GSLIDES_RE.search(url)
    if m:
        export = f"https://docs.google.com/presentation/d/{m.group(1)}/export/txt"
        logger.info("RAG: Google Slides → exporting as text (id=%s)", m.group(1))
        return await _download_and_extract(export, client, f"Google Slides {m.group(1)}")

    # Google Drive file (PDF, DOCX, image, etc.)
    file_id = None
    for pattern in (_GDRIVE_FILE_RE, _GDRIVE_OPEN_RE, _GDRIVE_UC_RE):
        m = pattern.search(url)
        if m:
            file_id = m.group(1)
            break

    if file_id:
        download = f"https://drive.google.com/uc?export=download&id={file_id}"
        logger.info("RAG: Google Drive file → downloading (id=%s)", file_id)
        return await _download_and_extract(download, client, f"Drive file {file_id}")

    logger.warning("RAG: Could not parse a file ID from Google Drive URL: %s", url)
    return ""


_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip, deflate, br",
}

MAX_CRAWL_PAGES = 10   # main page + up to 9 linked pages
MAX_PAGE_CHARS = 4000  # per-page text cap before combining
MAX_TOTAL_CHARS = 20000


def _extract_text_and_links(html: str, page_url: str, base_domain: str) -> tuple[str, list[str]]:
    """Parse HTML: return (clean_text, internal_links_same_domain)."""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
        tag.decompose()

    text = soup.get_text(separator="\n", strip=True)

    links = []
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if href.startswith(("mailto:", "tel:", "#", "javascript:")):
            continue
        full = urljoin(page_url, href)
        parsed = urlparse(full)
        # Only same-domain, http/https links
        if parsed.scheme in ("http", "https") and parsed.netloc == base_domain:
            clean = parsed._replace(fragment="").geturl()
            links.append(clean)

    # Deduplicate while preserving order
    seen = set()
    unique_links = []
    for l in links:
        if l not in seen and l != page_url:
            seen.add(l)
            unique_links.append(l)

    return text, unique_links


async def _fetch_one_page(url: str, client: httpx.AsyncClient, base_domain: str) -> tuple[str, list[str]]:
    """Fetch a single URL. Returns (text, internal_links). Never raises."""
    try:
        resp = await client.get(url, timeout=12.0, follow_redirects=True, headers=_BROWSER_HEADERS)

        if resp.status_code == 403:
            logger.warning(
                "403 for %s — server is blocking automated access "
                "(needs auth, cookies, or JS). Upload the document directly instead.",
                url,
            )
            return "", []

        if resp.status_code != 200:
            logger.warning("HTTP %d for %s", resp.status_code, url)
            return "", []

        content_type = resp.headers.get("content-type", "")

        if "text/html" in content_type:
            text, links = _extract_text_and_links(resp.text, url, base_domain)
            return text[:MAX_PAGE_CHARS], links

        if "application/pdf" in content_type:
            import fitz
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp.write(resp.content)
                tmp_path = tmp.name
            doc = fitz.open(tmp_path)
            return "\n".join(p.get_text() for p in doc)[:MAX_PAGE_CHARS], []

        # Plain text / markdown / JSON / etc.
        return resp.text[:MAX_PAGE_CHARS], []

    except Exception as exc:
        logger.warning("Failed to fetch %s: %s", url, exc)
        return "", []


async def _fetch_generic(url: str, client: httpx.AsyncClient) -> str:
    """
    Mini-crawler: fetch the seed URL, then fan out to same-domain internal links
    in parallel (up to MAX_CRAWL_PAGES total). Returns combined text of all pages.
    """
    parsed_seed = urlparse(url)
    base_domain = parsed_seed.netloc

    # Step 1 — fetch seed page to get content + internal links
    main_text, seed_links = await _fetch_one_page(url, client, base_domain)
    if not main_text:
        return ""

    parts = [f"[{url}]\n{main_text}"]

    # Step 2 — fan out to internal links in parallel (up to MAX_CRAWL_PAGES - 1 more)
    candidate_links = seed_links[: MAX_CRAWL_PAGES - 1]
    if candidate_links:
        logger.info("RAG crawl: fetching %d linked pages in parallel from %s", len(candidate_links), url)
        results = await asyncio.gather(
            *[_fetch_one_page(link, client, base_domain) for link in candidate_links],
            return_exceptions=True,
        )
        for link, result in zip(candidate_links, results):
            if isinstance(result, Exception):
                logger.warning("Crawl error for %s: %s", link, result)
                continue
            page_text, _ = result
            if page_text:
                parts.append(f"[{link}]\n{page_text}")

    combined = "\n\n".join(parts)
    logger.info(
        "RAG crawl: %d/%d pages yielded content, total %d chars from %s",
        len(parts), len(candidate_links) + 1, len(combined), url,
    )
    return combined[:MAX_TOTAL_CHARS]


# ── URL router ───────────────────────────────────────────────────────────────

async def _route_fetch(url: str, client: httpx.AsyncClient) -> str:
    """Dispatch a URL to the correct fetcher based on its pattern."""
    if re.match(r"https?://github\.com/[^/]+/[^/]+", url):
        return await _fetch_github(url, client)

    if re.search(r"(drive\.google\.com|docs\.google\.com)", url):
        return await _fetch_google_drive(url, client)

    return await _fetch_generic(url, client)


# ── Public API ────────────────────────────────────────────────────────────────

async def retrieve_two_layer_context(
    repo_url: str | None,
    company_name: str,
    industry: str,
    file_content: str | None = None,
) -> TwoLayerContext:
    """
    Layer 1 — Industry Framework:
        Semantically retrieves industry framework/reference model content from repo_url.
        Query: "{industry} capability framework standard BIAN APQC TOGAF reference model"

    Layer 2 — Enterprise Context:
        Primary source: uploaded file (RAG-processed, not dumped raw).
        Supplement: enterprise-specific chunks from repo_url.
        If no file and no URL, both layers are None.
    """
    industry_framework: str | None = None
    enterprise_context: str | None = None

    async with httpx.AsyncClient() as client:

        # ── URL retrieval: fetch once, embed once, retrieve for both layers ──
        if repo_url:
            logger.info("RAG Layer 1+2: fetching %s", repo_url)
            raw_text = await _route_fetch(repo_url, client)

            if raw_text and len(raw_text) >= 100:
                logger.info("RAG: fetched %d chars from URL", len(raw_text))
                url_chunks = _chunk_text(raw_text)[:MAX_CHUNKS]

                # Two distinct semantic queries — one per layer
                l1_query = (
                    f"{industry} industry framework reference model capability "
                    f"standard BIAN APQC TOGAF COBIT value chain"
                )
                l2_query = (
                    f"{company_name} {industry} enterprise business capabilities "
                    f"strategy operations products services business model"
                )

                try:
                    # Single batch: all chunks + both queries
                    all_embs = await _get_embeddings(url_chunks + [l1_query, l2_query], client)
                    url_chunk_embs = all_embs[: len(url_chunks)]
                    l1_query_emb = all_embs[-2]
                    l2_query_emb = all_embs[-1]

                    l1_chunks = _top_k(l1_query_emb, url_chunks, url_chunk_embs, TOP_K)
                    l2_url_chunks = _top_k(l2_query_emb, url_chunks, url_chunk_embs, TOP_K)

                    industry_framework = "\n\n---\n\n".join(l1_chunks) or None
                    enterprise_context = "\n\n---\n\n".join(l2_url_chunks) or None

                    logger.info(
                        "RAG URL: Layer 1 = %d chunks, Layer 2 = %d chunks",
                        len(l1_chunks),
                        len(l2_url_chunks),
                    )
                except Exception as exc:
                    logger.warning("RAG: URL embedding failed: %s", exc)
            else:
                logger.warning("RAG: no usable content from %s", repo_url)

        # ── File retrieval: RAG-process the uploaded document for enterprise context ──
        # Used as primary source when no URL, or prepended to URL enterprise context.
        if file_content and len(file_content) >= 100:
            file_chunks = _chunk_text(file_content)
            if file_chunks:
                file_query = (
                    f"{company_name} {industry} business capabilities strategy "
                    f"value proposition operations products services"
                )
                try:
                    all_embs = await _get_embeddings(file_chunks + [file_query], client)
                    file_chunk_embs = all_embs[:-1]
                    file_query_emb = all_embs[-1]

                    file_top = _top_k(file_query_emb, file_chunks, file_chunk_embs, TOP_K)
                    file_enterprise = "\n\n---\n\n".join(file_top) or None

                    logger.info("RAG File: Layer 2 = %d chunks", len(file_top))

                    # File is more enterprise-specific — place it first
                    if file_enterprise:
                        enterprise_context = (
                            file_enterprise + "\n\n---\n\n" + enterprise_context
                            if enterprise_context
                            else file_enterprise
                        )
                except Exception as exc:
                    logger.warning("RAG: file embedding failed: %s", exc)

    return TwoLayerContext(
        industry_framework=industry_framework,
        enterprise_context=enterprise_context,
    )
