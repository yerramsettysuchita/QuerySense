from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Text, ForeignKey, func
from sqlalchemy.orm import relationship
from app.db.base import Base, TimestampMixin
import uuid


class SlowQuery(Base, TimestampMixin):
    __tablename__ = "slow_queries"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    connection_id = Column(String, ForeignKey("db_connections.id"), nullable=True)
    query_fingerprint = Column(String(64), nullable=False, index=True)
    query_text = Column(Text, nullable=False)
    avg_exec_time_ms = Column(Float, nullable=False)
    max_exec_time_ms = Column(Float, nullable=False)
    calls = Column(Integer, default=1)
    db_type = Column(String(20), nullable=False, default="postgresql")
    is_anomaly = Column(Boolean, default=False)
    is_resolved = Column(Boolean, default=False)
    detected_at = Column(DateTime(timezone=True), server_default=func.now())

    history = relationship("QueryHistory", back_populates="slow_query", cascade="all, delete-orphan")
    recommendations = relationship("QueryRecommendation", back_populates="slow_query", cascade="all, delete-orphan")


class QueryHistory(Base):
    __tablename__ = "query_history"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    slow_query_id = Column(String, ForeignKey("slow_queries.id"), nullable=False)
    exec_time_ms = Column(Float, nullable=False)
    recorded_at = Column(DateTime(timezone=True), server_default=func.now())

    slow_query = relationship("SlowQuery", back_populates="history")


class QueryRecommendation(Base, TimestampMixin):
    __tablename__ = "query_recommendations"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    slow_query_id = Column(String, ForeignKey("slow_queries.id"), nullable=False)
    rec_type = Column(String(30), nullable=False)  # index | rewrite | materialized_view
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    sql_fix = Column(Text, nullable=False)
    estimated_improvement_pct = Column(Float, nullable=False)
    risk_level = Column(String(10), nullable=False)  # low | medium | high
    confidence = Column(Float, nullable=False)
    ai_explanation = Column(Text, nullable=True)
    is_applied = Column(Boolean, default=False)
    applied_at = Column(DateTime(timezone=True), nullable=True)

    slow_query = relationship("SlowQuery", back_populates="recommendations")
    benchmark = relationship("BenchmarkResult", back_populates="recommendation", uselist=False)


class BenchmarkResult(Base):
    __tablename__ = "benchmark_results"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    recommendation_id = Column(String, ForeignKey("query_recommendations.id"), nullable=False)
    before_ms = Column(Float, nullable=False)
    after_ms = Column(Float, nullable=False)
    improvement_pct = Column(Float, nullable=False)
    iterations = Column(Integer, nullable=False)
    tested_at = Column(DateTime(timezone=True), server_default=func.now())

    recommendation = relationship("QueryRecommendation", back_populates="benchmark")
