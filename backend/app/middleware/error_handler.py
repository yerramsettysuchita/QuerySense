from fastapi import Request
from fastapi.responses import JSONResponse
from app.core.logging import logger
import traceback


async def global_error_handler(request: Request, exc: Exception) -> JSONResponse:
    tb = traceback.format_exc()
    logger.error(
        "Unhandled exception",
        path=str(request.url.path),
        method=request.method,
        error=str(exc),
        traceback=tb,
    )
    origin = request.headers.get("origin", "")
    response = JSONResponse(
        status_code=500,
        content={
            "detail": "Internal server error",
            "path": str(request.url.path),
        },
    )
    if origin:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
    return response


async def not_found_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=404,
        content={"detail": f"Route {request.url.path} not found"},
    )
