# Verificación manual de HLS

La entrada de desarrollo `/playback-qa.html` monta el mismo `PublicVideoPlayer`
de la aplicación con un patrón sintético. No usa el catálogo y no acredita
disponibilidad de ninguna cámara pública. El build de Vite conserva `index.html`
como única entrada de producción; el verificador no aparece en la navegación.

1. Instala FFmpeg en PATH o, únicamente para desarrollo, `pip install imageio-ffmpeg`.
2. Ejecuta `python scripts/run_playback_qa.py` desde la raíz. Genera 180 segundos
   de patrón H.264/HLS en `output/playback-qa` y sirve exclusivamente esos archivos
   desde `127.0.0.1:8003`. Detén el proceso con Ctrl+C al terminar.
3. Con el frontend local en `127.0.0.1:3001`, abre `/playback-qa.html`.
4. Comprueba movimiento y avance temporal. Pulsa Espacio sobre el video para
   pausar; espera más de 35 segundos y comprueba que permanece en pausa.
5. Reanuda, prueba Reconectar y confirma nuevo avance real.
6. Interrumpe la fuente con el botón de la página. El buffer puede seguir
   reproduciéndose unos segundos. Comprueba recuperación limitada y retorno
   con mensaje cuando se agotan los intentos. Restaura y abre una nueva sesión.

Los controles de interrupción solo existen en el servidor local de prueba. No
interrumpen Caltrans, el backend ni las cámaras. El servidor rechaza rutas ajenas
a sus listas y segmentos HLS y no acepta URLs arbitrarias.

## Resultado del 15 de octubre de 2026

Reproducción, pausa mantenida 44 s, reconexión, corte con HTTP 503 y nueva sesión
tras restauración comprobados en el navegador integrado. El corte detectó y
permitió corregir un salto erróneo a liveSyncPosition en VOD y una búsqueda de
posición sin límite temporal. La repetición mostró retorno controlado al aviso.
Capturas: output/screenshots/playback-local-running.png y playback-local-cut.png.
Estas comprobaciones son del componente con una fuente sintética. Por separado,
I-110 (188) 1st St reprodujo video público real de 1280 px con avance temporal,
pausa y reconexión; véase GOAL_COMPLETION_AUDIT.md. Western Ave y Roscoe agotaron
la conexión en la revisión correspondiente. No se extiende el resultado de una
señal al catálogo completo.

La página muestra un historial de visibilitychange real. Para revisar segundo
plano debe aparecer visible → hidden → visible tras cambiar de pestaña en un
navegador que emita esos eventos. El navegador integrado mantuvo visible durante
la revisión; ese caso queda sin certificación manual.
