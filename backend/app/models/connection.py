from sqlalchemy import Column, Integer, String, Boolean, DateTime
from app.db.base import Base, TimestampMixin
import uuid


class DatabaseConnection(Base, TimestampMixin):
    __tablename__ = "database_connections"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(100), nullable=False)
    db_type = Column(String(20), nullable=False)  # postgresql | mysql
    host = Column(String(255), nullable=False)
    port = Column(Integer, nullable=False)
    database = Column(String(100), nullable=False)
    username = Column(String(100), nullable=False)
    password_encrypted = Column(String(500), nullable=False)
    is_active = Column(Boolean, default=True)
    last_polled_at = Column(DateTime(timezone=True), nullable=True)
