"""
Route Demo Generator — simulates dynamic A* emergency routing around video-detected congestion
and exports an interactive Leaflet HTML map.
"""
import asyncio
import json
import logging
import webbrowser
from pathlib import Path
from typing import Any, Dict, Optional

from src.models.schemas import CameraTelemetryReport, Coordinates, DispatchRequest, RouteResponse
from src.services.camera_service import camera_service
from src.services.graph_service import graph_service
from src.services.routing_engine import routing_engine

logger = logging.getLogger("flowsense.route_demo")


def run_route_simulation(
    camera_id: str,
    congestion_factor: float,
    vehicle_count: int,
    output_html_path: Optional[str] = "data/processed/traffic_route_demo.html",
    open_browser: bool = False,
) -> Dict[str, Any]:
    """
    Simulates emergency vehicle routing around the camera's detected congestion.

    1. Retrieves/auto-registers the camera on the urban graph.
    2. Injects the video-detected congestion into connected street edges.
    3. Calculates the dynamic A* emergency route that diverts around the bottleneck.
    4. Generates an interactive Leaflet HTML map visualizing both routes and the camera.
    """
    # 1. Ensure camera is known or auto-registered
    cam = camera_service.get_camera(camera_id)
    if not cam:
        report = CameraTelemetryReport(
            camera_id=camera_id,
            vehicle_count=vehicle_count,
            congestion_factor=congestion_factor,
            average_speed_kmh=max(8.0, 45.0 * (1.0 - congestion_factor)),
        )
        cam = asyncio.run(camera_service.ingest_telemetry(report))
        if not cam:
            cam = camera_service.get_camera(camera_id)

    G = graph_service.get_graph()
    cam_node = cam.intersection_node
    node_data = G.nodes.get(cam_node) or G.nodes.get(str(cam_node), {})
    cam_lat = float(node_data.get("y", cam.latitude))
    cam_lon = float(node_data.get("x", cam.longitude))
    cam_name = cam.name

    # 2. Pick Origin (South-West) and Destination (North-East) of the camera
    origin_coords = Coordinates(latitude=round(cam_lat - 0.0055, 6), longitude=round(cam_lon - 0.0055, 6))
    dest_coords = Coordinates(latitude=round(cam_lat + 0.0055, 6), longitude=round(cam_lon + 0.0055, 6))

    dispatch_req = DispatchRequest(
        origin=origin_coords,
        destination=dest_coords,
        vehicle_type="ambulance",
        priority="critical",
    )

    # 3. Apply Video Congestion into Graph
    cong_report = CameraTelemetryReport(
        camera_id=camera_id,
        vehicle_count=vehicle_count,
        congestion_factor=congestion_factor,
        average_speed_kmh=max(8.0, 45.0 * (1.0 - congestion_factor)),
    )
    asyncio.run(camera_service.ingest_telemetry(cong_report))

    # 4. Calculate Dynamic Route (A* with Traffic Evasion)
    route_dynamic: RouteResponse = routing_engine.calculate_emergency_route(dispatch_req)

    # 5. Extract results
    result_data = {
        "camera_id": camera_id,
        "camera_name": cam_name,
        "camera_coords": [cam_lat, cam_lon],
        "congestion_factor": congestion_factor,
        "vehicle_count": vehicle_count,
        "route_distance_m": round(route_dynamic.total_distance_m, 1),
        "route_eta_s": round(route_dynamic.total_estimated_time_s, 1),
        "baseline_distance_m": round(route_dynamic.baseline_distance_m, 1),
        "baseline_eta_s": round(route_dynamic.baseline_eta_seconds, 1),
        "savings_pct": round(route_dynamic.savings_pct, 1),
        "status": route_dynamic.status,
        "origin": [origin_coords.latitude, origin_coords.longitude],
        "destination": [dest_coords.latitude, dest_coords.longitude],
    }

    # 6. Generate HTML map
    if output_html_path:
        html_file = Path(output_html_path)
        html_file.parent.mkdir(parents=True, exist_ok=True)
        html_content = _build_leaflet_html(cam, route_dynamic, result_data)
        html_file.write_text(html_content, encoding="utf-8")
        result_data["html_path"] = str(html_file.resolve())
        logger.info(f"Interactive routing map saved to: {html_file.resolve()}")

        if open_browser:
            webbrowser.open(html_file.resolve().as_uri())

    return result_data


def _build_leaflet_html(cam, route: RouteResponse, data: Dict[str, Any]) -> str:
    """Builds a standalone interactive Leaflet HTML dashboard."""
    dynamic_geojson = json.dumps(route.geojson)
    static_geojson = json.dumps(route.static_geojson) if route.static_geojson else "null"

    cg = data["congestion_factor"]
    cg_color = "#10B981" if cg < 0.35 else "#F59E0B" if cg < 0.70 else "#EF4444"
    cg_label = "Baja" if cg < 0.35 else "Moderada" if cg < 0.70 else "Grave / Congestión"

    return f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>FlowSense — Perception & Dynamic Routing</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    * {{ margin: 0; padding: 0; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }}
    body, html {{ height: 100%; width: 100%; overflow: hidden; background: #0b0f19; color: #f3f4f6; }}
    #map {{ height: 100%; width: 100%; }}
    .hud {{
      position: absolute; top: 20px; right: 20px; z-index: 1000;
      background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 14px;
      padding: 20px; width: 340px; box-shadow: 0 20px 40px rgba(0,0,0,0.6);
    }}
    .hud h2 {{ font-size: 1.1rem; font-weight: 700; color: #38bdf8; display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }}
    .hud p.sub {{ font-size: 0.8rem; color: #94a3b8; margin-bottom: 14px; }}
    .badge {{
      display: inline-block; padding: 4px 10px; border-radius: 20px; font-size: 0.75rem;
      font-weight: 600; text-transform: uppercase; margin-bottom: 14px;
      background: {cg_color}22; color: {cg_color}; border: 1px solid {cg_color}66;
    }}
    .metric-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; }}
    .metric {{ background: rgba(255,255,255,0.04); padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); }}
    .metric span {{ display: block; font-size: 0.7rem; color: #94a3b8; }}
    .metric strong {{ font-size: 1.05rem; color: #fff; }}
    .legend {{ border-top: 1px solid rgba(255,255,255,0.1); padding-top: 12px; font-size: 0.78rem; }}
    .legend-item {{ display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }}
    .legend-line {{ width: 22px; height: 4px; border-radius: 2px; }}
    .legend-dot {{ width: 12px; height: 12px; border-radius: 50%; }}
  </style>
</head>
<body>
  <div id="map"></div>
  <div class="hud">
    <h2>🚦 FlowSense A* Routing</h2>
    <p class="sub">Percepción de video en vivo + Evasión de congestión</p>
    <div class="badge">● {cg_label} ({data["congestion_factor"]*100:.0f}%)</div>
    
    <div class="metric-grid">
      <div class="metric"><span>Cámara Asignada</span><strong>{data["camera_id"]}</strong></div>
      <div class="metric"><span>Vehículos Video</span><strong>{data["vehicle_count"]}</strong></div>
      <div class="metric"><span>Ruta Dinámica (A*)</span><strong style="color: #10b981;">{data["route_eta_s"]}s</strong></div>
      <div class="metric"><span>Ruta Estática (Tráfico)</span><strong style="color: #ef4444;">{data["baseline_eta_s"]}s</strong></div>
    </div>
    <div class="metric" style="margin-bottom: 14px; text-align: center; background: rgba(16,185,129,0.1); border-color: rgba(16,185,129,0.3);">
      <span style="color: #6ee7b7;">Ahorro de Tiempo con FlowSense</span>
      <strong style="color: #10b981; font-size: 1.3rem;">{data["savings_pct"]}% más rápido</strong>
    </div>
    
    <div class="legend">
      <div class="legend-item"><div class="legend-line" style="background: #10b981;"></div><span>Ruta Dinámica FlowSense (Despejada)</span></div>
      <div class="legend-item"><div class="legend-line" style="background: #ef4444; border-top: 2px dashed #f87171;"></div><span>Ruta Base (Atascada por congestión)</span></div>
      <div class="legend-item"><div class="legend-dot" style="background: {cg_color};"></div><span>{data["camera_name"]}</span></div>
    </div>
  </div>

  <script>
    const map = L.map('map', {{ zoomControl: false }}).setView([{data["camera_coords"][0]}, {data["camera_coords"][1]}], 15);
    L.control.zoom({{ position: 'bottomright' }}).addTo(map);

    L.tileLayer('https://{{s}}.basemaps.cartocdn.com/dark_all/{{z}}/{{x}}/{{y}}{{r}}.png', {{
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      maxZoom: 19
    }}).addTo(map);

    // Static Route (Congested baseline)
    const staticGeo = {static_geojson};
    if (staticGeo) {{
      L.geoJSON(staticGeo, {{
        style: {{ color: '#ef4444', weight: 5, dashArray: '6, 8', opacity: 0.7 }}
      }}).addTo(map).bindPopup('<b>Ruta Estática</b><br>Atascada por la congestión detectada en el video.');
    }}

    // Dynamic Route (FlowSense A*)
    const dynamicGeo = {dynamic_geojson};
    if (dynamicGeo) {{
      const dynLayer = L.geoJSON(dynamicGeo, {{
        style: {{ color: '#10b981', weight: 6, opacity: 0.95 }}
      }}).addTo(map).bindPopup('<b>Ruta Dinámica FlowSense</b><br>Desvío inteligente guiado por A* evitando el embotellamiento.');
      map.fitBounds(dynLayer.getBounds(), {{ padding: [60, 60] }});
    }}

    // Camera Marker
    const camCircle = L.circleMarker([{data["camera_coords"][0]}, {data["camera_coords"][1]}], {{
      radius: 12,
      fillColor: '{cg_color}',
      color: '#ffffff',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.85
    }}).addTo(map).bindPopup(`
      <b>📸 Cámara: {data["camera_id"]}</b><br>
      <b>Ubicación:</b> {data["camera_name"]}<br>
      <b>Congestión detectada:</b> {data["congestion_factor"]*100:.0f}%<br>
      <b>Vehículos contados:</b> {data["vehicle_count"]}
    `);

    // Origin (Ambulance) & Destination (Hospital/Incident)
    L.marker([{data["origin"][0]}, {data["origin"][1]}]).addTo(map).bindPopup('<b>🚑 Despacho de Emergencia</b><br>Origen');
    L.marker([{data["destination"][0]}, {data["destination"][1]}]).addTo(map).bindPopup('<b>🏥 Destino de Emergencia</b><br>Hospital / Incidente');
  </script>
</body>
</html>
"""
