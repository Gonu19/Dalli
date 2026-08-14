from fastapi import APIRouter

router = APIRouter(tags=["system"])


@router.get("/health")
async def health() -> dict[str, str]:
    """Return API process liveness without touching external services."""
    return {"status": "ok"}
