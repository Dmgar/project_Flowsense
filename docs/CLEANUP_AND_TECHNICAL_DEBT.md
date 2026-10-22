# FlowSense - Registro de Limpieza y Seguimiento de Deuda Técnica

Este documento registra los componentes obsoletos eliminados durante la fase de limpieza de código muerto y documenta detalladamente las partes heredadas que se mantuvieron conscientemente en el repositorio para su posterior migración o depuración.

---

## 1. Cambios Realizados (Fase 1: Frontend & Docker)

### A. Componentes Huérfanos Eliminados (`frontend/src/components/`)
Se eliminaron 19 componentes antiguos creados durante el MVP de Manhattan y el piloto de Cartagena que no eran importados por el producto en producción (`frontend/src/product/`):

1. `EmergencyPlanner.tsx` (18 KB): Interfaz con lugares hardcodeados de Manhattan y Cartagena.
2. `IncidentConsole.tsx` (12.8 KB): Consola de demostraciones simuladas de incidentes.
3. `Sidebar.tsx` (12.7 KB): Barra lateral antigua con controles de despacho.
4. `MapView.tsx` (6.3 KB): Mapa obsoleto centrado en Manhattan y Cartagena (reemplazado por `CityMap.tsx`).
5. `MobileSheets.tsx` (5.5 KB): Paneles móviles antiguos vinculados a `Sidebar`.
6. `LayerControls.tsx` (4.4 KB): Selector de capas anterior.
7. `CongestionLayer.tsx` (3.6 KB): Capa de congestión sobre Leaflet antigua.
8. `TimelineScrubber.tsx` (3.3 KB): Barra de tiempo antigua.
9. `BenchmarkPanel.tsx` (3.3 KB): Panel de comparación sintética.
10. `VehicleMarkers.tsx` (3.0 KB): Marcadores de vehículos antiguos.
11. `AlertsFeed.tsx` (2.8 KB): Feed de alertas de misión.
12. `BottomDock.tsx` (2.7 KB): Muelle inferior anterior.
13. `ReplayController.tsx` (2.5 KB): Controlador de replay antiguo.
14. `RouteLayer.tsx` (2.3 KB): Capa de ruta antigua.
15. `PresentationOverlay.tsx` (2.1 KB): Capa de modo presentación.
16. `BootSplash.tsx` (1.3 KB): Pantalla de carga anterior.
17. `StatusBar.tsx` (0.9 KB): Barra de estado antigua.
18. `PrivacyBadge.tsx` (0.8 KB): Insignia de privacidad antigua.
19. `CongestionLegend.tsx` (0.7 KB): Leyenda de congestión antigua.

*Archivos conservados en `frontend/src/components/`:*
- `BrandMark.tsx` y `BrandMark.css` (usados por `Shell.tsx`, `Screens.tsx`, `playback-qa.tsx`).
- `DataInitializer.tsx` (usado por `Shell.tsx` para inicializar el grafo).
- `ErrorBoundary.tsx` (usado por `main.tsx`).

### B. Datos Mock Eliminados
- `frontend/src/data/mock.ts` y el directorio `frontend/src/data/`: Datos estáticos de rutas y benchmarks simulados de Manhattan.

### C. Estado Global Actualizado (`frontend/src/store/useStore.ts`)
- Se actualizó el valor predeterminado de `origin` de `"Downtown, Cartagena"` (`10.3910, -75.4794`) a `"Downtown Los Angeles"` (`33.9750, -118.2000`).

### D. Contenedores Actualizados (`docker-compose.yml`)
- Se configuró explícitamente `FLOWSENSE_CITY=los_angeles` y `PILOT_CITY=Greater Los Angeles, California` en lugar del antiguo `PILOT_CITY=New York (Manhattan)`.

### E. Impacto Medido
- Bundle CSS de producción reducido en ~20 kB gzippeado (`150.37 kB` vs `169.67 kB`).
- 132/132 pruebas unitarias de frontend pasando al 100%.

---

## 2. Elementos Conservados y Deuda Técnica (No Modificados Intencionalmente)

Para **no romper la suite de 317 pruebas de Backend (`pytest`)**, los siguientes elementos permanecen en el repositorio:

### A. Fixture de Pruebas (`tests/conftest.py`)
- **Línea 6:** `os.environ["FLOWSENSE_CITY"] = "manhattan"`.
- **Razón:** Los fixtures históricos de pruebas de despacho y ruteo (`test_routing.py`, `test_routing_advanced.py`, `test_signals.py`, `test_incidents.py`, etc.) asumen coordenadas de Manhattan (Times Square: `40.7580, -73.9855`, Central Park, etc.) y nodos de la cuadrícula de Manhattan.

### B. Cuadrícula Sintética de Manhattan (`src/services/graph_service.py`)
- **Método `_build_synthetic_manhattan_grid()`:** Líneas 178–270. Genera un grafo de 77 nodos (IDs 1000 a 1076) entre las calles 34 y 54 y avenidas 9ª y Park Ave.
- **Razón:** Sirve como fallback local si OSMnx no tiene conexión a internet y es utilizado por las pruebas unitarias cuando se ejecuta en entorno aislado.

### C. Inventario de Cámaras Estáticas (`src/services/camera_service.py`)
- **Líneas 35–60:** Mantiene listas estáticas para `CAM-NYC-MID-01` a `08` (Manhattan) y `CAM-CTG-01` a `08` (Cartagena).
- **Razón:** En el perfil de Los Ángeles (`CITY_PROFILE == "los_angeles"`), se utiliza el catálogo real de Caltrans (`data/public_cameras_los_angeles.json`). Las listas anteriores se mantienen únicamente si alguien levanta la API con perfiles heredados o corre pruebas unitarias antiguas.

### D. Configuración Predeterminada de Respaldo (`src/core/config.py`)
- **Líneas 6 y 16–23:** Si la variable `FLOWSENSE_CITY` no está definida en el entorno, el valor por defecto sigue siendo `"manhattan"` con su bounding box.
- **Razón:** Compatibilidad con la suite de pruebas automatizada de GitHub Actions (`.github/workflows/ci.yml`).

### E. Archivos de Datos Locales (`data/processed/`)
- `data/processed/manhattan_graph.graphml`: Grafo GraphML precargado para que los tests corran de inmediato sin consultar Overpass/OpenStreetMap.
- Bases SQLite locales de Manhattan: `flood_reports_manhattan.sqlite3`, `incident_ledger_manhattan.sqlite3`, `mobility_cases_manhattan.sqlite3`.

### F. Scripts Secundarios
- `scripts/run_cartagena_pilot.ps1`: Script de demostración para el piloto de emergencias pluviales de Cartagena.
- `scripts/download_city_graph.py`: Script genérico de descarga OSMnx para ciudades arbitrarias.

---

## 3. Hoja de Ruta para Limpieza o Migración Futura (Fase 2)

Cuando se decida realizar la migración completa del backend hacia Los Ángeles de forma definitiva:

1. **Migración de Tests Unitarios:**
   - Crear un subconjunto de nodos y coordenadas representativas de Los Ángeles (ej. Downtown LA / Autopistas I-10 e I-110).
   - Actualizar `tests/conftest.py` para fijar `os.environ["FLOWSENSE_CITY"] = "los_angeles"`.
   - Adaptar las aserciones en `test_routing.py` y `test_routing_advanced.py` hacia las coordenadas de Los Ángeles.
2. **Depuración del Servicio de Grafo:**
   - Reemplazar `_build_synthetic_manhattan_grid()` por un fallback regional de Los Ángeles o requerir siempre el grafo regional cacheado.
3. **Depuración de Cámaras y Configuración:**
   - Eliminar `cctv_configs` estáticas de Manhattan y Cartagena en `camera_service.py`.
   - Cambiar el valor por defecto en `src/core/config.py` a `los_angeles`.
4. **Limpieza de Archivos en `data/processed/`:**
   - Eliminar `manhattan_graph.graphml` y los archivos `.sqlite3` de Manhattan una vez que los tests ya no dependan de ellos.

---

## 4. Sistema de Retención y Desalojo de Video Evidencia (Ring Buffer FIFO con Pinning Activo)

Para evitar que los videos grabados saturen el disco del servidor (evitando costos innecesarios en AWS EC2/EBS o bloqueos por espacio):

### A. Principios de Diseño
1. **Desalojo FIFO Inteligente:** Los fragmentos de video MP4 antiguos no revisados se eliminan en orden cronológico (más viejos primero) cuando se supera la marca de agua (`VIDEO_EVIDENCE_PRUNE_WATERMARK`, 85% de la cuota) o el espacio en disco baja de la reserva de seguridad (`VIDEO_EVIDENCE_MIN_FREE_BYTES`), reduciendo el almacenamiento hasta la meta (`VIDEO_EVIDENCE_PRUNE_TARGET`, 70%).
2. **Pinning de Operador Activo (Protección en Vivo):** Si un operador está visualizando una cámara mediante WebRTC o monitoreo en segundo plano, sus videos **NUNCA** se eliminan y el archivo se preserva y actualiza continuamente mientras la cámara esté en uso.
3. **Pinning de Auditoría Humana (`track_feedback`):** Todo clip vinculado a una revisión manual de detección u operador humano queda permanentemente protegido de la eliminación.
4. **Preservación Total del Ledger Numérico:** Las tablas SQLite `samples` y `tracks` **no se tocan ni se borran**. Los registros históricos de tráfico, cruces, métricas y gráficas se mantienen al 100%, marcando únicamente el estado del archivo multimedia del clip como `'unavailable'` en la tabla `clips`.
5. **Configuración en `src/core/config.py`:**
   - `VIDEO_EVIDENCE_AUTO_PRUNE: bool = True`
   - `VIDEO_EVIDENCE_RETENTION_HOURS: float = 24.0` (clips más antiguos de 24h son candidatos a desalojo)
   - `VIDEO_EVIDENCE_PRUNE_WATERMARK: float = 0.85` (gatillo de cuota al 85%)
   - `VIDEO_EVIDENCE_PRUNE_TARGET: float = 0.70` (objetivo de reducción al 70%)
6. **Endpoints y Monitoreo:**
   - `POST /api/v1/mobility/video/prune-evidence`: Endpoint administrativo para forzar o auditar el proceso de limpieza.
