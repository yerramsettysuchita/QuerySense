from datetime import datetime, timezone
from typing import Any, Optional
from fastapi import HTTPException


def ok(data: Any) -> dict:
    return {
        "success": True,
        "data": data,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def err(message: str, status_code: int = 400):
    raise HTTPException(status_code=status_code, detail={
        "success": False,
        "error": message,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
