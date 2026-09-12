# FlowSense — Backend v3.0

Documentación técnica de las capacidades agregadas en la versión **Backend Version 3.0**: **Onda Verde Semafórica (Green Wave Preemption)** y **Registro de Cámaras de Tráfico OpenCV**.

---

## 🎯 Objetivo

Implementar la respuesta activa del entorno urbano ante el paso de vehículos de emergencia:
1. **Onda Verde Inteligente (Traffic Signal Preemption):** Detectar la proximidad de una ambulancia (200–300 m) a lo largo de su ruta calculada y conmutar en verde las intersecciones por delante, despejando el carril y reteniendo en rojo el tráfico perpendicular.
2. **Registro de Cámaras de Percepción CCTV (`/api/v1/cameras`):** Dotar al sistema de una red de cámaras georreferenciadas en Manhattan (Times Square, Penn Station, Grand Central, etc.) con formato GeoJSON para Leaflet y un endpoint directo para que los scripts de OpenCV 5 transmitan datos procesados fotograma a fotograma.

---

## 🚀 Módulos y Cambios Implementados

### 1. Servicio de Onda Verde y Semáforos (`signal_service.py` & `/api/v1/signals`)
- **Control de Intersecciones:** Modela el ciclo y estado de semáforos de Manhattan (`normal`, `preempted`).
- **Despeje Anticipado en Simulación:** Conforme la ambulancia avanza, el simulador de misiones llama automáticamente a `update_green_wave_corridor()`, despejando hasta 3 intersecciones por delante y liberando las que ya rebasó.
- **Eventos WebSocket en Vivo:**
  - `SIGNAL_PREEMPTION`: Notifica el cambio de estado de un cruce específico.
  - `GREEN_WAVE_ACTIVE`: Notifica la lista de nodos actualmente despejados y la longitud del corredor verde para visualización en Leaflet.
- **Endpoints:**
  - `GET /api/v1/signals`: Catálogo de semáforos y estados actuales.
  - `GET /api/v1/signals/active`: Cruces actualmente con onda verde activa.
  - `POST /api/v1/signals/{node_id}/preempt`: Forzar preemption en una intersección.
  - `POST /api/v1/signals/{node_id}/release`: Liberar intersección al ciclo regular.

---

### 2. Catálogo de Cámaras de Tráfico OpenCV (`camera_service.py` & `/api/v1/cameras`)
- **Red de Cámaras CCTV:** 8 cámaras estratégicas ubicadas en arterias de alto tráfico de Manhattan:
  - `CAM-NYC-MID-01`: Times Square Corridor (7th Ave & 46th St)
  - `CAM-NYC-MID-02`: Penn Station (8th Ave & 34th St)
  - `CAM-NYC-MID-03`: Grand Central Approach (Park Ave & 42nd St)
  - `CAM-NYC-MID-04`: Herald Square & 6th Ave
  - `CAM-NYC-MID-05`: Rockefeller Center & 5th Ave
  - `CAM-NYC-MID-06`: Columbus Circle North
  - `CAM-NYC-MID-07`: Bryant Park & 42nd St
  - `CAM-NYC-MID-08`: Port Authority Terminal
- **Capa GeoJSON:** `GET /api/v1/cameras/geojson` devuelve una colección de puntos lista para integrarse como capa en `LayerControls.tsx` de Leaflet.
- **Ingesta Directa de OpenCV 5:**
  - `POST /api/v1/cameras/{camera_id}/telemetry`: Recibe `vehicle_count`, `average_speed_kmh` y `congestion_factor`.
  - Actualiza automáticamente las vías conectadas en el grafo urbano (`graph_service`) y emite `TRAFFIC_UPDATE` por WebSockets.

---

### 3. Cliente Frontend Actualizado (`frontend/src/api/client.ts`)
Funciones añadidas para consumo directo desde React:
- `fetchSignals()` y `fetchActiveSignals()`
- `preemptSignal(nodeId, vehicleId, duration)` y `releaseSignal(nodeId)`
- `fetchCameras()` y `fetchCamerasGeoJson()`
- `sendCameraTelemetry(cameraId, payload)`

---

## 🧪 Pruebas Automatizadas

Se crearon suites de tests en `tests/test_signals.py` y `tests/test_cameras.py`:

```bash
.\venv\Scripts\pytest tests/ -v
```

```text
tests/test_api.py (6 tests) ........................... PASSED
tests/test_benchmark.py (3 tests) ..................... PASSED
tests/test_cameras.py (3 tests) ....................... PASSED
tests/test_incidents.py (2 tests) ..................... PASSED
tests/test_routing.py (5 tests) ....................... PASSED
tests/test_signals.py (3 tests) ....................... PASSED

======================= 22 passed in 1.93s =======================
```
