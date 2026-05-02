# backend/tests/test_backend.py
"""
Backend test suite — no Ollama or network required.
Tests: prompt building, JSON extraction, schema validation, file service, API routes (mocked).
"""
import json
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient

from backend.services.ollama_service import (
    build_user_prompt,
    extract_json,
    validate_response,
)
from backend.main import app

client = TestClient(app)


# ── Fixtures ──────────────────────────────────────────────────────────────────
VALID_RESPONSE = {
    "context": {
        "valueProposition": "India's largest private sector bank",
        "businessModel": "Net interest income + fee income",
        "differentiation": "Technology leadership and risk discipline",
        "keyInsights": ["Digital first", "Rural expansion", "Wealth cross-sell"],
    },
    "primaryActivities": [
        {
            "id": "PA1",
            "name": "Customer Acquisition",
            "description": "Attract and onboard customers across channels",
            "capabilities": [
                {"id": "PA1-C1", "name": "Digital Lead Management", "description": "Capture leads from digital channels"},
                {"id": "PA1-C2", "name": "Branch Onboarding", "description": "In-branch KYC and account setup"},
                {"id": "PA1-C3", "name": "Partner Channel Management", "description": "Manage DSA and fintech partnerships"},
                {"id": "PA1-C4", "name": "Customer Segmentation", "description": "AI-driven segmentation for targeting"},
            ],
        },
        {
            "id": "PA2",
            "name": "Product Origination",
            "description": "Credit and deposit product issuance",
            "capabilities": [
                {"id": "PA2-C1", "name": "Credit Underwriting", "description": "AI-assisted credit decisioning"},
                {"id": "PA2-C2", "name": "KYC & Onboarding", "description": "Regulatory identity verification"},
                {"id": "PA2-C3", "name": "Product Configuration", "description": "Dynamic product setup and pricing"},
            ],
        },
    ],
    "supportFunctions": [
        {
            "id": "SF1",
            "name": "Risk & Compliance",
            "description": "Regulatory adherence and risk management",
            "capabilities": [
                {"id": "SF1-C1", "name": "Regulatory Reporting", "description": "RBI compliance submissions"},
                {"id": "SF1-C2", "name": "Fraud Detection", "description": "Real-time transaction monitoring"},
                {"id": "SF1-C3", "name": "Credit Risk Monitoring", "description": "Portfolio risk surveillance"},
            ],
        },
        {
            "id": "SF2",
            "name": "Technology & Digital",
            "description": "Core banking and digital channel engineering",
            "capabilities": [
                {"id": "SF2-C1", "name": "Core Banking Management", "description": "CBS reliability and evolution"},
                {"id": "SF2-C2", "name": "Digital Channel Engineering", "description": "Mobile and netbanking development"},
            ],
        },
    ],
}


# ── Suite 1: Prompt Building ──────────────────────────────────────────────────
class TestPromptBuilding:
    def test_required_fields_included(self):
        prompt = build_user_prompt("HDFC Bank", "Banking")
        assert "HDFC Bank" in prompt
        assert "Banking" in prompt

    def test_description_included_when_provided(self):
        prompt = build_user_prompt("X", "Y", description="Digital bank")
        assert "Digital bank" in prompt

    def test_description_omitted_when_none(self):
        prompt = build_user_prompt("X", "Y")
        assert "Business Context" not in prompt

    def test_repo_url_included(self):
        prompt = build_user_prompt("X", "Y", repo_url="https://example.com/caps")
        assert "https://example.com/caps" in prompt

    def test_file_content_included(self):
        prompt = build_user_prompt("X", "Y", file_content="=== doc.pdf ===\nSome content")
        assert "Some content" in prompt

    def test_no_none_strings_in_output(self):
        prompt = build_user_prompt("X", "Y")
        assert "None" not in prompt

    def test_instructions_always_present(self):
        prompt = build_user_prompt("X", "Y")
        assert "INSTRUCTIONS" in prompt
        assert "Return ONLY the JSON" in prompt


# ── Suite 2: JSON Extraction ──────────────────────────────────────────────────
class TestExtractJSON:
    VALID = '{"context":{"valueProposition":"test"},"primaryActivities":[],"supportFunctions":[]}'

    def test_clean_json_passthrough(self):
        result = extract_json(self.VALID)
        assert result == json.loads(self.VALID)

    def test_strips_json_fences(self):
        result = extract_json(f"```json\n{self.VALID}\n```")
        assert result == json.loads(self.VALID)

    def test_strips_plain_fences(self):
        result = extract_json(f"```\n{self.VALID}\n```")
        assert result == json.loads(self.VALID)

    def test_handles_prose_before(self):
        result = extract_json(f"Sure, here is the result:\n{self.VALID}")
        assert result == json.loads(self.VALID)

    def test_handles_prose_after(self):
        result = extract_json(f"{self.VALID}\nI hope that helps!")
        assert result == json.loads(self.VALID)

    def test_handles_prose_both_sides(self):
        result = extract_json(f"Here:\n{self.VALID}\nDone.")
        assert result == json.loads(self.VALID)

    def test_raises_on_empty(self):
        with pytest.raises(ValueError, match="No JSON object found"):
            extract_json("")

    def test_raises_on_prose_only(self):
        with pytest.raises(ValueError):
            extract_json("I cannot provide that as JSON.")

    def test_raises_on_invalid_json(self):
        with pytest.raises(ValueError):
            extract_json("{invalid json here}")


# ── Suite 3: Schema Validation ────────────────────────────────────────────────
class TestValidateResponse:
    def test_valid_response_passes(self):
        validate_response(VALID_RESPONSE)  # Should not raise

    def test_missing_context_raises(self):
        bad = {k: v for k, v in VALID_RESPONSE.items() if k != "context"}
        with pytest.raises(ValueError, match="context"):
            validate_response(bad)

    def test_missing_primary_activities_raises(self):
        bad = {k: v for k, v in VALID_RESPONSE.items() if k != "primaryActivities"}
        with pytest.raises(ValueError):
            validate_response(bad)

    def test_empty_primary_activities_raises(self):
        bad = {**VALID_RESPONSE, "primaryActivities": []}
        with pytest.raises(ValueError):
            validate_response(bad)

    def test_activity_without_capabilities_raises(self):
        bad_activity = {**VALID_RESPONSE["primaryActivities"][0], "capabilities": []}
        bad = {**VALID_RESPONSE, "primaryActivities": [bad_activity]}
        with pytest.raises(ValueError):
            validate_response(bad)

    def test_missing_support_functions_raises(self):
        bad = {k: v for k, v in VALID_RESPONSE.items() if k != "supportFunctions"}
        with pytest.raises(ValueError):
            validate_response(bad)


# ── Suite 4: API Routes (mocked Ollama) ───────────────────────────────────────
class TestAPIRoutes:
    def test_root_returns_service_info(self):
        res = client.get("/")
        assert res.status_code == 200
        assert res.json()["service"] == "Business Architect AI"

    def test_health_endpoint_exists(self):
        with patch(
            "backend.routers.api.ollama_service.check_health",
            new_callable=AsyncMock,
            return_value={"ollama_connected": True, "available_models": ["llama3.2"]},
        ):
            res = client.get("/api/health")
            assert res.status_code == 200
            data = res.json()
            assert "status" in data
            assert "ollama_connected" in data

    def test_generate_returns_value_chain(self):
        with patch(
            "backend.routers.api.ollama_service.generate_value_chain",
            new_callable=AsyncMock,
            return_value=VALID_RESPONSE,
        ):
            res = client.post(
                "/api/generate",
                json={"company_name": "HDFC Bank", "industry": "Banking"},
            )
            assert res.status_code == 200
            data = res.json()
            assert "primaryActivities" in data
            assert "supportFunctions" in data
            assert "context" in data

    def test_generate_missing_company_name(self):
        res = client.post("/api/generate", json={"industry": "Banking"})
        assert res.status_code == 422

    def test_generate_missing_industry(self):
        res = client.post("/api/generate", json={"company_name": "HDFC"})
        assert res.status_code == 422

    def test_generate_empty_company_name(self):
        res = client.post("/api/generate", json={"company_name": "", "industry": "Banking"})
        assert res.status_code == 422

    def test_models_endpoint(self):
        with patch(
            "backend.routers.api.ollama_service.get_available_models",
            new_callable=AsyncMock,
            return_value=["llama3.2", "mistral"],
        ):
            res = client.get("/api/models")
            assert res.status_code == 200
            assert "models" in res.json()


# ── Suite 5: File Service ─────────────────────────────────────────────────────
class TestFileService:
    """Test file extraction helpers without actual file I/O."""

    def test_csv_extraction(self):
        from backend.services.file_service import _extract_csv
        csv_bytes = b"Field,Value\nCompany,HDFC Bank\nIndustry,Banking"
        result = _extract_csv(csv_bytes, "test.csv")
        assert "HDFC Bank" in result
        assert "Banking" in result

    def test_json_extraction(self):
        from backend.services.file_service import _extract_json
        json_bytes = json.dumps({"company": "Zomato", "industry": "Food Tech"}).encode()
        result = _extract_json(json_bytes, "test.json")
        assert "Zomato" in result
        assert "Food Tech" in result

    def test_text_extraction(self):
        from backend.services.file_service import _extract_text
        txt_bytes = b"This is a business context document about Infosys."
        result = _extract_text(txt_bytes, "test.txt")
        assert "Infosys" in result

    def test_invalid_json_falls_back_to_text(self):
        from backend.services.file_service import _extract_json
        result = _extract_json(b"not valid json content", "bad.json")
        assert "not valid json content" in result

    def test_text_truncated_at_max_chars(self):
        from backend.services.file_service import _extract_text, MAX_CHARS
        long_text = b"x" * (MAX_CHARS + 1000)
        result = _extract_text(long_text, "long.txt")
        assert "truncated" in result

    def test_unsupported_file_type_raises(self):
        import asyncio
        from fastapi import UploadFile
        from backend.services.file_service import extract_text
        from fastapi import HTTPException

        mock_file = MagicMock(spec=UploadFile)
        mock_file.filename = "file.xyz"
        mock_file.read = AsyncMock(return_value=b"data")

        with pytest.raises(HTTPException) as exc_info:
            asyncio.get_event_loop().run_until_complete(extract_text(mock_file))
        assert exc_info.value.status_code == 415
