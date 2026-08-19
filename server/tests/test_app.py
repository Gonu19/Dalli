import logging
from collections.abc import Generator

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

import app.deps as deps_module
from app.deps import get_db


def test_application_imports() -> None:
    from app.main import app

    assert app.title == "Dalli API"


def test_application_logging_allows_info_diagnostics() -> None:
    assert logging.getLogger("app.services.llm").isEnabledFor(logging.INFO)


def test_health_is_public_and_returns_liveness(app: FastAPI) -> None:
    response = TestClient(app).get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_validation_error_uses_contract_shape(app: FastAPI) -> None:
    @app.get("/_test/validate")
    def validate(value: int) -> dict[str, int]:
        return {"value": value}

    response = TestClient(app).get("/_test/validate", params={"value": "invalid"})

    assert response.status_code == 422
    assert response.json() == {
        "detail": {
            "code": "VALIDATION_ERROR",
            "message": "요청 값이 올바르지 않습니다.",
        }
    }


def test_database_dependency_can_be_overridden(app: FastAPI) -> None:
    sentinel = object()

    def override_get_db() -> Generator[object, None, None]:
        yield sentinel

    @app.get("/_test/db")
    def database_dependency(db: object = Depends(get_db)) -> dict[str, bool]:
        return {"overridden": db is sentinel}

    app.dependency_overrides[get_db] = override_get_db
    response = TestClient(app).get("/_test/db")

    assert response.status_code == 200
    assert response.json() == {"overridden": True}


def test_database_dependency_closes_session(monkeypatch) -> None:
    class FakeSession:
        closed = False

        def close(self) -> None:
            self.closed = True

    session = FakeSession()
    monkeypatch.setattr(deps_module, "get_session_factory", lambda: lambda: session)

    dependency = deps_module.get_db()
    assert next(dependency) is session
    dependency.close()

    assert session.closed is True
