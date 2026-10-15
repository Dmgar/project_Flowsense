# Continuidad de uso y estado de fuentes

15 de octubre de 2026. Segunda etapa sobre las 69 fuentes regionales.

## Implementado

- **Cobertura por ciudad en Vista general:** siete accesos al mapa, recuentos de
  fuentes y resultado de su última comprobación. No representa aforo o
  disponibilidad permanente. El resumen distingue consultas recientes de la
  revisión inicial del catálogo.
- **Mis cámaras:** guardar y quitar favoritas desde galería y evidencia. Se
  conservan en las preferencias locales del navegador; la vista general ofrece
  hasta cuatro accesos y la galería permite filtrar toda la selección.
- **Galería:** ordenar por favoritas/recientes, nombre o ciudad; filtrar consultas
  recientes y buscar también por ciudad y ruta. Se mantienen doce tarjetas por
  página y el restablecimiento de todos los filtros.
- **Estados con caducidad:** el backend distingue imagen reciente, aviso reciente,
  consulta anterior y fuente sin consulta. La vigencia es el intervalo de
  actualización de la cámara más treinta segundos. Se entrega la antigüedad y
  el resultado de la última consulta, sin convertir avisos en imágenes válidas.
- **Evidencia:** evita consultas solapadas, cancela solicitudes al salir y separa
  el estado de un aviso del estado de una imagen de tráfico. El historial usa la
  fecha de observación para conservar la selección aunque se desplace la ventana
  de sesenta registros o se repita el mismo contenido de imagen.
- **Coherencia por ciudad:** contadores de cámaras y casos en Vista general
  respetan la zona elegida. Las revisiones de evidencia conservan la ciudad real.
  Se retiraron referencias antiguas a un catálogo de ocho cámaras.
- **Renovación del catálogo:** conserva todos los IDs y URLs publicados, además
  de su orden y ciudad. Fuentes ausentes se mantienen marcadas por comprobar y
  sin promesa de video. Si el proveedor reutiliza un índice con una URL distinta,
  la fuente nueva recibe otro ID para proteger las referencias anteriores.

## Verificación

- Suite backend: 93 pruebas aprobadas, incluidas caducidad, avisos y continuidad
  de identificadores ante renumeración o ausencia de fuentes.
- TypeScript/Vite y lint aprobados. Permanece el aviso de tamaño del módulo HLS,
  cargado bajo demanda.
- Integración con grafo regional y fotograma real: detección, rutas alternativas,
  revisión y exportaciones PDF/CSV aprobadas, usando casos temporales aislados.
- API local: catálogo de 69 fuentes y consulta OpenCV de Burbank aprobados; el
  inventario refleja la hora y el estado de la observación.
- **Revisión visual pendiente:** el navegador integrado rechazó la observación
  de localhost por su política de acceso. No se certifica la interacción visual
  o la persistencia de favoritas en navegador en esta etapa.

## Siguiente etapa

Comprobar visualmente favoritos, recarga de página, ordenación y resumen regional
en escritorio y móvil cuando el navegador permita acceso. Después, definir una
política de retención para series de observaciones propias antes de implementar
comparaciones históricas reales. Los conteos instantáneos existentes no permiten
estimar velocidad o duración de incidentes sin calibración adicional.

Las fuentes públicas no se verifican masivamente en cada apertura. Esta etapa no
ha renovado las imágenes de auditoría del catálogo ni altera los casos guardados.

## Actualización de verificación

Se resolvió el acceso mediante navegación HTTP normal y se revisaron el explorador
y la mesa en escritorio/móvil. El alcance y los pendientes actuales están en
[la auditoría](GOAL_COMPLETION_AUDIT.md); la limitación de navegador anterior
corresponde a la comprobación histórica de esta etapa.
