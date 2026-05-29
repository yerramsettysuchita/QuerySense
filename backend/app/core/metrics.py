from prometheus_fastapi_instrumentator import Instrumentator
from prometheus_client import Counter, Histogram, Gauge

slow_queries_detected = Counter(
    "querysense_slow_queries_detected_total",
    "Total slow queries detected by the monitoring agent",
    ["db_type"],
)

anomalies_detected = Counter(
    "querysense_anomalies_detected_total",
    "Total query anomalies detected",
)

agent_runs = Counter(
    "querysense_agent_runs_total",
    "Total autonomous agent runs",
    ["decision"],
)

benchmark_duration = Histogram(
    "querysense_benchmark_duration_ms",
    "Shadow DB benchmark execution time in ms",
    buckets=[10, 50, 100, 500, 1000, 5000, 10000],
)

benchmark_improvement = Histogram(
    "querysense_benchmark_improvement_pct",
    "Percentage improvement from benchmarked optimizations",
    buckets=[0, 10, 25, 50, 75, 90, 95, 99, 100],
)

active_slow_queries = Gauge(
    "querysense_active_slow_queries",
    "Current number of unresolved slow queries",
)

openrouter_calls = Counter(
    "querysense_openrouter_calls_total",
    "Total OpenRouter API calls",
    ["model", "status"],
)


def setup_metrics(app):
    instrumentator = Instrumentator(
        should_group_status_codes=True,
        should_ignore_untemplated=True,
        should_respect_env_var=True,
        should_instrument_requests_inprogress=True,
        excluded_handlers=["/health", "/metrics"],
        inprogress_name="querysense_requests_inprogress",
        inprogress_labels=True,
    )
    instrumentator.instrument(app).expose(app, endpoint="/metrics")
    return instrumentator
