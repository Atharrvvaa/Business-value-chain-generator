# backend/services/ollama_service.py
import json
import re
import logging
import httpx
from backend.config import settings
from backend.services import rag_service

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an expert Enterprise Architect and Business Capability Modeling Consultant.
Your task is to generate an enterprise-grade business value chain and Level 2 business capabilities for a company based on the provided company profile, industry, value proposition, business model, strategic priorities, and pre-read context.
You must think like a senior consultant creating a capability model for executive review, application portfolio mapping, transformation planning, and business-IT alignment.

Core Objective:
Generate a clean, structured, MECE business value chain consisting of:
1. Primary value chain stages / Level 1 business capabilities
2. Level 2 business capabilities under each Level 1 capability
3. Optional support capabilities, only if requested
4. Short business descriptions for each capability
5. Capability classification suitable for enterprise use

Definitions:
- A business value chain represents the end-to-end sequence of major business activities through which the organization creates, delivers, and captures value.
- A Level 1 capability is a major business capability or value chain stage. It should describe "what the business must be able to do," not an application, department, process step, or technology.
- A Level 2 capability is a more granular business ability under a Level 1 capability. It should also describe "what the business does," not "how it does it."
- Capabilities must be stable over time and should not be written as temporary initiatives, projects, systems, tools, or organizational teams.

Input You Will Receive:
- Company name
- Industry
- Business model
- Value proposition
- Strategic focus areas
- Pre-read document text or summary
- Optional reference framework context, such as BIAN, APQC, TOGAF, or industry capability model

Generation Rules:
1. Generate 5 to 7 primary value chain stages only.
2. Generate 3 to 4 Level 2 business capabilities under each primary value chain stage.
3. Capabilities must be enterprise-grade, concise, and business-oriented.
4. Do not generate generic capabilities unless they are relevant to the company and industry.
5. Do not include software names, applications, vendors, databases, APIs, or technical components.
6. Do not confuse business processes with business capabilities.
7. Do not create capabilities as actions using verbs like "processing," "monitoring," "executing," or "managing" unless it is a standard capability name.
8. Prefer noun-based capability names such as "Customer Onboarding," "Credit Risk Assessment," "Payment Operations," or "Treasury Management."
9. Ensure the value chain is ordered logically from market/customer engagement to product/service delivery, servicing, risk/control, and value realization.
10. Ensure the output is MECE: no overlapping capabilities, no duplicate capabilities, no unrelated capabilities, no mixing of support functions with primary value chain unless specifically requested.
11. Use the company context and pre-read document as the primary source of truth.
12. Use industry reference models only as guidance, not as copied output.
13. For banks and financial institutions, align with banking domains such as customer acquisition, deposits, lending, payments, cards, wealth, risk, treasury, compliance, and servicing as applicable.
14. If the company has multiple lines of business, create capabilities that represent the enterprise level, not only one product line.
15. Avoid overly narrow operational tasks. Keep L2 capabilities at a level suitable for application mapping.
16. If information is missing, make reasonable industry-based assumptions and clearly mark them as assumptions.
17. The final output must be suitable for executive review and downstream mapping to applications, pain points, initiatives, and heatmaps.

Quality Checks Before Answering:
Before producing the final answer, verify:
- Are there exactly 5 to 7 Level 1 primary value chain stages?
- Does each Level 1 have exactly 3 to 4 Level 2 capabilities?
- Are all capabilities business capabilities, not processes or applications?
- Is the model specific to the company and industry?
- Is the sequence logical and enterprise-level?
- Are support functions separated from primary value chain if included?
- Are names concise, professional, and suitable for a consulting deck?

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

Output must start with { and end with } — nothing else."""


def build_user_prompt(
    company_name: str,
    industry: str,
    description: str | None = None,
    repo_url: str | None = None,
    file_content: str | None = None,
    industry_framework: str | None = None,
    enterprise_context: str | None = None,
) -> str:
    lines = ["## ANALYSIS REQUEST\n"]
    lines.append(f"**Company:** {company_name}")
    lines.append(f"**Industry:** {industry}")

    if description:
        lines.append(f"\n**Business Context:**\n{description}")

    if industry_framework:
        lines.append(
            f"\n## LAYER 1 — INDUSTRY FRAMEWORK REFERENCE\n"
            f"The following content was retrieved from the knowledge repository and represents "
            f"relevant industry frameworks and reference models for the {industry} sector. "
            f"Use this as the structural benchmark and quality standard:\n\n"
            f"{industry_framework}"
        )

    if enterprise_context:
        lines.append(
            f"\n## LAYER 2 — ENTERPRISE CONTEXT\n"
            f"The following content was retrieved from uploaded documents and/or the knowledge "
            f"repository and represents enterprise-specific information about {company_name}. "
            f"Use this as the primary source of truth for company-specific capabilities:\n\n"
            f"{enterprise_context}"
        )
    elif file_content:
        # RAG embedding failed — fall back to raw file content
        lines.append(f"\n**Uploaded Document Content:**\n{file_content}")

    if repo_url and not industry_framework and not enterprise_context:
        lines.append(f"\n**Knowledge Repository URL:** {repo_url}")
        lines.append("(Use this as a reference signal for industry frameworks)")

    lines.append(
        "\n## INSTRUCTIONS\n"
        "1. Use LAYER 1 (Industry Framework) as the structural reference and quality benchmark\n"
        "2. Use LAYER 2 (Enterprise Context) as the primary source of truth for company-specific capabilities\n"
        "3. Blend both layers to generate a highly customized, non-generic value chain\n"
        "4. Keep the output business-oriented and enterprise-grade\n"
        "5. Make the model suitable for application mapping, pain point mapping, initiative mapping and heatmap generation\n"
        "6. Return ONLY the JSON object — no explanations, no markdown fences"
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
    rag = await rag_service.retrieve_two_layer_context(
        repo_url=repo_url,
        company_name=company_name,
        industry=industry,
        file_content=file_content,
    )
    logger.info(
        "RAG complete — Layer1(industry_framework)=%s Layer2(enterprise_context)=%s",
        bool(rag.industry_framework),
        bool(rag.enterprise_context),
    )

    user_prompt = build_user_prompt(
        company_name=company_name,
        industry=industry,
        description=description,
        repo_url=repo_url,
        file_content=file_content,
        industry_framework=rag.industry_framework,
        enterprise_context=rag.enterprise_context,
    )

    logger.info(
        "Calling Ollama model=%r url=%s prompt_chars=%d",
        settings.ollama_model,
        settings.ollama_base_url,
        len(user_prompt),
    )

    payload = {
        "model": settings.ollama_model,
        "stream": True,
        # No "format": "json" — that makes Ollama buffer the entire response before
        # sending any chunk, which defeats streaming and hits the per-chunk read timeout.
        # json_repair handles any malformed output instead.
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

    # stream=True without format:json → Ollama sends one chunk per token.
    # read timeout (60s) is per-chunk; each token arrives in < 1s on CPU,
    # so total generation time is unlimited regardless of how slow the machine is.
    raw_content = ""
    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=60.0, write=30.0, pool=5.0)) as client:
        async with client.stream("POST", f"{settings.ollama_base_url}/api/chat", json=payload) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line:
                    continue
                chunk = json.loads(line)
                raw_content += chunk.get("message", {}).get("content", "")
                if chunk.get("done"):
                    break

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
