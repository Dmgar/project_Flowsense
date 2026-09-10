# FlowSense — Frontend v1.2

Cambios incluidos en la versión **FrontEnd Version 1.2**.

## Objetivo

Convertir el dashboard de desktop-first a un command center **completamente responsive
(móvil / iPad)** y reforzar el realismo de la demo con **animaciones** y polish de UX.

## Qué cambió

### 1. Responsive — celular y iPad

| Componente | Cambio |
| --- | --- |
| Layout general (`App.tsx`) | Altura `100dvh` con fallback `100vh`; padding de **safe-area** (`env(safe-area-inset-*)`) para notch iPhone / home indicator. |
| Sidebar | En escritorio mantiene `w-80`; en `<768px` deja de ser columna fija y su contenido se mueve a un **bottom-sheet deslizable**. Ahora muestra **SEGUIR** por unidad (toggle 🔒). |
| `MobileSheets.tsx` (nuevo) | Drawer inferior con backdrop borroso: hojas de **Despacho**, **Capas/Controles** y **Seguir Unidad** (tap fuera cierra). |
| `BottomDock.tsx` (nuevo) | Barra táctil inferior (solo móvil): Despacho · Capas · Replay · Bench · Seguir. |
| `StatusBar` | Compacta en móvil (logo + contador salvados); píldoras de status solo en desktop. |
| `LayerControls` | `hidden md:flex` (en móvil los controles viven en la hoja Capas). |
| Overlays | Anchos fijos → `w-[min(Xpx,calc(100vw-1rem))]`; Benchmark `h-40 md:h-56`; Alertas `max-h-40 md:max-h-56`; Legend sube sobre el dock móvil; PrivacyBadge solo `md+`. |
| `index.html` | `lang="es"`, `theme-color #0a0e17`, `viewport-fit=cover`, fuentes Inter + JetBrains Mono. |

### 2. Animaciones

| Qué | Dónde |
| --- | --- |
| Contadores con **count-up** (ETA, ahorro %, segundos salvados) | `useCountUp`, `RouteCard`, `ActiveRoutePanel`, `StatusBar` |
| **Pop** al subir segundos salvados | keyframe `pop-number` en StatusBar |
| **Glow underlay** + **dash animado veloz** en rutas recalculadas | `RouteLayer` (segunda polyline translúcida) |
| **Pulso** de segmentos críticos de congestión (opacity/weight) | `CongestionLayer` (intervalo 800 ms) |
| Rotación de heading **suavizada** (CSS transition) + **anillo pulsante y barrido radar** sobre la unidad seguida | `VehicleMarkers` |
| **BootSplash** con logos animados, líneas de arranque y shimmer | `BootSplash.tsx` (nuevo) |
| **Scanlines** + beam CRT en modo presentación | `PresentationOverlay` |
| Transiciones de entrada/backdrop en sheets y drawer | CSS + Tailwind |

### 3. Mejoras de UX y robustez

- **Bug corregido**: los dos botones del Sidebar hacían exactamente lo mismo. Ahora:
  `SIMULAR DESPACHO (FLOWSENSE)` → `simulate=true` (comparación con ahorro) y
  `RUTA ESTÁTICA (BASELINE)` → `simulate=false`.
- **Auto-follow**: tras despachar, la cámara sigue automáticamente a la primera unidad
  que emite telemetría.
- **Replay con velocidad x1/x2** y control central en el scrubber; el motor se resincroniza
  sin reiniciar el frame 0.
- **ErrorBoundary** global (`main.tsx`) con fallback "REINICIAR INTERFAZ".
- Eliminado el tipo muerto `TrafficSignalUpdate`.
- Tooltips de congestión ahora vinculados una vez (`bindTooltip`), mejor perf.

## Verificación

| Verificación | Resultado |
| --- | --- |
| `npm run lint` (oxlint) | 0 warnings, 0 errors |
| `npx tsc -b --noEmit` | OK |
| `npm run build` | OK |
| Dev server `http://localhost:3000` | HTTP 200; CSS nuevo servido correctamente |

## Archivos principales

- `src/App.tsx` — layout responsive + safe-area + dock/sheets
- `src/components/BottomDock.tsx`, `src/components/MobileSheets.tsx` — navegación móvil
- `src/components/BootSplash.tsx`, `src/components/ErrorBoundary.tsx` — carga y robustez
- `src/hooks/useMediaQuery.ts`, `src/hooks/useCountUp.ts` — nuevos hooks
- `src/components/VehicleMarkers.tsx`, `RouteLayer.tsx`, `CongestionLayer.tsx` — animaciones del mapa
- `src/components/ReplayController.tsx`, `TimelineScrubber.tsx` — replay con velocidad
- `src/index.css` — keyframes y utilities nuevas
- `index.html` — metas responsive/dark + fuentes

Sin cambios de backend en esta versión.