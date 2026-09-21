"""The app factory. One place that decides what the process is.

    uvicorn api.main:app --app-dir backend --port 8000

Three things happen here and nowhere else: the container is built and torn
down around the server's lifetime, the controllers are mounted under ``/api``,
and every deliberate error is turned into ``application/problem+json``.

The container is built in the lifespan rather than at import, which is what
lets ``create_app`` be called by a test with a fake graph and an in-memory
database and no credentials at all. It also means ``/health`` answers during
the startup window, before there is a container — a load balancer polling a
process that is still waking should get "degraded", not a connection refused.

The retriever is warmed in the background. 5,611 vectors take a few seconds
and a readiness probe that waited for them would report the API broken while
it was merely getting ready.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api import __version__
from api.container import Container, ContainerHandle
from api.controllers import CONTROLLERS
from api.controllers.approvals import AuditController
from api.errors import problem, to_response
from api.middleware import RequestContextMiddleware
from api.principal import IDEMPOTENCY_HEADER, ROLE_HEADER
from sentinel.config.settings import Settings, get_settings

logger = logging.getLogger(__name__)

#: Mounted under this, so a controller's ``/cases`` is ``/api/cases``.
API_PREFIX = "/api"

#: Every controller, in mount order. Static paths before parameterised ones so
#: ``/api/benchmark/report`` can never be matched as somebody's ``{case_id}``.
ALL_CONTROLLERS = (*CONTROLLERS, AuditController)


def create_app(settings: Settings | None = None, *, container: Container | None = None) -> FastAPI:
    """Build the application.

    ``container`` is for tests: pass one already assembled from a fake graph
    and an in-memory store, and the lifespan will use it instead of building
    its own. Nothing else about the app changes, so the thing under test is
    the thing that ships.
    """
    resolved = settings or get_settings()
    handle = ContainerHandle()

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        owned = container is None
        built = container or await Container.build(resolved)
        handle.set(built)
        await built.db.create_all()
        recovered = await _recover_runs(built)
        if recovered:
            logger.warning("closed %d run(s) left in flight by a previous process", recovered)
        built.warm_in_background()
        logger.info(
            "sentinel api %s ready: %d alerts, %d controllers",
            __version__,
            len(built.alerts),
            len(ALL_CONTROLLERS),
        )
        try:
            yield
        finally:
            handle.clear()
            if owned:
                await built.aclose()

    app = FastAPI(
        title="Sentinel",
        version=__version__,
        summary="Agentic fraud investigation on TigerGraph.",
        description=__doc__,
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )

    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(resolved.cors_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        # Last-Event-ID is not a CORS-safelisted header, and without it here a
        # browser's reconnect drops its resume point and replays from zero.
        allow_headers=["Content-Type", ROLE_HEADER, IDEMPOTENCY_HEADER, "Last-Event-ID"],
        expose_headers=["X-Request-Id"],
    )

    for controller in ALL_CONTROLLERS:
        app.include_router(controller(handle).build(), prefix=API_PREFIX)

    _install_error_handlers(app)
    return app


def _install_error_handlers(app: FastAPI) -> None:
    """Every deliberate failure leaves as problem+json, with a request id."""
    from sentinel.domain.errors import SentinelError

    @app.exception_handler(SentinelError)
    async def _sentinel(request: Request, exc: Exception) -> JSONResponse:
        assert isinstance(exc, SentinelError)
        return to_response(exc, request)

    @app.exception_handler(RequestValidationError)
    async def _unprocessable(request: Request, exc: Exception) -> JSONResponse:
        assert isinstance(exc, RequestValidationError)
        return problem(
            code="unprocessable",
            title="The request body or query is not valid",
            status=422,
            detail="; ".join(
                f"{'.'.join(str(p) for p in err['loc'][1:])}: {err['msg']}" for err in exc.errors()
            )
            or "the request could not be parsed",
            request_id=getattr(request.state, "request_id", ""),
        )

    @app.exception_handler(Exception)
    async def _unexpected(request: Request, exc: Exception) -> JSONResponse:
        # An unexpected error is a bug, and the console should say so rather
        # than render a stack trace or an empty body. The trace goes to the log
        # with the request id, which is the thing that correlates them.
        request_id = getattr(request.state, "request_id", "")
        logger.exception("unhandled error on %s [%s]", request.url.path, request_id)
        return problem(
            code="internal_error",
            title="Something went wrong that should not have",
            status=500,
            detail=f"{type(exc).__name__}: {exc}",
            request_id=request_id,
        )


async def _recover_runs(container: Container) -> int:
    """Close runs a killed process left saying "running".

    Nothing else will: the task that would have finished them died with the
    process, and a queue showing a run that has not moved for an hour is worse
    than one showing it failed.
    """
    from api.controllers.investigations import InvestigationService

    return await InvestigationService(container).recover()


#: The ASGI application uvicorn imports.
app = create_app()
