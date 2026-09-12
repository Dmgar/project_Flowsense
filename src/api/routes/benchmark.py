import logging
from fastapi import APIRouter, Query, status
from src.models.schemas import BenchmarkSummaryResponse
from src.services.benchmark_service import benchmark_service

logger = logging.getLogger("flowsense.api.benchmark")
router = APIRouter(prefix="/benchmark", tags=["Benchmarking & Performance Evaluation"])

@router.get("/summary", response_model=BenchmarkSummaryResponse, status_code=status.HTTP_200_OK)
async def get_benchmark_summary():
    """
    Retrieves the response-time benchmark comparing FlowSense dynamic routing
    against static baseline routing across Manhattan corridors.
    """
    return benchmark_service.get_summary()

@router.post("/run", response_model=BenchmarkSummaryResponse, status_code=status.HTTP_200_OK)
async def run_benchmark_evaluation(
    num_samples: int = Query(default=15, ge=5, le=100, description="Number of random emergency trips to evaluate"),
    congestion_intensity: float = Query(default=0.8, ge=0.1, le=1.0, description="Peak congestion intensity factor")
):
    """
    Triggers a fresh Monte Carlo simulation batch across the urban street graph
    and computes real response time savings.
    """
    logger.info(f"Running benchmark simulation with {num_samples} sample trips...")
    return benchmark_service.run_benchmark(num_samples=num_samples, congestion_intensity=congestion_intensity)
