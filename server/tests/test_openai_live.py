import os
import time

import pytest

from app.config import Settings
from app.services.llm import generate_llm_report
from tests.test_llm import context


@pytest.mark.openai_live
def test_one_explicit_live_openai_structured_report() -> None:
    if os.getenv("RUN_OPENAI_LIVE_TEST") != "1":
        pytest.skip("set RUN_OPENAI_LIVE_TEST=1 to allow one paid external request")
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        pytest.skip("OPENAI_API_KEY is not configured")

    current_run, quality, metrics, fallback = context()
    settings = Settings(
        database_url="postgresql+psycopg://test:test@localhost:5432/dalli_test",
        jwt_secret="live-test-only-jwt-secret-with-sufficient-length",
        openai_api_key=api_key,
        llm_enabled=True,
        openai_model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        llm_timeout_sec=8,
    )
    started = time.monotonic()

    content = generate_llm_report(current_run, quality, metrics, fallback, settings)

    assert time.monotonic() - started <= 8.5
    assert content is not None
    assert content.next_target_min == fallback.next_target_min
    assert content.next_target_max == fallback.next_target_max
    assert content.limitation == fallback.limitation
