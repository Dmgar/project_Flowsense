# FlowSense — Frontend V3

Fecha: 15 de octubre de 2026. Rama de entrega: `main`.

Esta versión amplía el producto de movilidad existente con exploración por
calle, comparación de evidencia y un reproductor público con recuperación.
Conserva la identidad clara de tonos verdes y los módulos de mapa, cámaras,
corredores, puntos críticos, peatones, riesgos, emergencias y reportes.

## 1. Explorador de calles y cámaras

- Nuevo módulo **Explorar calles**, ruta `/explore`, accesible desde la navegación
  y desde la búsqueda global con Enter.
- Búsqueda por calle, autopista, cámara y ciudad; normalización de acentos,
  abreviaturas y números de ruta. `I-110` no se confunde con `I-10`.
- Cruce con nombres y geometrías del grafo real de OpenStreetMap: se resaltan
  los tramos encontrados y se calcula proximidad a los segmentos completos.
- Radios de 500 m, 1,5 km y 3 km. Se distinguen coincidencias del catálogo de
  cámaras próximas; cercanía no garantiza que una cámara vea esa calle.
- Resultados y mapa vinculados mediante selección, Ubicar y apertura de evidencia.
  Pulsar una vía con nombre inicia una búsqueda.
- Consulta conservada en la URL, navegación atrás y enlaces compartibles.
  Carga inicial de doce tarjetas y opción de mostrar más.
- Filtros por zona y disponibilidad registrada de imagen o lista de video.

La búsqueda usa el catálogo y el grafo descargado. No es un geocodificador postal
ni garantiza todas las calles residenciales de la región.

## 2. Mapas y diseño adaptable

- Mapas de calles OpenStreetMap y relieve OpenTopoMap con atribución visible.
  Si falla el relieve se vuelve al mapa de calles con aviso.
- Encuadre de cobertura y resultados, agrupación de cámaras cercanas, zoom,
  selección de tramos y vista ampliada con salida mediante Escape.
- Recalculo del tamaño del mapa con ResizeObserver para evitar vistas recortadas
  después de cambios de distribución.
- Explorador con cabecera compacta y espacio reservado al mapa en escritorio.
  En móvil, Ubicar desplaza el mapa a la vista.
- Estilos verdes, tarjetas, estados vacíos, avisos y controles coherentes con el
  producto existente. Explorador y mesa se cargan bajo demanda.
- Los espacios de observación muestran una red neutra. Los colores ilustrativos
  de tráfico se mantienen identificados como escenario de presentación.

## 3. Mesa de observación: contraste de evidencia

Nuevo módulo `/watch` para revisar hasta cuatro fuentes sin mezclar sus datos.

- Añadir y retirar cámaras desde el explorador o la evidencia. Una quinta cámara
  muestra un aviso y no reemplaza silenciosamente otra.
- Selección de IDs persistente en el navegador; imágenes de sesión en memoria.
- Máximo de dos consultas concurrentes para limitar carga de red e inferencia.
- Imagen exacta, conteos por clase y hora de consulta independientes por cámara.
- Actualización manual o automática cada dos minutos; suspensión automática en
  pestaña oculta y cancelación de solicitudes al abandonar la vista.
- Comparación entre consultas de una misma cámara cuando existen dos conteos;
  no se interpreta como velocidad ni duración de un incidente.
- Los errores se presentan por fuente. Se conserva la última observación y su
  fecha; falta de inferencia no se convierte en un conteo cero.
- Mapa de los puntos elegidos y exportación JSON de fuentes, coordenadas,
  observaciones, errores y contexto.

Es una herramienta para revisar evidencia antes de actuar. Las consultas no son
simultáneas, los conteos no constituyen aforo sumable y la exportación no archiva
video ni incluye los bytes de las imágenes.

## 4. Video público y recuperación

- Componente `PublicVideoPlayer` con HLS, worker empaquetado y alternativa nativa
  cuando el navegador la admite.
- Calidad orientada a estabilidad, calidad automática, Reconectar e Ir al directo.
  Buffer acotado para evitar acumulación innecesaria.
- Control de avance real del video, plazo inicial de carga y máximo de dos
  recuperaciones antes de volver a imagen periódica con explicación.
- Pausa manual, rechazo de autoplay y tiempo en segundo plano no se contabilizan
  como bloqueo de reproducción. La reproducción saludable restablece los intentos.
- Manejo explícito de errores de acceso, red y decodificación.
- Corrección de un bloqueo detectado con corte controlado: el salto a posición
  de directo solo se realiza en listas en vivo y dentro del buffer disponible.
  Una búsqueda de posición que no termina dispone de un límite temporal.
- Los conteos se identifican como pertenecientes al fotograma analizado, no al
  video en reproducción.

## 5. Cobertura metropolitana y catálogo

Se conservaron los 69 identificadores y URLs de imagen anteriores y se añadieron
17 fuentes. El resultado es un catálogo de **86 cámaras**, con **61 imágenes
distintas utilizables** en la revisión y **71 URLs oficiales de video conservadas**.

| Zona | Cámaras registradas | Imágenes comprobadas |
| --- | ---: | ---: |
| Los Angeles | 32 | 27 |
| Santa Monica | 8 | 1 |
| Burbank | 10 | 6 |
| El Monte | 6 | 1 |
| West Covina | 5 | 5 |
| Norwalk | 9 | 5 |
| Long Beach | 16 | 16 |
| **Total** | **86** | **61** |

Las fuentes proceden de Caltrans y no requieren credenciales en la aplicación.
Un enlace registrado no equivale a una transmisión disponible permanentemente.
La auditoría por fuente queda en `data/public_cameras_verification.json`.

El actualizador conserva referencias publicadas, maneja renumeraciones del
proveedor, valida IDs, URLs e imágenes distintas por región y escribe de forma
atómica para evitar sustituir el catálogo por una descarga parcial.

## 6. Favoritos, galería y continuidad

- Guardar y quitar favoritas desde galería y evidencia; accesos desde la vista
  general y filtro de favoritas en la galería.
- Resumen de cobertura por siete ciudades con accesos al mapa y estado de consulta.
- Ordenación de galería por favoritas/recientes, nombre o ciudad; paginación de
  doce tarjetas y restablecimiento de filtros.
- Estados que distinguen imagen disponible, aviso del proveedor, consulta antigua
  y fuente sin comprobar. El backend entrega antigüedad y vigencia.
- Contadores y revisiones coherentes con la ciudad seleccionada.
- Apertura desde explorador, mesa y mapas de observación en modo observado.
- Historial seleccionado por fecha de observación para resistir desplazamientos
  de la ventana de registros y fotogramas con contenido repetido.
- Solicitudes con plazo de 25 segundos, incluido el cuerpo de respuesta, soporte
  de cancelación y mensajes de error accionables. Se evitan consultas solapadas.

## 7. Pruebas y herramientas de desarrollo

- Suite frontend mediante `node --test`: búsqueda, geometría, límites de rutas,
  plazos y cancelación de API, selección persistente y salud del reproductor.
- CI con pruebas y compilación frontend en Node 24, junto a la suite backend en
  Python 3.13.
- `scripts/verify_evidence_explorer.mjs`: comprobación contra API y grafo regional.
- `scripts/verify_observation_desk.py`: imágenes y análisis de cuatro zonas.
- `scripts/run_playback_qa.py` y `/playback-qa.html`: HLS sintético local con corte
  y restauración controlados. Usa el mismo reproductor del producto. La entrada
  no forma parte de la compilación de producción ni aparece en la navegación.
- El patrón sintético está claramente identificado y no acredita cámaras públicas.
  FFmpeg o imageio-ffmpeg solo son necesarios para esta prueba de desarrollo.

## 8. Verificación realizada

| Comprobación | Resultado |
| --- | --- |
| Frontend `npm test` | 22 pruebas aprobadas |
| Frontend `npm run lint` | Sin errores |
| Frontend `npm run build` | Aprobada; advertencia de tamaño del módulo HLS |
| Backend `python -m pytest tests/` | 95 pruebas aprobadas |
| `git diff --check` | Sin errores de espacios; avisos de conversión CRLF |
| Explorador escritorio | Western Ave: cuatro cámaras; I-110: diecisiete resultados |
| Relieve | Doce teselas OpenTopoMap descargadas en navegador |
| Mesa | Cuatro fuentes, límite de selección, actualización y JSON descargado válido |
| Móvil a 390 × 844 | Explorador y mesa sin desbordamiento horizontal |
| Persistencia en navegador | Recarga conserva modo observado y favorita |
| Video público real | I-110 (188) 1st St: avance de video de 1280 px, pausa y reconexión |
| Corte HLS sintético | Recuperación limitada, retorno con aviso y reproducción tras restaurar |

Las capturas locales se guardaron en `output/screenshots/`, excluido del repositorio.
La revisión visual y las pruebas controladas están descritas con mayor detalle
en [GOAL_COMPLETION_AUDIT.md](GOAL_COMPLETION_AUDIT.md) y
[PLAYBACK_QA.md](PLAYBACK_QA.md).

## 9. Límites y siguientes comprobaciones

- La disponibilidad de Caltrans cambia. Algunas fuentes devolvieron errores o
  agotaron plazos; no se certifican 71 videos operativos ni continuidad permanente.
- No se certificaron manualmente un ciclo real de segundo plano y un fallo de
  teselas. El navegador integrado mantuvo visibilityState=visible entre pestañas.
- No se calculan velocidades, ocupación de carriles, colas o aforos reales sin
  calibración. Los indicadores de presentación siguen separados de observaciones.
- No existe un archivo histórico de video del proveedor. Para series históricas
  propias se requiere definir muestreo y retención.
- Sigue siendo necesaria una revisión de compatibilidad en los navegadores finales.

## 10. Archivos principales

| Área | Archivos |
| --- | --- |
| Explorador y búsqueda | `EvidenceExplorer.tsx`, `evidenceSearch.ts`, `Shell.tsx` |
| Contraste de fuentes | `ObservationDesk.tsx`, `store.ts`, `api.ts` |
| Mapas y diseño | `CityMap.tsx`, `evidence.css`, `product.css` |
| Reproductor y evidencia | `PublicVideoPlayer.tsx`, `playbackHealth.ts`, `CameraEvidence.tsx` |
| Cobertura y favoritos | `CoverageDashboard.tsx`, `cameraStatus.ts`, `Screens.tsx`, `ui.tsx` |
| Contratos | `types.ts`, `src/services/mobility_service.py` |
| Catálogo | `data/public_cameras_*.json`, `scripts/expand_public_cameras.py` |
| Calidad | `frontend/tests/`, `tests/`, `.github/workflows/ci.yml`, verificadores de `scripts/` |

Los archivos de interfaz de la tabla pertenecen a `frontend/src/product/`.
El documento V1.2 permanece como referencia histórica independiente.
