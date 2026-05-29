from pydantic_settings import BaseSettings
from pydantic import field_validator
from functools import lru_cache
from typing import Optional


class Settings(BaseSettings):
    ENVIRONMENT: str = "development"

    @field_validator("ENVIRONMENT")
    @classmethod
    def validate_environment(cls, v: str) -> str:
        allowed = {"development", "test", "staging", "production"}
        if v not in allowed:
            raise ValueError(f"ENVIRONMENT must be one of {allowed}, got '{v}'")
        return v
    DEBUG: bool = True
    SECRET_KEY: str = "dev-secret-key"
    API_VERSION: str = "v1"

    MAIN_DB_URL: str = "postgresql://postgres:postgres@localhost:5432/querysense_main"
    SHADOW_DB_URL: str = "postgresql://postgres:postgres@localhost:5433/querysense_shadow"
    APP_DB_URL: str = "postgresql://postgres:postgres@localhost:5434/querysense_app"
    MYSQL_URL: Optional[str] = None
    REDIS_URL: str = "redis://localhost:6379"

    # OpenRouter (Claude via OpenRouter)
    OPENROUTER_API_KEY: str = ""

    # OpenAI (GPT-4o Vision)
    OPENAI_API_KEY: str = ""

    APP_BASE_URL: str = "http://localhost:3000"
    # Comma-separated list of allowed CORS origins (e.g. https://myapp.onrender.com)
    CORS_ORIGINS: str = "*"

    DB_POOL_SIZE: int = 5
    DB_MAX_OVERFLOW: int = 10
    DB_POOL_RECYCLE: int = 3600

    SENTRY_DSN: str = ""

    SLACK_WEBHOOK_URL: str = ""
    SLACK_ALERTS_ENABLED: bool = False
    SLACK_SIGNING_SECRET: str = ""
    SLACK_BOT_TOKEN: str = ""

    SLOW_QUERY_THRESHOLD_MS: int = 500
    POLL_INTERVAL_SECONDS: int = 30
    ANOMALY_STDDEV_MULTIPLIER: float = 2.0
    QUERY_HISTORY_WINDOW: int = 50

    SHADOW_SAMPLE_ROWS: int = 10000
    BENCHMARK_ITERATIONS: int = 100

    class Config:
        env_file = ".env"
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
