import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

_CITY_PROFILE = os.getenv("FLOWSENSE_CITY", "manhattan").strip().lower()
_CARTAGENA = _CITY_PROFILE == "cartagena"

class Settings(BaseSettings):
    PROJECT_NAME: str = "FlowSense - Priority Routing & Perception"
    VERSION: str = "0.1.0"
    API_V1_STR: str = "/api/v1"
    
    # City profiles keep graph caches and incident ledgers isolated.
    CITY_PROFILE: str = "cartagena" if _CARTAGENA else "manhattan"
    PILOT_CITY: str = "Cartagena de Indias, Colombia" if _CARTAGENA else "New York (Manhattan)"
    # Cover Manhattan from the southern tip through Inwood so nearby routes
    # do not silently snap to the edge of a small midtown-only graph.
    PILOT_BBOX_NORTH: float = 10.50 if _CARTAGENA else 40.8800
    PILOT_BBOX_SOUTH: float = 10.31 if _CARTAGENA else 40.7000
    PILOT_BBOX_EAST: float = -75.42 if _CARTAGENA else -73.9000
    PILOT_BBOX_WEST: float = -75.62 if _CARTAGENA else -74.0200
    MAP_CENTER_LATITUDE: float = 10.3910 if _CARTAGENA else 40.7484
    MAP_CENTER_LONGITUDE: float = -75.4794 if _CARTAGENA else -73.9857
    MAP_DEFAULT_ZOOM: int = 12 if _CARTAGENA else 13
    
    # Dynamic Routing Parameters
    # Formula: W_e = Length * (1 + alpha * CongestionFactor) * RoadClassFactor
    CONGESTION_ALPHA: float = 3.0
    DEFAULT_SPEED_KMH: float = 45.0
    
    # Cache and directories
    DATA_PROCESSED_DIR: Path = Path("data/processed")
    GRAPH_CACHE_FILE: Path = Path("data/processed/cartagena_graph.graphml" if _CARTAGENA else "data/processed/manhattan_graph.graphml")
    FLOOD_REPORT_TTL_MINUTES: int = 45
    AMBULANCE_MAX_WATER_DEPTH_CM: float = 0.0
    FIRE_TRUCK_MAX_WATER_DEPTH_CM: float = 0.0

    # ---- Perception Engine (OpenCV 5) ----
    PERCEPTION_MODEL_PATH: Path = Path("models/yolov8n.onnx")
    PERCEPTION_CONFIDENCE: float = 0.45
    PERCEPTION_NMS_THRESHOLD: float = 0.5
    PERCEPTION_SKIP_FRAMES: int = 3
    PERCEPTION_BACKEND: str = "opencv_dnn"  # "opencv_dnn" | "onnxruntime"
    PERCEPTION_PIXELS_PER_METER: float = 12.0

    # ---- Routing Optimization ----
    ROUTING_ALGORITHM: str = "astar"  # "dijkstra" | "astar"
    MAX_ALTERNATIVE_ROUTES: int = 3
    NSGA2_POPULATION_SIZE: int = 50
    NSGA2_GENERATIONS: int = 100

    # CORS
    ALLOWED_ORIGINS: list[str] = ["*"]

    model_config = SettingsConfigDict(case_sensitive=True)

settings = Settings()
