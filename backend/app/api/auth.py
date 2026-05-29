from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel, EmailStr
from app.db.session import get_app_db
from app.core.security import hash_password, verify_password, create_access_token, generate_api_key
from app.core.deps import get_current_user
from app.middleware.rate_limit import limiter
from app.schemas.response import ok
import uuid
import re

router = APIRouter()


class SignupRequest(BaseModel):
    name: str
    email: EmailStr
    password: str
    workspace_name: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class APIKeyRequest(BaseModel):
    name: str


@router.post("/signup")
@limiter.limit("5/minute")
async def signup(req: SignupRequest, request: Request, db: Session = Depends(get_app_db)):
    if len(req.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")

    if db.execute(text("SELECT id FROM users WHERE email = :e"), {"e": req.email}).fetchone():
        raise HTTPException(409, "Email already registered")

    user_id = str(uuid.uuid4())
    workspace_id = str(uuid.uuid4())
    slug = re.sub(r"[^a-z0-9]", "-", req.workspace_name.lower())[:50]

    if db.execute(text("SELECT id FROM workspaces WHERE slug = :s"), {"s": slug}).fetchone():
        slug = f"{slug}-{user_id[:6]}"

    db.execute(text("""
        INSERT INTO users (id, email, name, password_hash, is_active, is_verified)
        VALUES (:id, :email, :name, :hash, true, true)
    """), {"id": user_id, "email": req.email, "name": req.name, "hash": hash_password(req.password)})

    db.execute(text("""
        INSERT INTO workspaces (id, name, slug, owner_id) VALUES (:id, :name, :slug, :owner)
    """), {"id": workspace_id, "name": req.workspace_name, "slug": slug, "owner": user_id})

    db.execute(text("""
        INSERT INTO workspace_members (id, workspace_id, user_id, role)
        VALUES (:id, :ws_id, :uid, 'owner')
    """), {"id": str(uuid.uuid4()), "ws_id": workspace_id, "uid": user_id})

    db.commit()

    token = create_access_token(user_id, workspace_id)
    return ok({
        "token": token,
        "user": {"id": user_id, "email": req.email, "name": req.name},
        "workspace": {"id": workspace_id, "name": req.workspace_name, "slug": slug},
    })


@router.post("/login")
@limiter.limit("10/minute")
async def login(req: LoginRequest, request: Request, db: Session = Depends(get_app_db)):
    user = db.execute(
        text("SELECT * FROM users WHERE email = :email AND is_active = true"),
        {"email": req.email},
    ).fetchone()

    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(401, "Invalid email or password")

    workspace = db.execute(text("""
        SELECT w.id, w.name, w.slug
        FROM workspaces w
        JOIN workspace_members wm ON w.id = wm.workspace_id
        WHERE wm.user_id = :uid
        ORDER BY w.created_at ASC
        LIMIT 1
    """), {"uid": user.id}).fetchone()

    if not workspace:
        raise HTTPException(404, "No workspace found for this user")

    token = create_access_token(user.id, workspace.id)
    return ok({
        "token": token,
        "user": {"id": user.id, "email": user.email, "name": user.name},
        "workspace": {"id": workspace.id, "name": workspace.name, "slug": workspace.slug},
    })


@router.get("/me")
def me(current_user: dict = Depends(get_current_user), db: Session = Depends(get_app_db)):
    workspace = db.execute(text("""
        SELECT w.id, w.name, w.slug,
               COUNT(DISTINCT dc.id) AS connection_count,
               COUNT(DISTINCT wm2.id) AS member_count
        FROM workspaces w
        LEFT JOIN db_connections dc ON w.id = dc.workspace_id AND dc.is_active = true
        LEFT JOIN workspace_members wm2 ON w.id = wm2.workspace_id
        WHERE w.id = :ws_id
        GROUP BY w.id, w.name, w.slug
    """), {"ws_id": current_user["workspace_id"]}).fetchone()

    return ok({
        "user": current_user,
        "workspace": dict(workspace._mapping) if workspace else None,
    })


@router.post("/api-keys")
def create_api_key(
    req: APIKeyRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_app_db),
):
    raw_key, key_hash, preview = generate_api_key()
    db.execute(text("""
        INSERT INTO api_keys (id, user_id, workspace_id, name, key_hash, key_preview, is_active)
        VALUES (:id, :uid, :ws_id, :name, :hash, :preview, true)
    """), {
        "id": str(uuid.uuid4()),
        "uid": current_user["id"],
        "ws_id": current_user["workspace_id"],
        "name": req.name,
        "hash": key_hash,
        "preview": preview,
    })
    db.commit()
    return {
        "key": raw_key,
        "preview": preview,
        "name": req.name,
        "warning": "Save this key now — it will never be shown again.",
    }


@router.get("/api-keys")
def list_api_keys(current_user: dict = Depends(get_current_user), db: Session = Depends(get_app_db)):
    rows = db.execute(text("""
        SELECT id, name, key_preview, last_used_at, created_at
        FROM api_keys
        WHERE user_id = :uid AND is_active = true
        ORDER BY created_at DESC
    """), {"uid": current_user["id"]}).fetchall()
    return [dict(r._mapping) for r in rows]


@router.delete("/api-keys/{key_id}")
def revoke_api_key(key_id: str, current_user: dict = Depends(get_current_user), db: Session = Depends(get_app_db)):
    db.execute(text("UPDATE api_keys SET is_active = false WHERE id = :id AND user_id = :uid"),
               {"id": key_id, "uid": current_user["id"]})
    db.commit()
    return {"revoked": key_id}
