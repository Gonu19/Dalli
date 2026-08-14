import pytest
from fastapi import FastAPI

from app.main import create_app


@pytest.fixture
def app() -> FastAPI:
    return create_app()


def pytest_configure(config) -> None:
    config.addinivalue_line("markers", "postgres: requires TEST_DATABASE_URL")
