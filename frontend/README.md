# FlowSense Frontend

React 19, TypeScript, Vite 8, Tailwind CSS, Leaflet and Zustand.

## Active application and shared state

`src/App.tsx` mounts `product/Shell.tsx`. The product shell mounts
`components/DataInitializer.tsx` and `hooks/useTelemetrySocket.ts`.
`product/CityMap.tsx`, `product/Screens.tsx` and `product/EvidenceExplorer.tsx`
read the shared `store/useStore.ts` for road edges, graph status and routes.
Telemetry updates that same store, so route and traffic updates reach the active view.
`product/store.ts` holds workspace preferences, camera selection and case data;
it does not replace the routing store. The classic components remain available
but are not the main application.

Both `api/client.ts` (routing) and `product/api.ts` (mobility) use `api/urls.ts`.
This also resolves telemetry, backend camera media and report download URLs.
Product API availability and telemetry connection status are tracked separately.
The product presentation data remains illustrative; this configuration does not
convert it into observed telemetry or replace its Los Angeles-specific content.

## Local development

```powershell
cd frontend
npm ci
npm run dev
```

Vite listens on port 3001. With no configuration, `/api` and `/ws` proxy to
`http://127.0.0.1:8002`.

- `FLOWSENSE_API_URL`: server-side proxy target, including hostname and port.
- `FLOWSENSE_API_PORT`: local proxy port fallback (default: 8002).
- `VITE_API_URL`: browser-facing HTTP API base, also used to derive the
  `ws://` or `wss://` telemetry URL. Leave empty for same-origin proxying.
  A separate API origin must permit the frontend origin through backend CORS.

Proxy target precedence is `FLOWSENSE_API_URL`, then `VITE_API_URL`, then
`http://127.0.0.1:$FLOWSENSE_API_PORT`. Restart Vite after changing environment
settings. For a static build, `VITE_API_URL` is embedded at build time; an empty
value requires the deployment server to forward `/api` and `/ws`.
See `.env.example` for local settings.

From the repository root:

```powershell
# Cartagena API, default port 8002; then run Vite in the same terminal.
./scripts/run_cartagena_pilot.ps1 -ApiPort 8002
Push-Location frontend
npm run dev -- --host 127.0.0.1
Pop-Location

# General launcher: Los Angeles API on 8002 and frontend on 3001.
./scripts/run_flowsense.ps1 -Setup -ApiPort 8002 -WebPort 3001
```

Both launchers select the requested API port through `FLOWSENSE_API_URL` and
clear inherited `VITE_API_URL` so HTTP and WebSocket use the same proxy.
Use separate ports for simultaneously running city profiles. The Cartagena
launcher configures API connectivity; the current product presentation still
contains Los Angeles-specific defaults and labels.

## Production Docker & Cloud

From the repository root:

```bash
docker compose up --build
```

The production `frontend/Dockerfile` uses a multi-stage Nginx build (`< 15 MB RAM`).
It serves the compiled Vite SPA on port 80 (and port 5173 for backwards compatibility)
and reverse-proxies `/api`, `/docs`, `/openapi.json` and `/ws` to `http://backend:8000`.
See [AWS Cloud Deployment & Operational Runbook](../docs/AWS_DEPLOYMENT.md) for AWS EC2 details.

## Language

The supplied FlowSense logo and the neutral/blue palette are documented in
[Branding](../docs/BRANDING.md). The shared mark is used across application shells,
loading views, print output and downloadable reports.

All application-owned interface text, accessibility labels, notifications,
illustrative scenarios and report labels use English. Dates and numbers use
`en-US`. Geographic names, source names and operator-authored case history
retain their original values. Legacy period preferences recover their English
labels while preserving saved cameras, layers and working mode.

## Checks

The header and Settings provide a saved light/dark appearance preference for all
product modules. See [Frontend reliability](../docs/FRONTEND_RELIABILITY.md) for
the interaction fixes and verification scope.

```powershell
npm test
npm run build
npm run lint
```
