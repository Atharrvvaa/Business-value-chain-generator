# backend/models/schemas.py
from pydantic import BaseModel, Field
from typing import Optional


class GenerateRequest(BaseModel):
    company_name: str = Field(..., min_length=1, description="Name of the company")
    industry: str = Field(..., min_length=1, description="Industry sector")
    description: Optional[str] = Field(None, description="Optional business context")
    repo_url: Optional[str] = Field(None, description="Optional knowledge repository URL")
    file_content: Optional[str] = Field(None, description="Pre-extracted text from uploaded files")


class Capability(BaseModel):
    id: str
    name: str
    description: str


class ValueChainComponent(BaseModel):
    id: str
    name: str
    description: str
    capabilities: list[Capability]


class ContextSummary(BaseModel):
    valueProposition: str
    businessModel: str
    differentiation: str
    keyInsights: list[str]


class ValueChainResponse(BaseModel):
    context: ContextSummary
    primaryActivities: list[ValueChainComponent]
    supportFunctions: list[ValueChainComponent]


class HealthResponse(BaseModel):
    status: str
    ollama_connected: bool
    ollama_url: str
    model: str
    available_models: list[str]


class ErrorResponse(BaseModel):
    detail: str
