from fastapi import FastAPI

from app.exceptions import register_exception_handlers
from app.routers.auth import router as auth_router
from app.routers.system import router as system_router
from app.routers.users import router as users_router


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

    return application


app = create_app()
