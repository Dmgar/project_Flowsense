# FlowSense — Frontend v1.1

Cambios incluidos en la versión **FrontEnd Version 1.1**.

## Qué cambió

| Cambio | Detalle |
| --- | --- |
| Dev server en puerto 3000 | El dev server de Vite corre ahora en `http://localhost:3000` (antes `:5173`), con `strictPort: true` para que nunca salte a otro puerto. |
| Proxy intacto | `/api` y `/ws` siguen proxyando a `http://localhost:8000` — no se tocó el backend. |
| README actualizado | `frontend/README.md` documenta el nuevo puerto. |

## Por qué 3000

- Es el puerto por defecto de React/CRA (y el más familiar para el jurado/demo).
- `strictPort: true` garantiza una URL fija `http://localhost:3000` para el video de la demo: si el puerto estuviera ocupado, Vite falla (en vez de coger silenciosamente el 3001 y romper la URL pactada).

## Cómo correr

```bash
# Terminal 1 — backend
python -m uvicorn src.main:app --host 0.0.0.0 --port 8000

# Terminal 2 — frontend
cd frontend
npm install
npm run dev
# abrir http://localhost:3000
```

## Verificación de esta versión

| Verificación | Resultado |
| --- | --- |
| `npm run lint` (oxlint) | 0 warnings, 0 errors |
| `npx tsc -b` (typecheck) | OK |
| `npm run build` (vite) | OK |
| Dev server `http://localhost:3000` | Responde 200, proxy `/api` y `/ws` → `:8000` operativo |

Sin cambios de backend en esta versión (commit únicamente de frontend + docs).