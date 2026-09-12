# FlowSense — Perception Engine & Advanced Routing v4.0

Documentación técnica de los avances en el **Módulo de Percepción (Computer Vision)** y el **Motor de Enrutamiento Avanzado (A*)**.

---

## 🎯 Objetivo

Establecer la capacidad central de FlowSense para extraer métricas de congestión en tiempo real desde flujos de video y utilizarlas para calcular las rutas óptimas para vehículos de emergencia.

1. **Perception Engine (OpenCV + ONNX):** Procesar video para detectar, rastrear y estimar la velocidad del tráfico y la congestión.
2. **Advanced Routing (A\* Multi-criterio):** Sustituir el enrutamiento estático de Dijkstra por un modelo heurístico (A\*) que integra distancia física, telemetría de tráfico en vivo, y el despeje de la Onda Verde Semafórica.

---

## 🚀 Módulos y Cambios Implementados

### 1. Motor de Percepción de Tráfico (`src/perception/`)

- **Detección (`detector.py`):**
  - Integración nativa de modelos YOLOv8 exportados a formato ONNX.
  - Soporte de ejecución mediante `OpenCV DNN` y `ONNX Runtime`.
  - Redimensionamiento con "letterboxing" para mantener la relación de aspecto, procesando fotogramas de manera eficiente.
- **Seguimiento y Velocidad (`tracker.py`):**
  - Implementación de un rastreador basado en Intersection-over-Union (IoU) adaptativo.
  - Estimación de velocidad inter-fotograma calculando la variación espacial del centroide del bounding box.
- **Estimación de Congestión (`congestion_estimator.py`):**
  - Calcula un Factor de Congestión (0.0 a 1.0) fusionando la densidad de vehículos en una intersección y su velocidad promedio en relación al flujo libre.
- **Pipeline Integral (`pipeline.py`):**
  - Une todas las fases: VideoSource → Detector → Tracker → Estimator.
  - Despacha los datos procesados (telemetría) automáticamente al backend (`/api/v1/cameras/{camera_id}/telemetry`) empleando únicamente la biblioteca estándar (`urllib.request`).

---

### 2. Enrutamiento Avanzado A\* (`src/services/routing_engine.py`)

- **Transición a A-Star (A\*):**
  - Se actualizó el motor de enrutamiento basado en NetworkX para usar A* (`nx.astar_path`) en lugar del algoritmo estático de Dijkstra.
  - **Función Heurística (Haversine):** Utiliza la distancia geográfica en línea recta hasta el destino para guiar la exploración del grafo, reduciendo significativamente los tiempos de cómputo en la malla de Manhattan.
- **Pesos Multi-criterio Dinámicos:**
  - **Distancia:** Factor base de longitud de la calle.
  - **Tráfico:** Escala el costo según la congestión recibida de las cámaras OpenCV en vivo (`edge_data.get('traffic_congestion', 0.0)`).
  - **Priority Preemption (Onda Verde):** Reduce artificialmente el peso computacional de cruces que ya han sido intervenidos por el sistema semafórico del backend, alentando al algoritmo a usar corredores previamente despejados.
- **Evaluación Comparativa (Benchmark):**
  - Integración de scripts de benchmark (`tests/test_benchmark.py`) y endpoints de comparación para simular y validar la diferencia de Tiempos de Respuesta Estimados (ETA) entre algoritmos estáticos y algoritmos dinámicos (FlowSense).

---

## 🧪 Pruebas Automatizadas

Se crearon exhaustivas pruebas unitarias para los nuevos componentes, alcanzando una cobertura de 48 pruebas exitosas.

```bash
python -m pytest tests/ -v
```

```text
tests/test_api.py (6 tests) ........................... PASSED
tests/test_benchmark.py (3 tests) ..................... PASSED
tests/test_cameras.py (3 tests) ....................... PASSED
tests/test_incidents.py (2 tests) ..................... PASSED
tests/test_perception.py (17 tests) ................... PASSED
tests/test_routing.py (5 tests) ....................... PASSED
tests/test_routing_advanced.py (9 tests) .............. PASSED
tests/test_signals.py (3 tests) ....................... PASSED

======================== 48 passed in 1.10s ========================
```
