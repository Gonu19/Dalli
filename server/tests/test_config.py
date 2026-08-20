import pytest
from pydantic import ValidationError

from app.config import Settings, clear_settings_cache, get_settings


def test_settings_can_be_injected_without_operational_secrets(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://test:test@db:5432/test")
    monkeypatch.setenv("JWT_SECRET", "test-only-secret")
    monkeypatch.setenv("OPENAI_API_KEY", "")
    monkeypatch.setenv("LLM_ENABLED", "false")
    monkeypatch.setenv("LLM_TIMEOUT_SEC", "3")
    clear_settings_cache()

    try:
        settings = get_settings()

        assert isinstance(settings, Settings)
        assert settings.database_url.endswith("/test")
        assert settings.jwt_secret.get_secret_value() == "test-only-secret"
        assert settings.openai_api_key.get_secret_value() == ""
        assert settings.llm_enabled is False
        assert settings.openai_model == "gpt-4o-mini"
        assert settings.llm_timeout_sec == 3
    finally:
        clear_settings_cache()


def test_llm_timeout_cannot_exceed_twenty_seconds() -> None:
    with pytest.raises(ValidationError):
        Settings(
            database_url="postgresql+psycopg://test:test@db:5432/test",
            jwt_secret="test-only-secret",
            llm_timeout_sec=21,
        )
