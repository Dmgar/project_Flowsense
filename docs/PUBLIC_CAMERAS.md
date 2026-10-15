# Cámaras públicas para FlowSense

**Etapa vigente:** 86 cámaras registradas y 61 imágenes distintas comprobadas en
la revisión más reciente. Incluye explorador de calles, mesa de observación y
recuperación de video. Consulta [EXPLORER_AND_OBSERVATION_DESK.md](EXPLORER_AND_OBSERVATION_DESK.md).
Los recuentos anteriores de 69 u ocho fuentes se conservan como registro de las
entregas previas. La disponibilidad de video se distingue de la de imagen.

**Expansión anterior:** 69 fuentes en siete zonas del Gran Los Angeles; 44 imágenes
comprobadas y 40 listas HLS válidas durante la ampliación del 15 de octubre de
2026. Consulta el [plan de expansión regional](REGIONAL_EXPANSION_PLAN.md) para
los recuentos, estados y método de verificación actuales. La sección siguiente
documenta la selección inicial de ocho fuentes que se preservó.

El perfil de presentación estadounidense utiliza **Downtown Los Angeles, California**, con ocho cámaras oficiales de Caltrans del distrito 7. No se requiere cuenta, contraseña, API key ni pago para consultar el catálogo, las imágenes y las listas HLS verificadas.

## Fuentes oficiales

- [Documentación CCTV de Caltrans](https://cwwp2.dot.ca.gov/documentation/cctv/cctv.htm): autoriza la integración de los archivos de datos en aplicaciones y declara que su uso no tiene costo.
- [Catálogo JSON del distrito 7](https://cwwp2.dot.ca.gov/data/d7/cctv/cctvStatusD07.json): nombres, identificadores, ubicación WGS84, URLs de imágenes y video.
- [Definición de campos](https://cwwp2.dot.ca.gov/documentation/cctv/cctv-field-description.htm): la frecuencia de actualización de imagen se expresa en minutos; `recordTimestamp` indica modificación del registro, no captura del fotograma.
- [QuickMap oficial](https://quickmap.dot.ca.gov/): consulta pública del mapa y las cámaras.
- [Condiciones de uso](https://dot.ca.gov/conditions-of-use) y [privacidad](https://dot.ca.gov/privacy-policy).

## Verificación

Se comprobaron por HTTP las ocho imágenes de `data/public_cameras_los_angeles.json`: respuesta 200 y MIME `image/jpeg`, sin autenticación. El catálogo informa actualizaciones de imagen cada dos minutos; la disponibilidad puede cambiar. Una descarga exitosa no acredita que el equipo esté capturando continuamente ni que la imagen esté actualizada.

Las cámaras I-110 Wilshire Blvd y I-110 7th St también respondieron con listas HLS válidas (`#EXTM3U`, 1280×720). Esto verifica la lista pública, pero la reproducción completa y su compatibilidad requieren comprobación en el reproductor. Dos URLs HLS adicionales no respondieron durante la comprobación; deben usar imágenes como alternativa.

Los identificadores `caltrans-d7-<index>` conservan el índice único del catálogo oficial dentro del distrito. Las coordenadas se toman del catálogo, sin geocodificación inventada.

## Presentación honesta y privacidad

Presentar imágenes como **imagen pública actualizable**, sin simular movimiento, tiempo de captura ni video continuo. Las métricas de un escenario reproducible deben identificarse como simuladas y no atribuirse a estas cámaras hasta que una inferencia real las produzca. No afirmar anonimización de rostros o matrículas si no está implementada y verificada.

Caltrans declara que sus videos e imágenes CCTV no se conservan ni archivan. La plataforma no debe prometer un archivo histórico del proveedor; cualquier evidencia almacenada por FlowSense necesita su propia política de retención. Las condiciones generales no garantizan exactitud o disponibilidad, y distinguen contenido propio de contenido de terceros. Mantener la atribución y el enlace a Caltrans.

## NYC evaluada

[NYC DOT](https://www.nyc.gov/html/dot/html/motorist/atis.shtml) publica imágenes fijas frecuentemente actualizadas y declara que no graba las cámaras. Sin embargo, `https://webcams.nyctmc.org/api/cameras/` y su sitio público agotaron el tiempo de conexión desde este equipo; por eso no se eligieron para el perfil funcional.
