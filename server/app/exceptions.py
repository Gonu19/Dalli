from collections.abc import Mapping

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ApplicationError(Exception):
    def __init__(
        self,
        *,
        code: str,
        message: str,
        status_code: int,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        self.code = code
        self.message = message
        self.status_code = status_code
        self.headers = headers
        super().__init__(message)


def _error_body(code: str, message: str) -> dict[str, dict[str, str]]:
    return {"detail": {"code": code, "message": message}}


async def application_error_handler(
    request: Request, exc: ApplicationError
) -> JSONResponse:
    del request
    return JSONResponse(
        status_code=exc.status_code,
        content=_error_body(exc.code, exc.message),
        headers=exc.headers,
    )


async def validation_error_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    del request, exc
    return JSONResponse(
        status_code=422,
        content=_error_body("VALIDATION_ERROR", "요청 값이 올바르지 않습니다."),
    )


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApplicationError, application_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_error_handler)  # type: ignore[arg-type]
