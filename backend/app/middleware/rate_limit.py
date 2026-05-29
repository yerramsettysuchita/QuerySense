import os
import uuid as _uuid
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from fastapi import Request
from fastapi.responses import JSONResponse

# In test environment, give every request a unique key so rate limits never fire
_key_func = (lambda request: str(_uuid.uuid4())) if os.environ.get("ENVIRONMENT") == "test" else get_remote_address
limiter = Limiter(key_func=_key_func)


async def rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    return JSONResponse(
        status_code=429,
        content={"detail": f"Rate limit exceeded: {exc.detail}. Slow down."},
    )
