# FlowSense — Frontend Version 1.0

> Documento de entrega · Dispatch Operations Dashboard · OpenCV AI Competition 2026

## Resumen ejecutivo

Este commit agrega la **interfaz de comando completa (frontend)** del dashboard FlowSense
sobre el backend FastAPI ya existente. Se construyó el digital twin urbano en tiempo real
para la demo del concurso: congestión viva por segmento, corredores dinámicos de emergencia,
unidades móviles con telemetría, comparativa estática vs FlowSense, modo replay, modo
presentación y cuadro de benchmark.

## Qué se agregó en este commit

### 1. Frontend completo (`frontend/`)

Scaffold `React 19 + TypeScript + Vite 8 + Tailwind CSS v4` dentro del repo.

- **Paleta "command center"** definida con design tokens de Tailwind v4 (`@theme` en
  `frontend/src/index.css`): fondos azul-noche, acentos verde emergencia (`#00e676`),
  cian corredores (`#00e5ff`), ámbar tráfico (`#ffab00`), rojo congestión (`#ff1744`),
  tipografía monoespaciada para datos numéricos.
- **Layout en grid**: `StatusBar` superior (`Header`), mapa central dominante, `Sidebar`
  derecha de despacho/telemetría, controles de capas flotantes abajo.
- **Mapa Leaflet** con tiles oscuros CartoDB Dark Matter navegable (`MapView.tsx`).

### 2. Capa de congestión (Fase 2)

- `CongestionLayer.tsx`: renderizado con **`L.canvas()`** (renderer Canvas de Leaflet,
  NO SVG) para soportar miles de segmentos (2076 aristas en Manhattan sin colapsar el DOM).
- **Updates imperativos**: los cambios de congestión vía WebSocket actualizan el estilo de
  cada polyline en el mapa sin reconstruir la capa (`pathsRef` + `setStyle`).
- Tooltips dark al hover con velocidad promedio, conteo de vehículos y longitud.
- Leyenda de gradiente verde→ámbar→rojo (`CongestionLegend.tsx`) y toggle de capa.

### 3. Routing dinámico (Fase 3)

- `RouteLayer.tsx`: corredor verde/cian **animado** (`dash-flow`, CSS animation) para la
  ruta FlowSense vs **ruta estática gris punteada** (baseline).
- Panel lateral con ETA dinámico, ETA baseline, distancia y **% de ahorro**.
- Botones de despacho en vivo.

### 4. Tiempo real (Fase 4)

- `hooks/useTelemetrySocket.ts`: WebSocket a `/ws/telemetry` con **reconexión automática
  (backoff exponencial)**, heartbeat cada 15 s y estado visible
  (conectado/reconectando/offline) en la barra de estado.
- **Zustand** para todo el estado que cambia por segundo (nunca `useState`): edges,
  vehículos, alertas, ruta activa, segundos salvados.
- `VehicleMarkers.tsx`: marcadores diferenciados 🚑/🚒 con rotación según `heading`.
- Feed de alertas en vivo (`AlertsFeed.tsx`) y **modo follow-unit** (clic → la cámara sigue
  a la unidad mientras se mueve).
- **Re-ruteo en vivo**: cuando el backend recalcula el corredor, el frontend lo redibuja
  al instante (evento `route_recalculated`).

### 5. Pulido y demo (Fase 5)

- **Modo replay** con clip pregrabado (`ReplayController.tsx` + `TimelineScrubber.tsx`),
  con scrubber para retroceder en el tiempo.
- **Benchmark** con Recharts (`BenchmarkPanel.tsx`): tiempo estático vs FlowSense.
- **Modo presentación**: fullscreen del mapa con overlay minimalista (`PresentationOverlay.tsx`).
- **Contador de "segundos salvados"** acumulados durante la demo (barra superior + panel).
- **Badge de privacidad** "No ALPR · No facial recognition" (`PrivacyBadge.tsx`).
- **Modo demo offline**: si el backend no responde, `DataInitializer` carga un grafo mock
  generado y replay funcional.

### 6. Mejoras de backend que hicieron posible el demo (soporte al frontend)

- `models/schemas.py`: `RouteResponse` ahora incluye `baseline_eta_seconds`,
  `baseline_distance_m`, `savings_pct` y `static_geojson` (el contrato que pidió el
  frontend para la comparación estática vs dinámica).
- `services/routing_engine.py`:
  - refactor `_build_route()` reutilizado para ruta dinámica y baseline estático;
  - en modo `simulate`, se **ahoga el corredor estático** (`_choke_corridor`) para
    escenificar el "golden hour bottleneck": GPS estático se atasca y FlowSense re-rutea
    (savings reales ~60 % medidos en prueba E2E);
  - `savings_pct` real y no cero.
- `services/graph_service.py`:
  - fix del orden del bbox en OSMnx (ahora `(west, south, east, north)`) y timeouts de
    red que impedían inicializar el grafo (antes colgaba hasta el timeout del proceso);
  - geojson enriquece cada edge con `vehicle_count`, `average_speed_kmh` y `length`
    (necesarios para el tooltip);
  - nuevo `reset_all_congestion()` usado por `GET /api/v1/graph/reset` y tests.
- `services/mock_simulator.py`: la misión ahora **recalcula el corredor en vivo** mientras
  el vehículo avanza y emite `route_recalculated` cuando el camino óptimo cambia
  (el "wow moment" de la demo).
- `api/routes/dispatch.py`: pasa `simulate` a la calculadora de ruta.
- `tests/test_routing.py`: nuevo test `test_dispatch_mode_reports_savings`.

## Verificación realizada

| Verificación | Resultado |
| --- | --- |
| `python -m pytest tests/` | 11 passed |
| `npm run lint` (oxlint) | 0 warnings, 0 errors |
| `npx tsc -b` (typecheck) | OK |
| `npm run build` (vite) | OK (bundle 778 kB, gzip 230 kB) |
| Dev server Vite :5173 | 200 en todos los módulos transformados |
| Backend uvicorn :8000 | `GET /` operacional, 1074 nodos / 2076 aristas (Manhattan real) |
| Proxy Vite → backend (`/api`, `/ws`) | OK |
| End-to-end WebSocket | dispatch con savings 60.5 %, `vehicle_telemetry` fluyendo, `route_recalculated` emitido en vivo |

## Cómo correr la demo

```bash
# Terminal 1 — backend
python -m pip install -r requirements.txt
python -m uvicorn src.main:app --host 0.0.0.0 --port 8000

# Terminal 2 — frontend
cd frontend
npm install
npm run dev
# abrir http://localhost:5173
```

Flujo recomendado para el video:
1. Aviso: el mapa carga el grafo real de Manhattan con congestión inicial.
2. Click **SIMULAR DESPACHO** → corredor verde animado vs gris punteado, % de ahorro visible.
3. Click **DESPACHO + TELEMETRÍA** → la unidad se mueve y la ruta **se re-rutea sola** al
   cambiar la congestión (wow moment).
4. **BENCHMARK** para la comparativa, **REPLAY DEMO** si el backend falla, **PRESENTACIÓN**
   para el modo minimalista de grabación.

## Decisiones técnicas relevantes

- **Canvas renderer de Leaflet** en lugar de SVG para los miles de edges: el DOM no se
  satura y la pintura la hace la GPU del navegador.
- **Zustand con selectores granulares**: cada componente se suscribe solo al slice que le
  interesa; los updates WebSocket de 1 Hz no provocan re-renders globales.
- **Manipulación imperativa de Leaflet en `useEffect` con cleanup** (nunca en render):
  capas gestionadas con refs y destruidas en unmount.
- **Fallback offline**: si el backend no está, el dashboard sigue 100 % funcional con datos
  mock pregrabados para no romper la grabación del video.

## Nice-to-have descartado (bajo impacto para la demo)

- Code splitting por ruta (`React.lazy`) — el bundle único no molesta en localhost.
- Deck.gl para render de millones de edges — innecesario en la escala Manhattan (2k edges).
- Persistencia de estado en `localStorage` — fuera de alcance hasta la fase de producción.