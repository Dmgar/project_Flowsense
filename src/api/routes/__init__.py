"""API routes package"""
from src.api.routes.traffic import router as traffic_router
from src.api.routes.dispatch import router as dispatch_router
from src.api.routes.graph import router as graph_router

__all__ = ["traffic_router", "dispatch_router", "graph_router"]
