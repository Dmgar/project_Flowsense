# FlowSense — Dispatch Operations Dashboard (Frontend)

React + TypeScript + Vite + Tailwind CSS v4 + react-leaflet + Zustand.
Digital twin urbano en tiempo real para el OpenCV AI Competition 2026.

## Stack

| Domain | Technology |
| --- | --- |
| Framework | React 19 + TypeScript + Vite 8 |
| Styling | Tailwind CSS v4 (design tokens CSS-first) |
| Mapping | react-leaflet v5 + Leaflet 1.9 (renderer canvas) |
| State | Zustand (selectores granulares, cero re-renders masivos) |
| Charts | Recharts (benchmark) |
| Real-time | WebSocket `/ws/telemetry` con reconexión + heartbeat |

## Scripts

```bash
npm install
npm run dev        # dev server :5173 (proxy /api y /ws -> localhost:8000)
npm run build      # tsc -b && vite build
npm run lint       # oxlint
npm run preview    # sirve el build
```

## Requisitos

Backend FastAPI corriendo en `http://localhost:8000` (ver raíz del repo).
El frontend funciona también en **modo offline** con datos mock si el backend no responde.

## Estructura

```
src/
├── api/client.ts               # Cliente REST del backend
├── components/                 # Componentes del dashboard
│   ├── MapView.tsx             # Mapa Leaflet (CartoDB dark) + capas
│   ├── CongestionLayer.tsx     # Edges con canvas renderer, tooltips, updates imperativos
│   ├── RouteLayer.tsx          # Corredor dinámico animado + baseline gris punteado
│   ├── VehicleMarkers.tsx      # Marcadores de unidades (ambulancia/bombero) rotados
│   ├── Sidebar.tsx             # Despacho, ETA, comparación static vs FlowSense
│   ├── StatusBar.tsx           # Estado conexión, segundos salvados, ciudad
│   ├── AlertsFeed.tsx          # Feed de alertas en vivo
│   ├── LayerControls.tsx       # Toggles de capas, replay, presentación
│   ├── CongestionLegend.tsx    # Leyenda de gradiente
│   ├── BenchmarkPanel.tsx      # Gráfico Recharts static vs FlowSense
│   ├── PresentationOverlay.tsx # Modo presentación/fullscreen demo
│   ├── PrivacyBadge.tsx        # Badge Responsible AI
│   ├── TimelineScrubber.tsx    # Scrubber de replay
│   ├── ReplayController.tsx    # Motor de replay offline
│   └── DataInitializer.tsx     # Bootstrapping (grafo, status, sim, mock)
├── data/mock.ts                # Datos demo offline + benchmark
├── hooks/useTelemetrySocket.ts # WebSocket con heartbeat y backoff
├── store/useStore.ts           # Estado global Zustand
└── types/index.ts              # Contratos de API
```

## Contratos consumidos (backend)

| Endpoint | Uso |
| --- | --- |
| `WS /ws/telemetry` | `traffic_update`, `route_update`, `route_recalculated`, `vehicle_telemetry`, `mission_alert` |
| `GET /api/v1/graph/status` | Nodos/aristas de la ciudad |
| `GET /api/v1/graph/geojson` | Grafo urbano con propiedades de congestión |
| `POST /api/v1/graph/reset` | Reset de congestión |
| `POST /api/v1/dispatch/route?simulate=true` | Corredor dinámico + baseline + `savings_pct` |
| `POST /api/v1/dispatch/simulate/traffic/start\|stop` | Simulación de tráfico |