from fastapi import Depends, HTTPException, Header
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional
from app.db.session import get_app_db
from app.core.security import decode_token, hash_api_key
from app.core.logging import logger


def get_current_user(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_app_db),
) -> dict:
    """
    Supports both JWT Bearer tokens and API keys (qs_live_...).
    Returns user dict with id, email, name, workspace_id.
    """
    if not authorization:
        raise HTTPException(401, "Authorization header required")

    if authorization.startswith("qs_live_"):
        return _auth_api_key(authorization, db)

    token = authorization.removeprefix("Bearer ").strip()
    payload = decode_token(token)
    if not payload:
        raise HTTPException(401, "Invalid or expired token")

    user = db.execute(text("""
        SELECT u.id, u.email, u.name, u.is_active, :workspace_id AS workspace_id
        FROM users u
        WHERE u.id = :user_id AND u.is_active = true
    """), {"user_id": payload["sub"], "workspace_id": payload.get("workspace_id")}).fetchone()

    if not user:
        raise HTTPException(401, "User not found or inactive")

    return dict(user._mapping)


def _auth_api_key(raw_key: str, db: Session) -> dict:
    key_hash = hash_api_key(raw_key)
    row = db.execute(text("""
        SELECT ak.user_id, ak.workspace_id, u.email, u.name
        FROM api_keys ak
        JOIN users u ON ak.user_id = u.id
        WHERE ak.key_hash = :hash AND ak.is_active = true AND u.is_active = true
    """), {"hash": key_hash}).fetchone()

    if not row:
        raise HTTPException(401, "Invalid API key")

    db.execute(text("UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE key_hash = :hash"), {"hash": key_hash})
    db.commit()

    return {
        "id": row.user_id,
        "email": row.email,
        "name": row.name,
        "workspace_id": row.workspace_id,
    }


def require_workspace_member(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_app_db),
) -> dict:
    member = db.execute(text("""
        SELECT role FROM workspace_members
        WHERE user_id = :uid AND workspace_id = :wid
    """), {"uid": current_user["id"], "wid": current_user["workspace_id"]}).fetchone()

    if not member:
        raise HTTPException(403, "Not a member of this workspace")

    return {**current_user, "role": member.role}
