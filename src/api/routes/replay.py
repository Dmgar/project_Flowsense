import logging
from typing import List, Dict, Any
from fastapi import APIRouter, Query, status
from src.services.replay_service import replay_service

logger = logging.getLogger("flowsense.api.replay")
router = APIRouter(prefix="/replay", tags=["Mission History & Replay"])

@router.get("/latest", response_model=List[Dict[str, Any]], status_code=status.HTTP_200_OK)
async def get_latest_replay_session(
    frames: int = Query(default=30, ge=5, le=120, description="Number of replay timeline frames")
):
    """
    Returns recorded mission frames for the Leaflet timeline scrubber.
    """
    return replay_service.get_latest_session(frames=frames)
