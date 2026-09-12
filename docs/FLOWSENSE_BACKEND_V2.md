# FlowSense — Backend v2.0

Documentación técnica de las capacidades agregadas en la versión **Backend Version 2.0**, alineadas con el dashboard de Leaflet (Frontend v1.2) y los requisitos de la **OpenCV AI Competition 2026**.

---

## 🎯 Objetivo

Completar el núcleo lógico y analítico de FlowSense conectando la simulación urbana en tiempo real con:
1. **Un motor científico de benchmarking** que cuantifica empíricamente el tiempo salvado por el algoritmo dinámico de FlowSense frente a navegadores estáticos tradicionales.
2. **Un sistema de inyección y despeje de incidentes viales** en tiempo real con emisión de alertas prioritarias (`mission_alert`) para el feed de incidentes del mapa.
3. **Un servicio de persistencia y replay de misiones** que provee fotogramas secuenciales al controlador de repetición (`TimelineScrubber` y `ReplayController`).

---

## 🚀 Qué Cambió en esta Versión

### 1. Motor de Benchmarking Monte Carlo (`benchmark_service.py`)
- **Evaluación Multi-Viaje:** Evalúa $N$ viajes de emergencia distribuidos aleatoriamente sobre la red vial de Manhattan bajo condiciones de hora pico.
- **Comparación en Paralelo:** Calcula para cada viaje:
  - **Ruta Estática:** Dijkstra tradicional basado en distancia euclidiana/longitud física, sufriendo embotellamientos severos.
  - **FlowSense Dinámico:** Dijkstra ponderado con la función de impedancia $W_e = \text{Longitud} \times (1 + \alpha \cdot \text{CongestionFactor}) \times \text{RoadClassFactor}$.
- **Métricas Agregadas:**
  - *Tiempo Promedio (s)*
  - *Distancia (m)*
  - *Intersecciones Bloqueadas Evitadas*
  - *Tasa de Éxito en Corredor de Emergencia (%)*
  - *Segundos Netos Salvados*
- **Endpoints REST:**
  - `GET /api/v1/benchmark/summary`: Consulta el último resumen generado.
  - `POST /api/v1/benchmark/run?num_samples=15&congestion_intensity=0.8`: Dispara una nueva corrida analítica.

---

### 2. Gestión de Incidentes Viales y Alertas en Vivo (`traffic.py` + `graph_service.py`)
- **Inyección por Coordenadas y Radio:** Permite a operadores de despacho o cámaras OpenCV notificar un bloqueo (accidente grave, incendio estructural, etc.) en cualquier lat/lon con radio de impacto parametrizable.
- **Modificación Inmediata del Grafo:** Aumenta exponencialmente la impedancia en las vías afectadas para obligar a las unidades a desviarse.
- **Eventos WebSocket de Alta Prioridad:**
  - Emite `mission_alert` con severidad `critical` / `warning`, recibido directamente por `AlertsFeed.tsx` en el dashboard.
  - Emite `traffic_update` para pintar las calles afectadas de rojo en Leaflet.
- **Despeje de Vía:**
  - `POST /api/v1/traffic/incident`: Reportar incidente.
  - `POST /api/v1/traffic/incident/{id}/clear`: Despejar vía y restaurar las condiciones de flujo libre.

---

### 3. Historial de Misiones y Replay para Leaflet (`replay_service.py` + `replay.py`)
- **Buffer de Fotogramas:** Almacena objetos de tipo `ReplayFrame` con:
  - Posiciones de vehículos de emergencia (lat, lon, rumbo, velocidad).
  - Estados y factores de congestión por segmento.
  - Alertas emitidas en cada instante.
  - Geometría activa del corredor.
- **Endpoint:**
  - `GET /api/v1/replay/latest?frames=30`: Devuelve la secuencia temporal para alimentar la barra de reproducción del frontend.

---

### 4. Integración en el Cliente Frontend (`frontend/src/api/client.ts`)
Se incorporaron las funciones TypeScript de consumo:
- `fetchBenchmarkSummary()`
- `runBenchmark(numSamples)`
- `fetchReplayLatest(frames)`
- `reportIncident(payload)`
- `clearIncident(incidentId)`

---

## 🧪 Pruebas Automatizadas

Se agregaron pruebas unitarias e integrales en `tests/test_benchmark.py` y `tests/test_incidents.py`:

```bash
.\venv\Scripts\pytest tests/ -v
```

```text
tests/test_api.py::test_health_check_root PASSED                         [  6%]
tests/test_api.py::test_graph_status_endpoint PASSED                     [ 12%]
tests/test_api.py::test_graph_geojson_endpoint PASSED                    [ 18%]
tests/test_api.py::test_traffic_update_endpoint PASSED                   [ 25%]
tests/test_api.py::test_dispatch_route_endpoint PASSED                   [ 31%]
tests/test_api.py::test_websocket_telemetry_channel PASSED               [ 37%]
tests/test_benchmark.py::test_benchmark_service_execution PASSED         [ 43%]
tests/test_benchmark.py::test_benchmark_summary_endpoint PASSED          [ 50%]
tests/test_benchmark.py::test_benchmark_run_endpoint PASSED              [ 56%]
tests/test_incidents.py::test_incident_injection_and_evasion PASSED      [ 62%]
tests/test_incidents.py::test_replay_latest_endpoint PASSED              [ 68%]
tests/test_routing.py::test_graph_initialization PASSED                  [ 75%]
tests/test_routing.py::test_nearest_node_lookup PASSED                   [ 81%]
tests/test_routing.py::test_congestion_impedance_update PASSED           [ 87%]
tests/test_routing.py::test_dynamic_routing_avoids_congestion PASSED     [ 93%]
tests/test_routing.py::test_dispatch_mode_reports_savings PASSED         [100%]

======================= 16 passed in 1.73s =======================
```

---

## 🚦 Cómo Ejecutar el Backend

```powershell
# 1. Activar entorno virtual
.\venv\Scripts\activate

# 2. Iniciar servidor FastAPI
uvicorn src.main:app --reload --port 8000
```

- **Swagger UI:** `http://127.0.0.1:8000/docs`
- **WebSocket:** `ws://127.0.0.1:8000/ws/telemetry`
