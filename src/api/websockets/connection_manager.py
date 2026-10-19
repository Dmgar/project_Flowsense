import asyncio
import logging
from collections import defaultdict
from typing import Dict, Set
from fastapi import WebSocket, status
from src.models.telemetry import WebSocketMessage

logger = logging.getLogger("flowsense.websocket")

MAX_TOTAL_CONNECTIONS = 60
MAX_CONNECTIONS_PER_IP = 4
SEND_TIMEOUT_SECONDS = 2.0

class ConnectionManager:
    """
    Manages active WebSocket connections for real-time Leaflet dashboard telemetry streaming.
    Protects against connection exhaustion, Slowloris hoarding, and blocking broadcasts.
    """
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
        self.connections_by_ip: Dict[str, Set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    def _get_client_ip(self, websocket: WebSocket) -> str:
        forwarded = websocket.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        real_ip = websocket.headers.get("x-real-ip")
        if real_ip:
            return real_ip.strip()
        return websocket.client.host if websocket.client else "unknown"

    async def connect(self, websocket: WebSocket) -> bool:
        client_ip = self._get_client_ip(websocket)
        async with self._lock:
            if len(self.active_connections) >= MAX_TOTAL_CONNECTIONS:
                logger.warning("WS rejected: global connection limit reached.")
                await websocket.close(code=status.WS_1013_TRY_AGAIN_LATER)
                return False

            if len(self.connections_by_ip[client_ip]) >= MAX_CONNECTIONS_PER_IP:
                logger.warning(f"WS rejected: IP {client_ip} exceeded max concurrent connections.")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return False

            await websocket.accept()
            self.active_connections.add(websocket)
            self.connections_by_ip[client_ip].add(websocket)
            logger.info(f"WebSocket client connected from {client_ip}. Active clients: {len(self.active_connections)}")
            return True

    async def disconnect(self, websocket: WebSocket):
        client_ip = self._get_client_ip(websocket)
        async with self._lock:
            self.active_connections.discard(websocket)
            if client_ip in self.connections_by_ip:
                self.connections_by_ip[client_ip].discard(websocket)
                if not self.connections_by_ip[client_ip]:
                    del self.connections_by_ip[client_ip]
            logger.info(f"WebSocket client disconnected ({client_ip}). Remaining: {len(self.active_connections)}")

    async def broadcast(self, message: WebSocketMessage):
        """Broadcasts structured telemetry message to all connected clients in parallel with timeouts."""
        if not self.active_connections:
            return

        payload = message.model_dump()
        clients_snapshot = list(self.active_connections)

        async def _send(ws: WebSocket):
            try:
                await asyncio.wait_for(ws.send_json(payload), timeout=SEND_TIMEOUT_SECONDS)
                return None
            except Exception as e:
                logger.debug(f"Client dropped during broadcast: {e}")
                return ws

        results = await asyncio.gather(*(_send(ws) for ws in clients_snapshot))
        for ws in results:
            if ws is not None:
                await self.disconnect(ws)

manager = ConnectionManager()
