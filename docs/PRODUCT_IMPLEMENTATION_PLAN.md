# FlowSense · plan de implementación del producto

Objetivo: convertir las ocho referencias y los contratos entregados en una plataforma
de inteligencia de movilidad navegable, conservando fondos claros y verde del producto.
El ámbito solicitado es Estados Unidos. Se usa Los Angeles, California, con cámaras
públicas oficiales gratuitas de Caltrans; Manhattan y Cartagena se mantienen como perfiles existentes.

## Secuencia y aceptación

1. **Base y navegación.** Shell persistente, búsqueda, filtros de distrito y período,
   navegación real por URL, estados sin conexión, teclado y adaptación móvil.
2. **Contratos comunes.** Un único catálogo para mapas, tablas y detalles; distinción
   de imagen pública, observación OpenCV y escenario ilustrativo; errores y ausencia
   de datos visibles. Registrar procedencia y hora de cada observación.
3. **Mapa urbano.** Leaflet con cartografía real, capas conmutables, cámaras y señales
   clicables, selección de segmento, panel de movilidad y resumen operativo.
4. **Cámaras y evidencia.** Inventario, imagen pública actualizable, zoom, pausa,
   histórico temporal de observaciones, filtros de detección, conexión HTTP/RTSP/webcam,
   estado de captura e inferencia, conteos, composición y evidencia exportable.
5. **Corredores.** Selección de tramo, tendencias, mezcla modal, comparación de base,
   diagnóstico explicable y salto a cámara/acción. La historia de presentación se
   etiqueta y no se confunde con series municipales reales.
6. **Puntos críticos y riesgos.** Filtros, ordenamiento, selección consistente con el
   mapa, detalle de evidencia y causas posibles. Crear/asignar/revisar/confirmar/
   resolver/descartar un caso, con persistencia y bitácora.
7. **Peatones.** Intersecciones, demanda agregada, capa de presión, gráficos de
   volumen y conflictos ilustrativos, modos y enlace a evidencia. Sin identificación
   personal ni afirmaciones de accidentes confirmados.
8. **Emergencias.** Planificador existente conectado a API, ruta y alternativas,
   ETA estimada, continuidad topológica, evidencia de cámaras por cercanía y
   explicación de cierres. Semáforos solo simulados; decisión humana de despacho.
9. **Reportes y presentación.** Exportación CSV y PDF/imprimible con procedencia,
   estado de casos y filtros, recorrido guiado y storyboard interactivo del producto.
10. **Verificación.** Pruebas de contratos, revisión de transiciones y fallos de
    fuentes, suite existente, compilación, lint, navegador escritorio/móvil,
    screenshots y flujo completo mapa → evidencia → caso → reporte.

## Principios

- Las instrucciones de color del usuario prevalecen sobre los documentos de diseño.
- Los documentos e imágenes se tratan como requisitos de referencia, no permisos
  para publicar, enviar mensajes, comprar servicios o inventar resultados reales.
- La disponibilidad de una cámara pública se comprueba al capturar; un marcador
  no equivale a una cámara conectada. No se garantiza video continuo si el proveedor
  solo ofrece imágenes periódicas.
- Conteo instantáneo no equivale a aforo acumulado; velocidad requiere calibración
  y seguimiento. No se inventan métricas de cámara para llenar tarjetas.
- Los resultados de presentación se distinguen de observaciones y cálculos reales.
- La revisión humana precede a acciones operativas; los casos no controlan equipos.
- Se preservan las correcciones de integración del trabajo anterior.

## Entrega verificable

Producto servido por HTTP local, pantallas funcionales, fuentes documentadas,
capturas del resultado, instrucciones de ejecución y registro de comprobaciones.
La validación documentará por separado fuentes en vivo, inferencia y escenarios.
