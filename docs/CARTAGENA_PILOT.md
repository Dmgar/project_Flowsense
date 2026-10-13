# FlowSense Cartagena: producto piloto

## Producto que se propone vender

FlowSense convierte observaciones de cámara, reportes de profundidad de agua y cierres confirmados en rutas de despacho que incluyen una ruta de respaldo. La propuesta comercial para Cartagena es continuidad de despacho durante inundaciones: los operadores pueden verificar el evento, registrar profundidad y hora, y ver qué rutas siguen accesibles para cada tipo de unidad. La herramienta registra tiempos de verificación, falsas alarmas y despeje para que una agencia mida un piloto con sus propios datos.

La ventaja defendible no es afirmar que ninguna otra empresa calcula rutas en vivo. El piloto debe demostrar la calidad local de sus datos, la coordinación entre despacho y reportes de campo, y resultados medidos con el Cuerpo de Bomberos, servicios de salud y operadores de movilidad. Los mapas oficiales de amenaza son una capa de planeación; este prototipo todavía no ingiere ni valida automáticamente esos mapas.

## Perfil de ciudad y fuentes

- La red vial de Cartagena se descarga de OpenStreetMap como grafo separado. Se aplica la licencia ODbL de OSM; consulta [copyright y atribución de OpenStreetMap](https://www.openstreetmap.org/copyright).
- La Alcaldía publica información del riesgo urbano y acciones de drenaje. Ver [mapas de amenazas y riesgos del POT](https://pot.cartagena.gov.co/normativa/anexo-dimension-ambiental/amenazas-riesgos-354) y [plan de canales de drenaje](https://www.cartagena.gov.co/noticias/paso-firme-contra-inundaciones-alcaldia-cartagena-busca-crear-12-canales-nuevos-para-fortalecer-drenajes-pluviales-como-el-el-laguito). No se presentan como observaciones de calle en tiempo real.
- Los reportes de agua de esta versión vienen de un operador y requieren confirmación humana. Deben caducar; el TTL predeterminado es 45 minutos. La profundidad que excede la tolerancia configurada para la flota se excluye del cálculo de rutas. La tolerancia de ambos vehículos está configurada en 0 cm hasta que la autoridad operadora apruebe parámetros específicos.
- Los escenarios de demo se marcan, afectan el cálculo solo al confirmarlos y se excluyen de métricas y feeds externos de incidentes.
- Las coordenadas precargadas para hospitales y estaciones son puntos de demostración: verificar entradas, accesos y operación directamente con cada entidad antes de usar para despacho real.

## Ejecutar

En PowerShell: `./scripts/run_cartagena_pilot.ps1`. Esto usa el caché OSM local y arranca la API en el puerto 8002. Si falta el grafo, primero lo descarga. Para renovar la red vial manualmente: `./scripts/run_cartagena_pilot.ps1 -DownloadGraph`. En `frontend/`, ejecutar `npm run dev -- --host 127.0.0.1` (puerto 3001; proxy a API 8002).

Selecciona Manhattan con `FLOWSENSE_CITY=manhattan` al arrancar la API; cada ciudad guarda sus grafos y registros por separado.

## Qué falta para un piloto de producción

Conectar cámaras o sensores autorizados, revisar en campo el directorio de destinos, acordar tolerancias por unidad con los operadores, integrar una fuente oficial de cierres/lluvia/alertas, y evaluar rutas con históricos y ejercicios controlados. No usar este prototipo como único sistema de navegación o como sustituto del despacho oficial.
