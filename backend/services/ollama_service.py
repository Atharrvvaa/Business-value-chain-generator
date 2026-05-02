# backend/services/ollama_service.py
import json
import re
import logging
import httpx
from backend.config import settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an expert Business Architect AI specializing in Value Chain Analysis
and Capability Mapping, trained in McKinsey/Bain consulting methodology.

Your task is to generate a structured JSON response containing:
1. A Context Summary
2. A detailed Business Value Chain (primary + support activities)
3. Level 2 Business Capabilities for each value chain component
4. Support activities that enable the primary value chain like HR, Admin, IT, etc.

## CRITICAL RULES
- Be MECE (Mutually Exclusive, Collectively Exhaustive)
- Capabilities must be action-oriented, NOT process names
- Customize heavily for the specific company — avoid Porter's generic template
- No hallucination — infer intelligently from provided context
- Consulting-grade clarity (McKinsey/Bain standard)

## OUTPUT FORMAT
Return ONLY valid JSON (no markdown, no preamble, no code fences) in this exact schema:

{
  "context": {
    "valueProposition": "string",
    "businessModel": "string",
    "differentiation": "string",
    "keyInsights": ["string", "string", "string"]
  },
  "primaryActivities": [
    {
      "id": "PA1",
      "name": "string",
      "description": "string",
      "capabilities": [
        { "id": "PA1-C1", "name": "string", "description": "string" }
      ]
    }
  ],
  "supportFunctions": [
    {
      "id": "SF1",
      "name": "string",
      "description": "string",
      "capabilities": [
        { "id": "SF1-C1", "name": "string", "description": "string" }
      ]
    }
  ]
}

## QUALITY STANDARDS
- Primary Activities: 5-8 items (end-to-end value delivery flow)
- Support Functions: 4-6 items
- Capabilities per component: 4-7 (specific, non-generic)
- Each capability name: 2-4 words, action-noun format
- Each capability description: 1 crisp sentence explaining WHAT it enables
- Output must start with { and end with } — nothing else"""


def build_user_prompt(
    company_name: str,
    industry: str,
    description: str | None = None,
    repo_url: str | None = None,
    file_content: str | None = None,
) -> str:
    lines = ["## ANALYSIS REQUEST\n"]
    lines.append(f"**Company:** {company_name}")
    lines.append(f"**Industry:** {industry}")

    if description:
        lines.append(f"\n**Business Context:**\n{description}")

    if file_content:
        lines.append(f"\n**Uploaded Document Content:**\n{file_content}")

    if repo_url:
        lines.append(f"\n**Knowledge Repository URL:** {repo_url}")
        lines.append("(Use this as a reference signal for industry frameworks)")

    lines.append(
        "\n## INSTRUCTIONS\n"
        "1. Perform deep context analysis from all inputs above\n"
        "2. Enrich with industry-standard capability frameworks\n"
        "3. Generate a highly customized, non-generic value chain\n"
        "4. Return ONLY the JSON object — no explanations, no markdown fences"
    )
    return "\n".join(lines)


def extract_json(raw: str) -> dict:
    cleaned = re.sub(r"```json\s*", "", raw, flags=re.IGNORECASE)
    cleaned = cleaned.replace("```", "").strip()

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError(f"No JSON object found in model response. Raw (first 300 chars): {raw[:300]}")

    json_str = cleaned[start: end + 1]

    # First try strict parse
    try:
        return json.loads(json_str)
    except json.JSONDecodeError as exc:
        logger.warning("Strict JSON parse failed (%s) — attempting repair", exc)

    # Fallback: repair truncated/malformed JSON from the model
    try:
        from json_repair import repair_json
        repaired = repair_json(json_str, return_objects=True)
        if isinstance(repaired, dict):
            logger.info("JSON repaired successfully")
            return repaired
        raise ValueError("Repaired JSON was not a dict")
    except Exception as repair_exc:
        raise ValueError(
            f"JSON parse and repair both failed. Parse error: {exc}. "
            f"Repair error: {repair_exc}. Raw (first 300): {json_str[:300]}"
        )


def validate_response(data: dict) -> None:
    required_top = {"context", "primaryActivities", "supportFunctions"}
    missing = required_top - set(data.keys())
    if missing:
        raise ValueError(f"Model response missing required fields: {missing}")

    if not isinstance(data["primaryActivities"], list) or len(data["primaryActivities"]) < 2:
        raise ValueError("primaryActivities must be a list with at least 2 items")

    if not isinstance(data["supportFunctions"], list) or len(data["supportFunctions"]) < 1:
        raise ValueError("supportFunctions must be a non-empty list")

    for activity in data["primaryActivities"]:
        if not activity.get("capabilities"):
            raise ValueError(f"Activity '{activity.get('name')}' has no capabilities")


async def generate_value_chain(
    company_name: str,
    industry: str,
    description: str | None = None,
    repo_url: str | None = None,
    file_content: str | None = None,
) -> dict:
    user_prompt = build_user_prompt(
        company_name=company_name,
        industry=industry,
        description=description,
        repo_url=repo_url,
        file_content=file_content,
    )

    logger.info(
        "Calling Ollama model=%r url=%s prompt_chars=%d",
        settings.ollama_model,
        settings.ollama_base_url,
        len(user_prompt),
    )

    payload = {
        "model": settings.ollama_model,
        "stream": False,
        "options": {
            "temperature": settings.ollama_temperature,
            "num_predict": settings.ollama_num_predict,
            "top_p": 0.9,
        },
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=600.0, write=30.0, pool=5.0)) as client:
        response = await client.post(
            f"{settings.ollama_base_url}/api/chat",
            json=payload,
        )
        response.raise_for_status()

    data = response.json()
    raw_content = data.get("message", {}).get("content", "")
    logger.info("Ollama responded — raw content length=%d chars", len(raw_content))

    if not raw_content.strip():
        raise ValueError("Ollama returned an empty response. Please try again.")

    parsed = extract_json(raw_content)
    validate_response(parsed)

    logger.info(
        "Value chain validated — primaryActivities=%d supportFunctions=%d",
        len(parsed["primaryActivities"]),
        len(parsed["supportFunctions"]),
    )
    return parsed


async def get_available_models() -> list[str]:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{settings.ollama_base_url}/api/tags")
            response.raise_for_status()
            data = response.json()
            models = [m["name"] for m in data.get("models", [])]
            logger.debug("Available Ollama models: %s", models)
            return models
    except Exception as exc:
        logger.warning("Could not fetch Ollama models: %s", exc)
        return []


async def check_health() -> dict:
    models = await get_available_models()
    return {
        "ollama_connected": len(models) >= 0,
        "available_models": models,
    }
