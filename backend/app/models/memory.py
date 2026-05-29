from sqlalchemy import Column, String, Text, Float, Integer, JSON
from app.db.base import Base, TimestampMixin
import uuid


class AgentMemory(Base, TimestampMixin):
    __tablename__ = "agent_memory"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    query_fingerprint = Column(String(16), nullable=False, index=True, unique=True)
    shape_hash = Column(String(16), nullable=False, index=True)
    query_text = Column(Text, nullable=False)
    issue_type = Column(String(50))
    fix_applied = Column(Text)
    before_ms = Column(Float)
    after_ms = Column(Float)
    improvement_pct = Column(Float)
    outcome = Column(String(20))
    times_recalled = Column(Integer, default=0)


class WeeklyReport(Base, TimestampMixin):
    __tablename__ = "weekly_reports"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    week_start = Column(String(10), nullable=False)
    week_end = Column(String(10), nullable=False)
    total_queries_analyzed = Column(Integer, default=0)
    total_fixes_applied = Column(Integer, default=0)
    total_ms_saved = Column(Float, default=0.0)
    top_issues = Column(JSON, default=list)
    narrative = Column(Text)
    slack_posted = Column(Integer, default=0)
