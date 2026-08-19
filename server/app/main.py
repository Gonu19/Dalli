import logging

from fastapi import FastAPI

from app.exceptions import register_exception_handlers
from app.routers.auth import router as auth_router
from app.routers.calendar import router as calendar_router
from app.routers.plans import router as plans_router
from app.routers.reports import router as reports_router
from app.routers.runs import router as runs_router
from app.routers.stats import router as stats_router
from app.routers.system import router as system_router
from app.routers.users import router as users_router


# Uvicorn configures its own loggers but leaves the root logger at WARNING.
# Dalli's structured LLM diagnostics include successful INFO events, so make
# the application log level explicit for every runtime entrypoint.
logging.basicConfig(level=logging.INFO)
logging.getLogger().setLevel(logging.INFO)


def create_app() -> FastAPI:
    application = FastAPI(
        title="Dalli API",
        description="Dalli running companion backend API",
        version="0.1.0",
    )
    register_exception_handlers(application)
    application.include_router(system_router)
    application.include_router(auth_router)
    application.include_router(users_router)
    application.include_router(runs_router)
    application.include_router(reports_router)
    application.include_router(plans_router)
    application.include_router(calendar_router)
    application.include_router(stats_router)

    return application


app = create_app()
