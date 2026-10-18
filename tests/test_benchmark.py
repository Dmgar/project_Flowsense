import pytest
from fastapi.testclient import TestClient
from src.services.benchmark_service import benchmark_service

def test_benchmark_service_execution():
    summary = benchmark_service.run_benchmark(num_samples=6)
    assert summary.num_trips_evaluated > 0
    assert summary.success_rate_pct >= 0.0
    assert len(summary.metrics) == 5

    metric_names = [m.metric for m in summary.metrics]
    assert "Average time (s)" in metric_names
    assert "Distance (m)" in metric_names
    assert "Blocked intersections" in metric_names
    assert "Success rate (%)" in metric_names
    assert "Seconds saved" in metric_names

def test_benchmark_summary_endpoint(client: TestClient):
    response = client.get("/api/v1/benchmark/summary")
    assert response.status_code == 200
    data = response.json()
    assert "metrics" in data
    assert "average_time_savings_pct" in data
    assert len(data["metrics"]) == 5

def test_benchmark_run_endpoint(client: TestClient):
    response = client.post("/api/v1/benchmark/run?num_samples=5&congestion_intensity=0.7")
    assert response.status_code == 200
    data = response.json()
    assert data["num_trips_evaluated"] >= 3
    assert len(data["metrics"]) == 5
