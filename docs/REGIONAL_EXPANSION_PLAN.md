# Expansión de FlowSense al Gran Los Angeles

**Etapa vigente:** 86 cámaras registradas y 61 imágenes distintas comprobadas en
la revisión más reciente. Incluye explorador de calles, mesa de observación y
recuperación de video. Consulta [EXPLORER_AND_OBSERVATION_DESK.md](EXPLORER_AND_OBSERVATION_DESK.md).
Los recuentos anteriores de 69 u ocho fuentes se conservan como registro de las
entregas previas. La disponibilidad de video se distingue de la de imagen.

Entrega local: 15 de octubre de 2026. El objetivo era superar 40 cámaras y
permitir explorar Santa Monica, Burbank, El Monte, West Covina, Norwalk y
Long Beach, además de Los Angeles. La expansión se implementó conservando la
paleta clara y verde, las ocho URLs de evidencia anteriores y los casos guardados.

## 1. Resultado y cobertura

| Zona del catálogo | Fuentes registradas | Imágenes comprobadas sin aviso aparente | Listas HLS válidas |
| --- | ---: | ---: | ---: |
| Los Angeles | 21 | 16 | 13 |
| Santa Monica | 8 | 1 | 1 |
| Burbank | 10 | 6 | 6 |
| El Monte / South El Monte | 6 | 1 | 1 |
| West Covina | 5 | 5 | 5 |
| Norwalk / Norwalk Park | 9 | 5 | 4 |
| Long Beach | 10 | 10 | 10 |
| **Total** | **69** | **44** | **40** |

Los recuentos corresponden a esta revisión, no a una garantía permanente.
En Santa Monica y El Monte predominaban avisos del proveedor. Se conservaron
las ubicaciones oficiales y se distinguió su disponibilidad; no se inventaron
imágenes ni se presentaron todas las fuentes como operativas.

Las agrupaciones usan `nearbyPlace` del proveedor y cubren la ciudad y sus
accesos. No equivalen a polígonos municipales certificados. Cada cámara conserva
sus coordenadas oficiales. El límite regional es oeste -118.56, sur 33.70,
este -117.84 y norte 34.25.

## 2. Selección y verificación de cámaras

Se utilizó el [catálogo oficial del distrito 7 de Caltrans](https://cwwp2.dot.ca.gov/data/d7/cctv/cctvStatusD07.json).
Su [documentación CCTV](https://cwwp2.dot.ca.gov/documentation/cctv/cctv.htm)
ofrece los datos por HTTPS sin cargo. No se necesita cuenta ni contraseña.

`scripts/expand_public_cameras.py` realiza este proceso:

1. Descarga el catálogo y selecciona ubicaciones de las siete zonas dentro del
   límite regional. Conserva el estado declarado por Caltrans.
2. Comprueba imágenes con seis conexiones concurrentes y tiempos de espera
   acotados; registra HTTP, MIME, resolución, fecha y hash SHA-256.
3. Marca como posible aviso del proveedor una imagen predominantemente blanca.
   Esta es una regla conservadora de revisión, no una certificación visual.
4. Evita contar copias idénticas como imágenes diferentes. Selecciona un conjunto
   equilibrado, priorizando imágenes comprobadas y HLS que respondió.
5. Comprueba que haya al menos 40 imágenes distintas utilizables antes de
   sustituir el catálogo, y preserva los identificadores de las ocho fuentes
   originales por su URL de imagen. El índice actual del proveedor se guarda
   aparte para evitar que una actualización rompa un caso anterior.
6. Registra también fuentes temporalmente no disponibles para que puedan volver
   a consultarse, distinguiéndolas de las imágenes comprobadas.

El catálogo está en `data/public_cameras_los_angeles.json` y la auditoría en
`data/public_cameras_verification.json`. La fecha de modificación de un registro
no se interpreta como fecha de captura. Una lista HLS válida no garantiza que
todos sus segmentos sigan disponibles ni que el navegador pueda reproducirlos.

## 3. Red vial regional

La nueva caché real de OpenStreetMap tiene **18.946 nodos y 40.529 tramos**,
frente a 3.123 y 8.708 del área anterior. Se conserva el detalle previo de
Downtown y se añaden autopistas, vías principales, vías secundarias y enlaces.
No se afirma cubrir todas las calles residenciales de cada municipio.

`scripts/download_regional_graph.py` descarga geometrías públicas mediante una
instancia de Overpass documentada en [OpenStreetMap](https://wiki.openstreetmap.org/wiki/Overpass_API).
Las primeras instancias agotaron el tiempo de conexión; la instancia de VK Maps
respondió correctamente. La extracción se guarda como dato local de trabajo.

El proceso conserva IDs de nodos OSM, sentidos únicos y rotondas, calcula
longitudes, simplifica puntos intermedios y une el detalle local existente.
Finalmente conserva la componente conectada mayor y escribe la caché de forma
atómica en `data/processed/los_angeles_regional_graph.graphml`.

El perfil `los_angeles`, sus límites y el lanzador apuntan a esta caché.
El grafo permite calcular rutas regionales, pero no contiene telemetría de
velocidad verificada, restricciones completas de giro o control de semáforos.
Los tiempos de viaje usan velocidades nominales y son estimaciones.

## 4. Mapa y navegación

El mapa general ajusta su encuadre a la región y muestra las nuevas cámaras.
Los accesos rápidos permiten seleccionar una ciudad y muestran su recuento;
el mismo filtro se utiliza en la cabecera, la vista móvil y la galería.
Al elegir una zona se ajusta el encuadre a sus fuentes y su entorno.

Las cámaras se agrupan al alejar el mapa y se separan al acercarse. La vista
ampliada, los controles de capas y el ajuste a cobertura siguen disponibles.
El panel de capas permite desactivar “Agrupar cámaras cercanas”: se comprobaron
los 69 marcadores individuales en el mapa. Las vías se dibujan por ventana
visible, sin duplicar sentidos superpuestos, y los detalles se crean al
consultarlos, para evitar cargar controles de miles de tramos fuera de vista.
En el mapa regional se retiró la tarjeta que ocultaba parte de la cartografía.
Actualizar los estados de cámaras no debe reiniciar el encuadre del operador.

El mapa base puede explorarse más allá del límite descargado. Eso no implica
que las rutas o cámaras tengan cobertura fuera de ese límite.

## 5. Galería y evidencia

La galería muestra 12 cámaras por página para reducir solicitudes simultáneas,
con filtros por zona, formato y disponibilidad. La vista inicial prioriza las
44 imágenes comprobadas; se puede seleccionar todo el catálogo o los avisos.
La evidencia sugerida en el mapa corresponde a la zona elegida.

Cada fuente conserva enlace oficial, imagen, video cuando está disponible,
consulta de fotograma, detección y apertura de revisión. Los avisos aparentes
del proveedor no se procesan como tráfico: sus conteos son `null`, y no se
convierten en ceros ni se introducen en tendencias de objetos detectados.

El enlace “Ver en mapa” enfoca las coordenadas reales y selecciona la zona de
la fuente. Los registros y casos existentes permanecen en su base local.

## 6. Validación y criterios de aceptación

- Al menos 40 imágenes decodificables distintas y fuentes en las siete zonas.
- Al menos cuatro ubicaciones registradas por zona, con IDs y URLs únicos.
- Conservación de las ocho fuentes originales y sus enlaces de evidencia.
- Fuente, coordenadas, fecha y resultado de comprobación trazables.
- No convertir un aviso de proveedor en un aforo de cero vehículos.
- Compilación TypeScript/Vite y lint aprobados; suite backend de 91 pruebas.
- Integración del modelo, rutas alternativas, bitácora y exportación PDF/CSV
  comprobada mediante `scripts/verify_los_angeles_integration.py`.
- Comprobación regional en vivo mediante `scripts/verify_regional_coverage.py`:
  imagen, observación y ruta desde Los Angeles hacia cada zona.
- Revisión visual de filtros, cámaras, encuadre, paginación y vista móvil.
  En 390 × 844, el mapa ampliado mide 380 px de ancho y el documento 390 px,
  sin desbordamiento horizontal. Se verificaron los filtros de ciudad, las
  44 imágenes de la galería, el límite de 12 tarjetas y la segunda página.

## 7. Operación y siguientes etapas

Para iniciar, ejecutar `scripts/run_flowsense.ps1`; usar `-Setup` en una
instalación nueva. La caché regional se descarga si no existe. El catálogo está
incluido en el proyecto y no necesita consultar Caltrans completo en cada carga.
La mayoría de las imágenes públicas se actualizan aproximadamente cada dos
minutos. El reproductor vuelve a la imagen si falla el HLS.

Para ampliar o renovar fuentes, volver a ejecutar el script de catálogo y
revisar su auditoría; reiniciar el backend para cargar los cambios. No ejecutar
la actualización con frecuencia alta: las fuentes pueden estar temporalmente
interrumpidas y una consulta repetida no mejora la fecha de captura.

Las siguientes etapas de medición real requieren series históricas propias,
retención definida, calibración por cámara, carriles, integración de fases
semafóricas y validación de detecciones con muestras reales. El producto actual
mantiene separados el escenario ilustrativo y las observaciones verificables.
Caltrans no proporciona un archivo histórico de sus videos e imágenes.

## 8. Archivos y comandos de comprobación

```powershell
.\scripts\run_flowsense.ps1
.\.venv\Scripts\python.exe scripts/expand_public_cameras.py
.\.venv\Scripts\python.exe scripts/download_regional_graph.py
.\.venv\Scripts\python.exe scripts/verify_los_angeles_integration.py
.\.venv\Scripts\python.exe scripts/verify_regional_coverage.py
.\.venv\Scripts\python.exe -m pytest -q
cd frontend
npm run build
npm run lint
```

Las cachés grandes, capturas y salidas de comprobación permanecen locales y
están excluidas de Git. La entrega regional inicial se publicó en main con el commit 83ef656.
Las mejoras posteriores de continuidad se describen en
[OPERATOR_WORKFLOW_IMPROVEMENTS.md](OPERATOR_WORKFLOW_IMPROVEMENTS.md).
