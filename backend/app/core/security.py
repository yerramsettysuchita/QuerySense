import hashlib
import secrets
import base64
import bcrypt
from datetime import datetime, timedelta
from jose import jwt, JWTError
from app.core.config import settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def create_access_token(user_id: str, workspace_id: str, expires_hours: int = 24) -> str:
    payload = {
        "sub": user_id,
        "workspace_id": workspace_id,
        "exp": datetime.utcnow() + timedelta(hours=expires_hours),
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
    except JWTError:
        return {}


def generate_api_key() -> tuple[str, str, str]:
    """Returns (raw_key, key_hash, key_preview)."""
    raw = f"qs_live_{secrets.token_urlsafe(32)}"
    key_hash = hashlib.sha256(raw.encode()).hexdigest()
    preview = f"{raw[:12]}...{raw[-4:]}"
    return raw, key_hash, preview


def hash_api_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode()).hexdigest()


def _get_fernet():
    from cryptography.fernet import Fernet
    key = hashlib.pbkdf2_hmac(
        "sha256",
        settings.SECRET_KEY.encode(),
        b"querysense-salt-v1",
        iterations=100000,
        dklen=32,
    )
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt_connection_url(url: str) -> str:
    return _get_fernet().encrypt(url.encode()).decode()


def decrypt_connection_url(encrypted: str) -> str:
    return _get_fernet().decrypt(encrypted.encode()).decode()
