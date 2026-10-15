# Mejoras de mapa y usabilidad

15 de octubre de 2026. Se mantiene la identidad clara y verde de FlowSense.

## Cambios realizados

1. Se centralizó el encuadre: el enfoque de una ubicación y el ajuste de límites
   ya no compiten entre sí durante la carga del mapa.
2. El mapa general se ajusta a la red disponible; los corredores se ajustan a sus
   geometrías reales de OpenStreetMap, en vez de mostrar siete vías próximas
   que podían pertenecer a otra autopista.
3. Harbor, Hollywood y Santa Monica tienen sus propios tramos. Se eliminan las
   duplicaciones entre sentidos en el selector y se muestra su longitud.
4. La geometría disponible del corredor se resalta con una línea verde y blanca; el tramo
   seleccionado puede acercarse con un control específico.
5. El mapa de corredor es más alto en escritorio y móvil.
6. La vista ampliada utiliza la ventana completa, reajusta Leaflet y permite
   salir con Escape. El foco del teclado permanece entre sus controles.
7. Las cámaras próximas se agrupan al alejar el mapa. Pulsar un grupo aproxima
   sus cámaras; a mayor escala aparecen individualmente.
8. Los controles permiten ajustar la cobertura, ampliar y elegir capas desde
   cada mapa. Las vías secundarias aparecen al acercarse para reducir ruido.
9. La cobertura se indica como Downtown. La cartografía base puede explorarse
   fuera de ella, pero eso no amplía los datos del backend ni la cobertura CCTV.
10. En observaciones, la leyenda y los tramos no presentan los pesos del grafo
    como mediciones verificadas de congestión.
11. Los filtros de distrito se aplican a las cámaras y existe una acción para
    recuperar el catálogo completo cuando no hay coincidencias.
12. La evidencia sugerida se ordena por proximidad al corredor. La proximidad no
    se presenta como confirmación de cobertura o de un incidente.
13. Se aumentó contraste y tamaño de textos en tarjetas, tablas, explicaciones
    y gráficos. La navegación tiene nombres accesibles y marca la página activa.
14. Los gráficos muestran unidades y procedencia; cada degradado SVG tiene un
    identificador independiente. Los conteos de sesión no se rotulan como un
    período ilustrativo.
15. La base de velocidad usa km/h. La base del escenario permanece fija al
    cambiar período; indicadores y porcentajes se recalculan y respetan el
    control de comparación.
16. Elegir un origen/destino sobre una señal en el mapa de emergencia conserva
    el flujo de selección, sin enviar al operador a otra pantalla.

## Comprobación

Compilación TypeScript/Vite y lint aprobados. Se comprobaron en navegador:
los tres corredores, carga nueva, selección de tramo, grupos de cámaras,
capas, vista ampliada, Escape y cambios de período. Las capturas de esta
revisión se guardan en `output/screenshots/`.
En móvil a 390 × 844 se comprobó la vista ampliada, el filtro de distrito y la
recuperación de las ocho cámaras; el ancho del documento coincide con 390 px,
sin desbordamiento horizontal. No aparecieron errores en la consola revisada.

El video HLS continúa descargándose bajo demanda. Vite conserva el aviso
de tamaño del módulo HLS, que no impide compilar o ejecutar la aplicación.
Las fuentes públicas pueden mostrar imágenes de indisponibilidad o de una
captura anterior; consultar una imagen no certifica su hora de captura.
