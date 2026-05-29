from sqlalchemy import Column, String, Text
from app.db.base import Base, TimestampMixin
import uuid


class AgentDecision(Base, TimestampMixin):
    __tablename__ = "agent_decisions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    slow_query_id = Column(String, nullable=False, index=True)
    decision = Column(String(20), nullable=False)  # apply | escalate | monitor | skip
    reasoning = Column(Text, nullable=False)
    actions_taken = Column(Text, nullable=False)
    outcome = Column(Text, nullable=False)
