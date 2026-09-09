import logging
from typing import List
from fastapi import WebSocket
from src.models.telemetry import WebSocketMessage

logger = logging.getLogger("flowsense.websocket")

class ConnectionManager:
    """
    Manages active WebSocket connections for real-time Leaflet dashboard telemetry streaming.
    """
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"WebSocket client connected. Active clients: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"WebSocket client disconnected. Remaining clients: {len(self.active_connections)}")

    async def broadcast(self, message: WebSocketMessage):
        """Broadcasts structured telemetry message to all connected clients."""
        if not self.active_connections:
            return

        payload = message.model_dump()
        disconnected_clients = []

        for connection in self.active_connections:
            try:
                await connection.send_json(payload)
            except Exception as e:
                logger.warning(f"Failed to send telemetry to client ({e}). Marking for cleanup.")
                disconnected_clients.append(connection)

        for client in disconnected_clients:
            self.disconnect(client)

manager = ConnectionManager()
