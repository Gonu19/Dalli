from typing import Any

from pydantic import BaseModel


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    detail: ErrorDetail


def error_response(description: str) -> dict[str, Any]:
    return {"model": ErrorResponse, "description": description}
