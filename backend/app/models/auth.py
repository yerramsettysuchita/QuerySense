from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.db.base import Base, TimestampMixin
import uuid


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email = Column(String(255), unique=True, nullable=False, index=True)
    name = Column(String(255), nullable=False)
    password_hash = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)
    is_verified = Column(Boolean, default=False)

    workspaces = relationship("WorkspaceMember", back_populates="user")
    api_keys = relationship("APIKey", back_populates="user")


class Workspace(Base, TimestampMixin):
    __tablename__ = "workspaces"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    slug = Column(String(100), unique=True, nullable=False, index=True)
    owner_id = Column(String(36), ForeignKey("users.id"), nullable=False)

    members = relationship("WorkspaceMember", back_populates="workspace")
    connections = relationship("DBConnection", back_populates="workspace")


class WorkspaceMember(Base, TimestampMixin):
    __tablename__ = "workspace_members"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    workspace_id = Column(String(36), ForeignKey("workspaces.id"), nullable=False)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    role = Column(String(20), nullable=False, default="member")  # owner | admin | member

    workspace = relationship("Workspace", back_populates="members")
    user = relationship("User", back_populates="workspaces")


class APIKey(Base, TimestampMixin):
    __tablename__ = "api_keys"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    workspace_id = Column(String(36), ForeignKey("workspaces.id"), nullable=False)
    name = Column(String(100), nullable=False)
    key_hash = Column(String(255), nullable=False, unique=True)
    key_preview = Column(String(30), nullable=False)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    is_active = Column(Boolean, default=True)

    user = relationship("User", back_populates="api_keys")


class DBConnection(Base, TimestampMixin):
    __tablename__ = "db_connections"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    workspace_id = Column(String(36), ForeignKey("workspaces.id"), nullable=False)
    name = Column(String(100), nullable=False)
    db_type = Column(String(20), nullable=False)  # postgresql | mysql
    connection_url_encrypted = Column(String(1000), nullable=False)
    host = Column(String(255), nullable=False)
    port = Column(String(10), nullable=False)
    database = Column(String(100), nullable=False)
    username = Column(String(100), nullable=False)
    is_active = Column(Boolean, default=True)
    last_checked_at = Column(DateTime(timezone=True), nullable=True)
    pg_stat_statements_enabled = Column(Boolean, default=False)
    status = Column(String(20), default="unchecked")  # ok | error | unchecked

    workspace = relationship("Workspace", back_populates="connections")
