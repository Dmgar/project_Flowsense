# Exploración de calles y contraste de evidencia

15 de octubre de 2026. Etapa posterior a la expansión regional y las favoritas.

## Objetivo de producto

El recorrido principal pasa de buscar un lugar a encontrar fuentes, ver su
contexto y contrastar observaciones antes de abrir una revisión. Mantiene los
mapas, cámaras, corredores, señales y reportes existentes, con la paleta verde.
Se apoya en el brief y las pantallas de `docs/product-reference/`.

La función diferencial implementada es una mesa de evidencia para operadores:
reúne hasta cuatro puntos, sus fotogramas, conteos y fechas de consulta. No se
afirma superar a un servicio de navegación ni medir congestión sin calibración.

## Catálogo ampliado y renovado

Se conservaron los 69 IDs y URLs de imagen anteriores y se añadieron 17 fuentes,
todas con imágenes comprobadas, hasta llegar a 86 ubicaciones y 61 imágenes
distintas utilizables en esta revisión.

| Zona | Registradas | Imágenes comprobadas |
| --- | ---: | ---: |
| Los Angeles | 32 | 27 |
| Santa Monica | 8 | 1 |
| Burbank | 10 | 6 |
| El Monte | 6 | 1 |
| West Covina | 5 | 5 |
| Norwalk | 9 | 5 |
| Long Beach | 16 | 16 |
| Total | 86 | 61 |

Hay 71 URLs oficiales de video registradas. Solo cuatro listas HLS respondieron
correctamente durante la comprobación masiva; los fallos temporales ya no eliminan
la URL. Esto no equivale a 71 videos operativos. La galería y el explorador ofrecen
el filtro de listas comprobadas, y la evidencia permite intentar una URL con un
aviso explícito cuando no respondió. El detalle de cada intento está en
`data/public_cameras_verification.json`.

## Buscar una calle

- La búsqueda de la cabecera permite abrir todos los resultados en `/explore`.
  Enter abre el explorador; las sugerencias individuales siguen disponibles.
- Reconoce calles, abreviaturas, ciudades, rutas y nombres del catálogo. Por
  ejemplo, `Western Avenue`, `Western Ave` y `avenida Western` son compatibles.
  La ruta `I-110` no coincide con `I-10` por una subcadena numérica.
- Busca además nombres en la red real de OpenStreetMap y resalta sus tramos.
  Calcula la distancia mínima entre cada cámara y los segmentos de la calle,
  con radios de 500 metros, 1,5 kilómetros o 3 kilómetros.
- Distingue coincidencias del catálogo y cámaras por proximidad. Una cámara
  cercana no garantiza visibilidad de la calle o del incidente.
- La consulta se conserva en la URL para recargar, volver atrás y compartir
  el enlace de búsqueda. Los filtros de ciudad, radio y formato son de la vista.
- Los resultados y el mapa están vinculados: Ubicar enfoca el punto; el marcador
  permite abrir evidencia. Pulsar una vía con nombre inicia su búsqueda.
- Se cargan doce tarjetas inicialmente y se pueden solicitar más. La geometría
  de búsqueda se memoriza independientemente de los estados de las cámaras.

La búsqueda usa el catálogo y el grafo descargado. No es un geocodificador de
direcciones postales y no cubre todas las calles residenciales de la región.

## Dos vistas cartográficas

El explorador ofrece calles de OpenStreetMap y relieve de OpenTopoMap. Las
atribuciones permanecen visibles. Si falla el relieve, vuelve a calles con un
aviso. Se comprobó una tesela de relieve con HTTP 200 e imagen PNG.

Los mapas del explorador y de la mesa muestran la red de forma neutra, sin la
coloración ilustrativa de congestión del escenario. Se conservan el zoom,
agrupación, selección, vista ampliada y salida con Escape.

Fuente: [OpenTopoMap](https://github.com/der-stefan/OpenTopoMap). Su proyecto
advierte que las teselas raster son una tecnología anterior a su transición a
vectores; se dispone de retorno al mapa base si el servicio deja de responder.

## Mesa de observación

- Se añaden o retiran hasta cuatro cámaras desde el explorador o la evidencia.
  Los IDs elegidos se conservan localmente en el navegador.
- La mesa solicita observaciones con un máximo de dos tareas concurrentes.
  Cada tarjeta conserva la hora de consulta, imagen exacta y conteos por clase.
- Un aviso del proveedor o la falta de inferencia no se convierte en cero.
  Si una consulta falla, se identifica la interrupción y se conserva la última
  observación disponible con su fecha.
- Actualización manual o automática cada dos minutos. La automática se pausa
  mientras la pestaña está oculta; salir de la mesa cancela solicitudes pendientes.
- Compara el conteo de vehículos de dos consultas de la misma cámara, cuando
  ambas tienen datos. No lo interpreta como velocidad o duración de un incidente.
- El mapa presenta los puntos elegidos. La evidencia individual conserva el flujo
  de apertura de casos y revisión humana.
- Exporta JSON con las fuentes, coordenadas, observaciones, errores y contexto.
  Las consultas no son capturas simultáneas y sus conteos no son un aforo sumable.

Las imágenes de sesión permanecen en memoria del backend. Si vence su ventana o
se reinicia el servicio, la mesa permite solicitar otra observación; el JSON
exportado no constituye un archivo de video ni incluye los bytes de las imágenes.

## Reproducción y continuidad

El reproductor utiliza un búfer moderado y prioriza la variante de menor ancho de
banda por defecto. Permite calidad automática, volver al punto directo y
reconectar. Muestra el estado y el último fotograma como portada mientras carga.

Se entrega el worker oficial de HLS.js como recurso local y se configura su ruta
explícitamente. La distribución ESM no lo incrusta automáticamente; este cambio
permite procesar el transporte del video fuera del hilo que atiende el mapa y
los controles. Se conserva la biblioteca completa para mantener los códecs.

Se añadieron dos intentos de recuperación acotados para errores de red o medios,
vigilancia de avance, retorno a imagen periódica y mensajes ante 403/404.
El tiempo con la pestaña oculta y las pausas voluntarias no agotan el plazo de
carga. La recuperación vuelve a disponer de presupuesto tras treinta segundos
de reproducción estable. Las solicitudes de la interfaz tienen un límite de
veinticinco segundos, incluida la recepción del cuerpo de la respuesta. El
proveedor sigue determinando la continuidad de la señal. Las fuentes sin video
se describen como imágenes periódicas, sin simular movimiento.

Tras un fallo se sugieren hasta tres cámaras con video registrado, en un radio
aproximado de diez kilómetros. No se garantiza que vean el mismo lugar o que su
video esté operativo en ese momento.

Documentación: [recuperación de medios de HLS.js](https://hlsjs.video-dev.org/api-docs/hls.js.hls.recovermediaerror)
y [posición de sincronización](https://hlsjs.video-dev.org/api-docs/hls.js.hls.livesyncposition).

## Verificación y límites

- Pruebas unitarias de búsqueda, distancias, alternativas, límite de selección,
  preferencias y enlaces. Se ejecutan con `npm test` y Node 24.
- Veinte pruebas frontend y 95 backend aprobadas.
- TypeScript/Vite y lint. Los módulos nuevos se cargan bajo demanda para reducir
  el código inicial; el aviso de tamaño de HLS sigue siendo una advertencia.
- `node scripts/verify_evidence_explorer.mjs` consulta la API real y comprueba
  búsquedas sobre 40.529 tramos. Tras renovar el catálogo encontró cuatro cámaras
  para Western Avenue, diecisiete para I-110 y cinco por proximidad a Central Avenue.
  Los resultados pueden cambiar al actualizar el catálogo.
- La mesa se comprobó mediante `scripts/verify_observation_desk.py`: cuatro
  fuentes de Los Angeles, Burbank, West Covina y Long Beach devolvieron imágenes
  exactas y análisis OpenCV, con un máximo de dos consultas concurrentes.
- Se consultaron listas HLS y recursos dependientes de Burbank y West Covina,
  con respuestas HTTP 200 y cabecera CORS abierta. Una fuente de Santa Monica
  devolvió 403 y una de Long Beach agotó el tiempo de espera. Esto no certifica
  reproducción de todos los segmentos ni compatibilidad en cada navegador.
- Se completó revisión visual del explorador y la mesa en escritorio y a 390 px.
  Búsqueda, selección, límite de cuatro y descarga JSON comprobados. La prueba
  de Western Ave mostró retorno a imagen tras falta de progreso de video.
  Después, I-110 (188) 1st St reprodujo video público real con pausa y reconexión.
  El corte y recuperación se verificaron con HLS sintético. Los límites de esa
  comprobación constan en GOAL_COMPLETION_AUDIT.md.

## Próximas mejoras con evidencia requerida

1. Ampliar compatibilidad en los navegadores de destino, incluyendo retorno
   desde segundo plano y fallo de teselas; la revisión de los módulos está hecha.
2. Definir retención y muestreo si se requieren series históricas propias.
3. Calibrar cámaras y carriles antes de ofrecer velocidades, colas o aforos.
4. Validar con operadores qué conjuntos de cámaras permiten revisar un corredor
   con menos pasos y sin atribuir causas sin evidencia.
