from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import QueuePool
from app.core.config import settings
from typing import Generator

_POOL_CONFIG = dict(
    poolclass=QueuePool,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_pre_ping=True,
    pool_recycle=settings.DB_POOL_RECYCLE,
    echo=False,
)

app_engine = create_engine(settings.APP_DB_URL, **_POOL_CONFIG)
main_engine = create_engine(settings.MAIN_DB_URL, **_POOL_CONFIG)
shadow_engine = create_engine(settings.SHADOW_DB_URL, **_POOL_CONFIG)

AppSessionLocal = sessionmaker(bind=app_engine, autocommit=False, autoflush=False)
MainSessionLocal = sessionmaker(bind=main_engine, autocommit=False, autoflush=False)
ShadowSessionLocal = sessionmaker(bind=shadow_engine, autocommit=False, autoflush=False)


def get_app_db() -> Generator[Session, None, None]:
    db = AppSessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def get_main_db() -> Generator[Session, None, None]:
    db = MainSessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def get_shadow_db() -> Generator[Session, None, None]:
    db = ShadowSessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
