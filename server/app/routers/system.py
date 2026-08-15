from fastapi import APIRouter

from app.schemas.system import HealthResponse

router = APIRouter(tags=["system"])


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Return API process liveness without touching external services."""
    return HealthResponse(status="ok")
