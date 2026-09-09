from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    PROJECT_NAME: str = "FlowSense - Priority Routing & Perception"
    VERSION: str = "0.1.0"
    API_V1_STR: str = "/api/v1"
    
    # Pilot City Configuration (New York - Manhattan)
    PILOT_CITY: str = "New York (Manhattan)"
    PILOT_BBOX_NORTH: float = 40.7700
    PILOT_BBOX_SOUTH: float = 40.7300
    PILOT_BBOX_EAST: float = -73.9700
    PILOT_BBOX_WEST: float = -74.0100
    
    # Dynamic Routing Parameters
    # Formula: W_e = Length * (1 + alpha * CongestionFactor) * RoadClassFactor
    CONGESTION_ALPHA: float = 3.0
    DEFAULT_SPEED_KMH: float = 45.0
    
    # Cache and directories
    DATA_PROCESSED_DIR: Path = Path("data/processed")
    GRAPH_CACHE_FILE: Path = Path("data/processed/manhattan_graph.graphml")
    
    # CORS
    ALLOWED_ORIGINS: list[str] = ["*"]

    model_config = SettingsConfigDict(case_sensitive=True)

settings = Settings()
