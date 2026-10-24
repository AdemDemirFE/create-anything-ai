"""Request/response DTOs for the /api/v1 endpoints (Stack 23)."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr = Field(max_length=254)
    password: str = Field(min_length=10, max_length=128)


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr = Field(max_length=254)
    password: str = Field(min_length=1, max_length=128)


class UserOut(BaseModel):
    email: str


class HomeMetrics(BaseModel):
    label: str
    value: str
    unit: str


class HomeData(BaseModel):
    email: str
    metrics: list[HomeMetrics]
    server_time: str = Field(serialization_alias="serverTime")


class DocumentOut(BaseModel):
    document_id: str = Field(serialization_alias="documentId")
    filename: str
    size_bytes: int = Field(serialization_alias="sizeBytes")
    chunk_count: int = Field(serialization_alias="chunkCount")
    created_at: str = Field(serialization_alias="createdAt")


class ChatSource(BaseModel):
    document_id: str = Field(serialization_alias="documentId")
    filename: str
    chunk_index: int = Field(serialization_alias="chunkIndex")
    score: float
    snippet: str


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Upper bound enforced by schema (422 for abuse) and again in the route
    # with the specific QUERY_TOO_LARGE code; min length guards empty asks.
    question: str = Field(min_length=1, max_length=4000)


class ChatAnswer(BaseModel):
    question: str
    answer: str
    sources: list[ChatSource]
    execution_ms: float = Field(serialization_alias="executionMs")
