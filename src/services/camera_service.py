import logging
from typing import Dict, List, Any, Optional
from datetime import datetime, timezone

from src.services.graph_service import graph_service
from src.api.websockets.connection_manager import manager
from src.models.schemas import CameraDevice, CameraTelemetryReport
from src.models.telemetry import WebSocketMessage, TelemetryEventType

logger = logging.getLogger("flowsense.cameras")

class CameraService:
    """
    Manages the municipal CCTV traffic camera inventory across Manhattan intersections
    and processes real-time vehicle perception telemetry from the OpenCV 5 engine.
    """
    def __init__(self):
        self._cameras: Dict[str, Dict[str, Any]] = {}
        self._initialized = False

    def initialize(self):
        """Registers CCTV perception nodes at major Manhattan arteries."""
        if self._initialized:
            return

        G = graph_service.get_graph()
        nodes = list(G.nodes(data=True))
        if not nodes:
            return

        # Predefined strategic camera locations
        cctv_configs = [
            ("CAM-NYC-MID-01", "Times Square Corridor", 40.7580, -73.9855, 180.0),
            ("CAM-NYC-MID-02", "Penn Station & 8th Ave", 40.7505, -73.9910, 0.0),
            ("CAM-NYC-MID-03", "Grand Central Approach (Park Ave)", 40.7525, -73.9770, 90.0),
            ("CAM-NYC-MID-04", "Herald Square & 6th Ave", 40.7490, -73.9880, 270.0),
            ("CAM-NYC-MID-05", "Rockefeller Center & 5th Ave", 40.7590, -73.9780, 180.0),
            ("CAM-NYC-MID-06", "Columbus Circle North", 40.7620, -73.9820, 0.0),
            ("CAM-NYC-MID-07", "Bryant Park & 42nd St", 40.7535, -73.9835, 90.0),
            ("CAM-NYC-MID-08", "Port Authority Terminal", 40.7565, -73.9905, 270.0),
        ]

        for cam_id, name, lat, lon, bearing in cctv_configs:
            nearest_node = graph_service.find_nearest_node(lat, lon)
            node_data = G.nodes.get(nearest_node) or G.nodes.get(str(nearest_node), {})

            self._cameras[cam_id] = {
                "camera_id": cam_id,
                "name": name,
                "intersection_node": nearest_node,
                "latitude": float(node_data.get("y", lat)),
                "longitude": float(node_data.get("x", lon)),
                "bearing_degrees": bearing,
                "status": "online",
                "latest_vehicle_count": 18,
                "latest_speed_kmh": 38.0,
                "latest_congestion_factor": 0.25,
                "last_update": datetime.now(timezone.utc).isoformat()
            }

        self._initialized = True
        logger.info(f"Registered {len(self._cameras)} municipal OpenCV perception cameras.")

    def get_all_cameras(self) -> List[CameraDevice]:
        self.initialize()
        return [CameraDevice(**c) for c in self._cameras.values()]

    def get_camera(self, camera_id: str) -> Optional[CameraDevice]:
        self.initialize()
        c = self._cameras.get(camera_id)
        return CameraDevice(**c) if c else None

    def to_geojson(self) -> Dict[str, Any]:
        """Returns cameras as GeoJSON Point FeatureCollection for Leaflet map icons."""
        self.initialize()
        features = []
        for cam in self._cameras.values():
            cg = cam["latest_congestion_factor"]
            status_color = "#10B981" if cg < 0.35 else "#F59E0B" if cg < 0.70 else "#EF4444"

            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [cam["longitude"], cam["latitude"]]
                },
                "properties": {
                    "camera_id": cam["camera_id"],
                    "name": cam["name"],
                    "status": cam["status"],
                    "bearing": cam["bearing_degrees"],
                    "vehicle_count": cam["latest_vehicle_count"],
                    "speed_kmh": cam["latest_speed_kmh"],
                    "congestion_factor": cg,
                    "status_color": status_color,
                    "last_update": cam["last_update"]
                }
            })

        return {
            "type": "FeatureCollection",
            "features": features
        }

    async def ingest_telemetry(self, report: CameraTelemetryReport) -> Optional[CameraDevice]:
        """
        Receives per-frame perception output from OpenCV 5, updates camera status,
        and dynamically adjusts connected street segment weights in the urban graph.
        """
        self.initialize()
        if report.camera_id not in self._cameras:
            return None

        cam = self._cameras[report.camera_id]
        cam["latest_vehicle_count"] = report.vehicle_count
        cam["latest_speed_kmh"] = report.average_speed_kmh
        cam["latest_congestion_factor"] = report.congestion_factor
        cam["last_update"] = report.frame_timestamp or datetime.now(timezone.utc).isoformat()

        # Update connecting road edges in graph_service
        node_id = cam["intersection_node"]
        G = graph_service.get_graph()
        updated_edges = []

        for u, v, k in G.edges(keys=True):
            if u == node_id or v == node_id:
                graph_service.update_edge_congestion(
                    u=u, v=v, key=k,
                    congestion_factor=report.congestion_factor,
                    vehicle_count=report.vehicle_count,
                    average_speed_kmh=report.average_speed_kmh
                )
                updated_edges.append({"u": u, "v": v, "key": k})

        # Broadcast update over WebSocket so the dashboard and heatmap update live
        await manager.broadcast(
            WebSocketMessage(
                event=TelemetryEventType.TRAFFIC_UPDATE,
                data={
                    "source_camera": report.camera_id,
                    "congestion_factor": report.congestion_factor,
                    "updated_edges": updated_edges
                }
            )
        )

        return CameraDevice(**cam)

camera_service = CameraService()
