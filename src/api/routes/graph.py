import logging
from fastapi import APIRouter
from src.models.schemas import GraphStatus
from src.services.graph_service import graph_service

logger = logging.getLogger("flowsense.api.graph")
router = APIRouter(prefix="/graph", tags=["Urban Graph Status & GIS"])

@router.get("/status", response_model=GraphStatus)
async def get_graph_status():
    """Returns urban road network status, edge counts, and current congestion distribution."""
    return graph_service.get_status()

@router.get("/geojson")
async def get_graph_geojson():
    """
    Returns the road network as a GeoJSON FeatureCollection with live congestion styling.
    Ideal for direct visualization in Leaflet.js dashboard.
    """
    return graph_service.to_geojson()

@router.post("/reset")
async def reset_graph_congestion():
    """Resets all congestion factors in the network to free flow (0.0)."""
    count = graph_service.reset_all_congestion()
    return {"status": "success", "message": f"All network congestion reset to 0.0 ({count} segments)."}
