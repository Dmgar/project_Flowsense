from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    PROJECT_NAME: str = "FlowSense - Priority Routing & Perception"
    VERSION: str = "0.1.0"
    API_V1_STR: str = "/api/v1"
    
    # Pilot City Configuration (New York - Manhattan)
    PILOT_CITY: str = "New York (Manhattan)"
    # Cover Manhattan from the southern tip through Inwood so nearby routes
    # do not silently snap to the edge of a small midtown-only graph.
    PILOT_BBOX_NORTH: float = 40.8800
    PILOT_BBOX_SOUTH: float = 40.7000
    PILOT_BBOX_EAST: float = -73.9000
    PILOT_BBOX_WEST: float = -74.0200
    
    # Dynamic Routing Parameters
    # Formula: W_e = Length * (1 + alpha * CongestionFactor) * RoadClassFactor
    CONGESTION_ALPHA: float = 3.0
    DEFAULT_SPEED_KMH: float = 45.0
    
    # Cache and directories
    DATA_PROCESSED_DIR: Path = Path("data/processed")
    GRAPH_CACHE_FILE: Path = Path("data/processed/manhattan_graph.graphml")

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
