# Auditoría del explorador de evidencia

15 de octubre de 2026. Implementación local revisada en navegador integrado.
La implementación principal está terminada. Esta auditoría distingue los flujos
verificados de las comprobaciones adicionales que no quedaron certificadas.

## Comprobado en pantalla

- Western Ave: cuatro resultados, dos por proximidad, 122 tramos resaltados;
  I-110: 17 resultados. Búsqueda desde la cabecera, selección con Ubicar y apertura de evidencia.
- Mapa de calles, relieve, agrupación de cámaras, ampliación y salida con Escape.
  En relieve se observaron doce teselas descargadas de OpenTopoMap.
- Mesa con cuatro cámaras: rechazo de una quinta sin sustituir fuentes, imágenes,
  conteos independientes, activación/desactivación de actualización cada dos minutos.
- Exportar contraste descargó un JSON válido con cuatro cámaras y sus horas de consulta.
- Explorador y mesa a 390 × 844: ancho de documento 390, sin desbordamiento horizontal.
  Ubicar desplaza el mapa a la vista; abrir desde estos espacios activa observaciones reales.
- Cámara Burbank I-5 (35) Western Ave: no hubo avance de video (tiempo 0,
  readyState 0, sin buffer). Se observó el retorno automático a la imagen periódica
  con aviso después de agotar la recuperación. No se certifica video continuo.

La pestaña anterior contenía una página interna de conexión rechazada. Una nueva
navegación HTTP normal permitió revisar la aplicación. Se retira la conclusión
anterior de que localhost estuviera globalmente bloqueado; no se eludieron controles.

## Evidencia técnica

- 22 pruebas frontend aprobadas: búsqueda, distancias, cuatro fuentes,
  persistencia, cancelación/plazos y diez escenarios de salud del reproductor.
- Compilación frontend aprobada; 95 pruebas backend aprobadas en esta etapa.
- Verificadores de búsqueda contra API/grafo y mesa con cuatro zonas aprobados.
- Catálogo: 86 registros, 61 imágenes distintas verificadas y 71 enlaces oficiales
  de video conservados. Un enlace registrado no equivale a transmisión disponible.
- Capturas en output/screenshots: explorer-western-desktop.png,
  observation-desk-desktop.png, explorer-mobile.png y desk-mobile.png.

## Verificación restante

La vuelta desde segundo plano y el fallo de teselas no se certificaron mediante
una interrupción real en navegador. La entrada de prueba registra visibilitychange;
al operar distintas pestañas del navegador integrado solo registró visible. No
se fuerza ese estado para presentarlo como una prueba real. Son límites de la
revisión manual; las pruebas automáticas de salud cubren la exclusión de pausa
y segundo plano. La disponibilidad continua de todos los proveedores tampoco
se certifica: tener un enlace oficial no garantiza recibir sus segmentos.

Los cambios de esta etapa permanecen locales y sin commit.

## Ampliación de la prueba de reproducción

Se añadió un servidor HLS sintético local y una entrada de desarrollo que usa el
mismo componente del producto (instrucciones en PLAYBACK_QA.md). Se observó avance
hasta 6,83 s, pausa a 7,01 s mantenida durante 44 s sin falsa alarma y reproducción
nueva tras Reconectar, hasta 8,63 s con readyState 4.

El corte controlado detectó un defecto: liveSyncPosition también podía dar una
posición en una lista VOD; el salto a una zona no descargada iniciaba una búsqueda
sin fin que desactivaba el control de bloqueo. Se corrigió para saltar únicamente
en listas en directo y dentro del buffer disponible. La búsqueda de posición
que no se completa dispone ahora de un plazo de 20 s por intento. Dos pruebas
adicionales reproducen estas condiciones. La repetición mostró consumo del buffer hasta 22,03 s, recuperación 1/2 y
retorno con aviso de solicitud incompleta; tras restaurar y abrir una nueva
sesión volvió a reproducir y avanzó hasta 54,10 s (readyState 4). La captura playback-local-cut.png
documenta el retorno.

Roscoe Boulevard también agotó la conexión directa al enlace oficial en 5 s.
Esto no afecta a las imágenes, que utilizan otro servidor del proveedor.

## Señal pública y persistencia comprobadas

I-110 (188) 1st St, caltrans-d7-cctv-1031: la lista oficial y su lista de segmentos
respondieron HTTP 200. En la aplicación el video de 1280 px avanzó de 10,63 a
24,44 segundos con readyState 4. La pausa mantuvo paused=true sin falsa alarma;
en una ventana HLS móvil la posición temporal puede cambiar aun estando pausado.
Tras reanudar y Reconectar se volvió a observar avance hasta 73,68 s con
readyState 4. Captura: output/screenshots/public-camera-playing.png. Esto acredita
esa sesión y esa cámara; otras aperturas pueden tener cortes del proveedor.

Una recarga real mantuvo el modo observado y el botón Guardada en favoritas
activado. Los conteos de fotograma se distinguen explícitamente del video.
