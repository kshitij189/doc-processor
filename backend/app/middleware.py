"""ASGI middleware shared by the FastAPI app."""

import logging

from fastapi.responses import JSONResponse

logger = logging.getLogger("docprocessor")


class CatchUnhandledErrors:
    """
    Turn unhandled exceptions into a normal JSON response.

    Starlette's built-in 500 handler sits *outside* the CORS middleware, so a
    crash produces a bare `Internal Server Error` with no
    `Access-Control-Allow-Origin` header — the browser then reports it as a CORS
    failure and the real error is invisible. Handling it here (inside CORS) keeps
    the CORS headers on error responses and logs the traceback.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        response_started = False

        async def send_wrapper(message):
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception as exc:
            logger.exception(
                "Unhandled error on %s %s", scope.get("method"), scope.get("path")
            )
            if response_started:
                # Headers are already on the wire; nothing we can do but bail.
                raise
            response = JSONResponse(
                status_code=500,
                content={
                    "detail": "Internal server error",
                    "error_type": type(exc).__name__,
                },
            )
            await response(scope, receive, send)
