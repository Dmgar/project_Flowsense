# FlowSense · producto implementado

**Ampliación actual:** 69 cámaras en siete zonas, 44 imágenes comprobadas y red
regional real de 18.946 nodos / 40.529 tramos. El detalle vigente está en
[REGIONAL_EXPANSION_PLAN.md](REGIONAL_EXPANSION_PLAN.md); los datos de ocho
cámaras y del grafo pequeño que aparecen más abajo describen la entrega inicial.

Entrega local: 15 de octubre de 2026. Se conservaron los cambios de integración
anteriores y la identidad de fondos claros, verde, ámbar y rojo suave.
La nueva aplicación vive en `frontend/src/product/`; usa el backend existente
para el grafo y las rutas, y añade contratos para cámaras, observaciones y casos.

## Módulos y aceptación

| Referencia / módulo | Ruta | Resultado funcional |
| --- | --- | --- |
| Vista general y mapa urbano | `/overview`, `/map` | Cartografía real; capas; cámaras y señales clicables; búsqueda y contexto |
| Evidencia de cámara | `/cameras/:id` | Imagen pública, HLS donde existe, detección alineada, clases, score por detección, conteos instantáneos, mezcla y estado |
| Inventario | `/cameras` | Ocho fuentes Caltrans, filtros, conexión HTTP/RTSP/webcam, validación de una imagen antes de guardar |
| Corredores | `/corridors/harbor` | Selección de tramo real, comparación ilustrativa, gráficos, mezcla y siguiente comprobación |
| Puntos críticos | `/hotspots` | Clasificación, filtros, detalle asociado, evidencia y creación de caso |
| Señales de riesgo | `/risk-signals` | Cola, mapa sincronizado con filtros, score ausente si no existe, revisión manual y bitácora |
| Flujo peatonal | `/pedestrians` | Zonas, presión ilustrativa, demanda, modos, gráficos y enlace a evidencia |
| Emergencias | `/emergency-corridor` | Origen/destino por formulario o mapa, cálculo real, dos alternativas, selección de ruta y cámaras próximas |
| Reportes | `/reports` | Casos con procedencia, CSV, PDF directo, impresión y analítica CSV de presentación |
| Storyboard | `/storyboard` | Pipeline interactivo y recorrido guiado de siete pasos |
| Configuración | `/settings` | Modo de datos, perfil de red, fuentes, cobertura y conexión de cámara |

La navegación mantiene URL e historial. El menú móvil y los filtros se adaptan a
390 px; se comprobó ausencia de desbordamiento horizontal de página. Las tablas
tienen su propio desplazamiento. Se respetan preferencias de movimiento reducido.

## Fuentes y límites

- California, Downtown Los Angeles: ocho imágenes Caltrans comprobadas por HTTP y
  decodificadas por OpenCV. No se requiere cuenta, compra ni API key.
- Wilshire Blvd: reproducción HLS comprobada en navegador a 1280 x 720, con
  `readyState=4`, tiempo de reproducción avanzando y sin error de video.
- Red OSM descargada: 3.123 nodos y 8.708 tramos, dentro del bbox
  oeste -118.30, sur 34.015, este -118.22, norte 34.075.
- OpenCV DNN con YOLOv8n ONNX produce detecciones reales por fotograma, incluyendo
  autos, motos, buses, camiones, bicicletas y peatones. La confianza de un objeto
  no se convierte en probabilidad de un incidente.
- Los conteos son instantáneos. No se inventan velocidad, aforo horario, ocupación
  real de carriles, cumplimiento semafórico, conflictos confirmados ni una base
  histórica. Las vistas de presentación distinguen esos ejemplos de observaciones.
- La hora registrada es la consulta de FlowSense; Caltrans no aporta en este
  contrato una hora de captura fiable. Sus imágenes se actualizan aproximadamente
  cada dos minutos y la fuente puede dejar de responder.
- La sesión mantiene hasta 60 observaciones por cámara en memoria, con el
  fotograma asociado a cada detección. No hay archivo histórico de Caltrans.
  Reiniciar el servicio elimina ese historial; los casos y referencias persisten.
- Las imágenes públicas no se presentan como anonimizadas. No se identifica a
  personas o matrículas y no hay un flujo de vigilancia individual.
- Los casos no controlan infraestructura ni despachan unidades. Una ruta calculada
  no es una garantía de llegada; sus tiempos usan velocidades del grafo y el
  score de continuidad mide solapamiento y desvío, no probabilidad de éxito.

Fuentes oficiales y detalles: [PUBLIC_CAMERAS.md](PUBLIC_CAMERAS.md).
El modelo local proviene del espejo usado por el descargador del repositorio:
`https://huggingface.co/Kalray/yolov8/resolve/main/yolov8n.onnx`.

## Casos y contratos

Los casos se guardan en SQLite por perfil de ciudad. Las transacciones serializan
creación y revisión; abrir repetidamente la misma señal devuelve el mismo caso.
Las transiciones permiten crear, asignar, revisar, confirmar y resolver, o descartar
antes de confirmar. Un caso cerrado no se modifica. Las notas y el equipo se
registran en cada paso; las transiciones inválidas responden HTTP 409.

Desde una imagen real se puede abrir una revisión de evidencia. Se conservan
`evidence_camera_id` y `evidence_frame_id`, con procedencia `observation`. Los
casos ilustrativos tienen procedencia `presentation` y se separan en las colas.

Contratos nuevos bajo `/api/v1/mobility`:

- `GET/POST /cameras`: catálogo y conexión comprobada.
- `GET /cameras/:id/snapshot`: JPEG; `frame_id` recupera un fotograma de sesión.
- `GET /cameras/:id/observation`: detecciones normalizadas, conteos, tamaño,
  procedencia y estado de inferencia. Campos no medidos son `null`.
- `GET /cameras/:id/history`: observaciones de la sesión.
- `GET/POST /cases`, `PATCH /cases/:id`: casos y revisión.
- `GET /reports/cases.csv`, `GET /reports/cases.pdf`: exportación con procedencia.

Las URLs de conexión admiten imagen HTTP(S), RTSP o índice de webcam del equipo
servidor. Se rechazan protocolos de archivo y credenciales incrustadas. Una
conexión fallida no se guarda. No se verificó una webcam física ni una fuente RTSP
privada, al no disponer de una; su transporte comparte la lectura OpenCV y tiene
tiempos de espera definidos para RTSP.

## Verificación ejecutada

| Comprobación | Evidencia |
| --- | --- |
| Suite backend | 89 pruebas aprobadas, sin advertencias de pytest |
| Integración LA real | Imagen pública, inferencia OpenCV, JPEG asociado, rutas y alternativas, revisión completa en DB temporal, CSV y PDF: aprobados |
| Frontend | TypeScript/Vite y oxlint sin errores ni advertencias |
| Dependencias frontend | `npm audit`: 0 vulnerabilidades; se actualizó `source-map-js` |
| Dependencias Python | `pip check`: sin dependencias rotas |
| Rendimiento de entrega | Gráficos y HLS se cargan bajo demanda; aplicación principal 476 kB. Vite avisa del módulo HLS de 575 kB, descargado solo al abrir video |
| Navegador | Mapa, cámara con cajas reales, HLS, corredores, peatones, cola, revisión desde cámara, caso persistido y PDF descargado |
| Móvil | 390 x 844; menú, galerías, evidencia y cola; ancho de página 390 px |
| PDF | Exportación A4 renderizada e inspeccionada; texto, fuente y bitácora legibles |
| Lanzador Windows | Sintaxis y ejecución verificadas, HTTP 200 de API y frontend |

La suite de fixtures antiguos está fijada a Manhattan por sus coordenadas.
La prueba adicional de LA se ejecuta mediante
`python -m scripts.verify_los_angeles_integration` y usa bases temporales.
No modifica ni confirma incidentes del operador. Los casos conservados en el
producto de prueba se describen expresamente como pruebas funcionales.

## Arranque y entrega

Primera preparación: `scripts/run_flowsense.ps1 -Setup`.
Después: `scripts/run_flowsense.ps1`.
Producto: `http://127.0.0.1:3001/overview`.
API: `http://127.0.0.1:8002/docs`.

El perfil de servidor por defecto del código conserva Manhattan para compatibilidad;
el lanzador selecciona expresamente Los Angeles. Un backend de otra ciudad no
debe reutilizarse para este producto. Los perfiles Cartagena y Manhattan siguen
disponibles para sus flujos anteriores.

Los archivos de referencia entregados se conservaron en `docs/product-reference/`.
Capturas y reporte de ejemplo: `output/screenshots/` y `output/pdf/`, excluidos de Git.
Las modificaciones permanecen locales; no se hizo commit, push ni despliegue remoto.
