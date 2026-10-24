"""Request/response DTOs for the /api/v1 endpoints."""

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


class AlgorithmInfo(BaseModel):
    id: str
    name: str
    complexity: str
    explanation: str


class AlgorithmRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    algorithm: str = Field(min_length=1, max_length=64)
    # No schema max_length here on purpose: an oversized input must reach the
    # route and be rejected with the specific 400 INPUT_TOO_LARGE code (not a
    # generic 422). The route + engine re-check the bound (defense in depth).
    input: str = Field(min_length=1)


class AlgorithmRunResult(BaseModel):
    algorithm_id: str = Field(serialization_alias="algorithmId")
    output: str
    execution_ms: float = Field(serialization_alias="executionMs")
    complexity: str
    explanation: str
