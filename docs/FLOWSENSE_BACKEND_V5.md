# FlowSense — Backend & Cloud Architecture v5.0

Documentación técnica de los módulos y capacidades agregadas en la versión **Backend Version 5.0**: **Despacho Avanzado ($K$-Alternativas, Flotas y Re-ruteo Dinámico)**, **Contenerización Docker para AWS EC2 Free Tier**, **Integración Continua con GitHub Actions** y **Extractor de Mallas Viales OpenStreetMap**.

---

## 🎯 Objetivo

Completar las capacidades de enrutamiento avanzado y la preparación para producción en la nube de FlowSense:
1. **Despacho Avanzado y Resiliencia en Tránsito:** Exponer a través de la API REST el cálculo de $K$ rutas alternativas con evaluación de solapamiento, el despacho simultáneo de flotas multi-vehículo y el recálculo dinámico en vuelo (*dynamic re-routing*).
2. **Cloud Readiness (AWS Free Tier EC2 `t2/t3.micro`):** Empaquetar el sistema en un contenedor Docker optimizado (< 250 MB de consumo de RAM) y orquestado mediante Docker Compose para despliegues con un solo comando en la infraestructura cloud gratuita de AWS.
3. **Automatización y CI/CD:** Flujo de trabajo de GitHub Actions para asegurar que cada contribución supere las pruebas automatizadas del proyecto.
4. **Extractor de Mallas Viales Reales:** Script automatizado para descargar y persistir en formato GraphML cualquier zona geográfica vía OpenStreetMap / OSMnx.

---

## 🚀 Qué Cambió en esta Versión

### 1. Endpoints de Despacho Avanzado (`src/api/routes/dispatch.py`)

| Endpoint | Método | Descripción |
| :--- | :--- | :--- |
| `/api/v1/dispatch/alternatives` | `POST` | Calcula la ruta óptima primaria y hasta $K-1$ rutas alternativas de contingencia utilizando el algoritmo de $K$-caminos más cortos con penalización por solapamiento (*overlap penalty*). |
| `/api/v1/dispatch/fleet` | `POST` | Despacho y optimización multi-unidad para flotas de emergencia (ambulancias y bomberos) minimizando el tiempo total de respuesta. |
| `/api/v1/dispatch/reroute` | `POST` | Recalcula el corredor óptimo desde la posición GPS intermedia de una unidad activa hasta el destino y emite el evento `ROUTE_RECALCULATED` por WebSockets. |
| `/api/v1/dispatch/corridor/preempt` | `POST` | Aplica una reducción porcentual de impedancia en una secuencia de nodos para simular el despeje por Onda Verde. |
| `/api/v1/dispatch/corridor/restore` | `POST` | Restaura los pesos originales de las aristas del corredor despejado. |

---

### 2. Contenerización y Despliegue en AWS Free Tier

- **`Dockerfile` Multi-Stage Optimizado:**
  - Basado en `python:3.11-slim` con capas mínimas de librerías del sistema (`libglib2.0-0`, `libgomp1`, `curl`).
  - Ejecución con un solo worker en Uvicorn para ajustarse de forma estricta al límite de 1 GB de memoria RAM de una instancia `t2.micro` o `t3.micro` de AWS.
  - Verificación periódica de estado de salud (*healthcheck*) en `GET /`.
- **`docker-compose.yml`:**
  - Orquesta el backend FastAPI (`flowsense-backend`, puerto 8000) y el frontend web (`flowsense-frontend`, puerto 5173).
  - Mapeo de volumen para persistencia de la caché vial en `data/processed/`.
- **`.dockerignore`:**
  - Evita copiar entornos virtuales, cachés de Python (`__pycache__`), pesos masivos no procesados y carpetas de desarrollo a la imagen.

---

### 3. Pipeline de Integración Continua (CI)

- **Workflow `.github/workflows/ci.yml`:**
  - Se ejecuta automáticamente ante cada `push` o `pull_request` sobre la rama `main`.
  - Configura el entorno Python en Ubuntu Latest, instala dependencias y corre la suite completa de 52 pruebas con reporte de tiempos de ejecución (`--durations=10`).

---

### 4. Extractor de Grafos OpenStreetMap (`scripts/download_city_graph.py`)

Script ejecutable con soporte de argumentos de terminal:
```bash
# Descarga por nombre de ciudad o distrito
python scripts/download_city_graph.py --place "Manhattan, New York, USA"

# Descarga por coordenadas Bounding Box (Norte, Sur, Este, Oeste)
python scripts/download_city_graph.py --bbox 40.7700 40.7300 -73.9700 -74.0100 --output data/processed/manhattan_graph.graphml
```
Normaliza automáticamente longitudes, límites de velocidad y pesos de emergencia $W_e$ para su carga inmediata por parte de `graph_service`.

---

### 5. Resiliencia de Serialización GraphML y Compatibilidad CI

- **Corrección en Restauración de Corredores (`src/api/routes/dispatch.py`):**
  - Se corrigió la validación `if backup is None:` en lugar de `if not backup:`. Esto evita falsos errores `404 Not Found` cuando una solicitud de despeje no tiene aristas que modificar pero el identificador de corredor sí existe en memoria.
- **Soporte Bimodal (Enteros y Cadenas) para IDs de Nodos (`src/services/routing_engine.py`):**
  - Los métodos `precompute_clearance_corridor` y `restore_corridor_weights` ahora verifican automáticamente tanto claves enteras (`int`) como representaciones en texto (`str`), garantizando compatibilidad idéntica entre grafos sintéticos y grafos importados vía GraphML u OSMnx.
- **Saneamiento de Atributos de Grafo (`src/services/graph_service.py` y `scripts/download_city_graph.py`):**
  - Se normalizan atributos complejos de OSMnx (listas de etiquetas viales como `osmid` o `highway`) a cadenas escalares antes de llamar a `nx.write_graphml()`, eliminando excepciones `TypeError: GraphML writer does not support <class 'list'>`.
- **Nodos Dinámicos en Pruebas (`tests/test_dispatch_advanced.py`):**
  - Las pruebas de despacho obtienen nodos reales calculados a partir de rutas dinámicas activas, asegurando una ejecución 100% exitosa tanto en entornos de desarrollo local como en los runners de GitHub Actions en Ubuntu.

---

## 🧪 Pruebas Automatizadas

Se añadieron pruebas de integración en `tests/test_dispatch_advanced.py`:

```bash
.\venv\Scripts\pytest tests/ -v
```

```text
tests/test_api.py (6 tests) ................................. PASSED
tests/test_benchmark.py (3 tests) ........................... PASSED
tests/test_cameras.py (3 tests) ............................. PASSED
tests/test_dispatch_advanced.py (4 tests) .................... PASSED
tests/test_incidents.py (2 tests) ........................... PASSED
tests/test_perception.py (17 tests) ......................... PASSED
tests/test_routing.py (5 tests) ............................. PASSED
tests/test_routing_advanced.py (9 tests) .................... PASSED
tests/test_signals.py (3 tests) ............................. PASSED

======================= 52 passed in 3.37s =======================
```

---

## 🚀 Cómo Desplegar con Docker

Para levantar el sistema completo en local o en una instancia EC2 de AWS:

```bash
# 1. Construir y levantar servicios
docker compose up -d --build

# 2. Verificar contenedores activos
docker compose ps

# 3. Ver logs en tiempo real
docker compose logs -f backend
```
Acceso a la API: `http://localhost:8000/docs`
