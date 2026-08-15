from contextlib import redirect_stderr
from io import StringIO

import pytest

from app.seed import SeedError, main, validate_seed_environment


@pytest.mark.parametrize("value", [None, "", "production", "staging", "local"])
def test_seed_rejects_unknown_and_non_development_environments(value: str | None) -> None:
    with pytest.raises(SeedError):
        validate_seed_environment(value)


@pytest.mark.parametrize("value", ["development", "DEVELOPMENT", " test "])
def test_seed_accepts_only_development_and_test(value: str) -> None:
    assert validate_seed_environment(value) in {"development", "test"}


def test_cli_rejects_missing_environment_before_loading_database(monkeypatch) -> None:
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    stderr = StringIO()
    with redirect_stderr(stderr):
        result = main()
    assert result == 1
    assert "APP_ENV=development" in stderr.getvalue()
