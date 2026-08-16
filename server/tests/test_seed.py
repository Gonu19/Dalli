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


def test_cli_rejects_missing_environment_before_loading_database(
    monkeypatch,
    tmp_path,
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)

    def fail_if_settings_are_loaded():
        pytest.fail("환경 검증 실패 전에 DB 설정을 로드했습니다.")

    monkeypatch.setattr("app.seed.get_settings", fail_if_settings_are_loaded)

    stderr = StringIO()
    with redirect_stderr(stderr):
        result = main()
    assert result == 1
    assert "APP_ENV=development" in stderr.getvalue()
