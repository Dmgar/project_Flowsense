# Integración de main con el piloto Cartagena

Revisión local: 14 de octubre de 2026.

## Estado de Git

Se ejecutó `git pull --ff-only origin main`: `c2ec0aa` → `6724425`.
El commit local del piloto Cartagena ya formaba parte del historial remoto;
la actualización avanzó sin conflictos ni pérdida de código. Al empezar no
había cambios de código sin confirmar, únicamente logs locales.
Las correcciones descritas aquí permanecen en el directorio de trabajo, sin
commit nuevo ni publicación en GitHub.

## Cómo se relacionan los cambios

El frontend conserva el contrato REST y WebSocket de FastAPI. Las mejoras
remotas de percepción alimentan las métricas de congestión del grafo; el motor
de rutas utiliza esos pesos junto con semáforos e incidentes. El filtro del
piloto Cartagena elimina nodos afectados por reportes de inundación confirmados
y vigentes antes de calcular rutas principales y alternativas.

Se mantuvieron los perfiles de ciudad, la geometría vial, la revisión humana
de incidentes, los registros SQLite y la evaluación de continuidad de las rutas.
La simulación de despacho ahora conserva y restaura correctamente sus métricas
al cruzarse con ese filtro de inundación.

## Correcciones realizadas

- A* calcula una escala admisible a partir de los pesos actuales, incluidos
  descuentos de despeje de hasta 90%; también respeta el peso `length` del recorrido base.
- Después de inyectar congestión simulada se actualiza la copia del grafo seguro
  para que el ruteo perciba la congestión y respete los cierres por inundación.
- Despachos repetidos conservan la primera copia de los valores originales de
  cada tramo. Un cálculo fallido revierte la congestión inyectada.
- Una flota con una unidad sin ruta devuelve HTTP 400 e identifica la unidad;
  ya no devuelve éxito con una lista incompleta. La prueba de flota usa nodos
  conectados, en vez de asumir conectividad por orden de inserción.
- Solicitar una sola ruta conserva la evaluación de inundaciones en la respuesta.
- Los servicios de incidentes e inundación cierran sus conexiones SQLite;
  se verificó lectura, escritura y liberación de archivos en Windows.
- Docker y CI pasan de Python 3.11 a 3.13 para admitir las dependencias de main.
  Docker incluye `libgl1` para la carga de OpenCV. Se usa `httpx2` para el cliente
  de pruebas de la versión actual de Starlette.
- Se corrigió la advertencia del efecto inicial de `IncidentConsole` y se
  excluyeron `.venv` y logs locales del seguimiento de Git.
- El iniciador Cartagena prefiere el entorno `.venv` y conserva el puerto 8002,
  al que apunta el proxy del frontend.

## Evidencia de validación

Se creó un entorno `.venv` con Python 3.13.15 e instalación de `requirements.txt`,
incluidos OpenCV 5.0.0.93, NumPy 2.5.4 y NetworkX 3.7.

| Comprobación | Resultado |
| --- | --- |
| `.venv/Scripts/python.exe -m pip check` | Sin dependencias rotas |
| `.venv/Scripts/python.exe -m pytest -q` | 80 pruebas aprobadas, sin advertencias |
| Suite con grafo sintético, sin descarga de OSM | 80 pruebas aprobadas; una advertencia del lanzador programático de pytest |
| `npm run build` | Compilación TypeScript/Vite correcta |
| `npm run lint` | Sin errores ni advertencias |
| `git diff --check` | Sin errores de espacios |
| Análisis sintáctico del iniciador PowerShell | Correcto |
| Resolución de dependencias para Python 3.13/Linux x86_64 | Correcta en simulación de instalación |

`python -m scripts.verify_cartagena_integration` comprobó el grafo OSM real de
Cartagena: 13.246 nodos y 36.205 tramos. Las rutas produjeron dos alternativas;
un reporte pendiente no bloqueó nodos, su confirmación excluyó la zona de las
rutas y su despeje volvió a habilitarla. Se recibió `route_update` mediante
WebSocket. La prueba usó bases de datos temporales y no modificó los reportes
del piloto ni el archivo del grafo.

## Alcance de la comprobación

La integración API se verificó con TestClient, sin inspección visual del navegador.
No se construyó ni ejecutó un contenedor Docker, ni se ejecutó GitHub Actions.
La percepción se probó con entradas sintéticas; quedan fuera de esta revisión
la inferencia con un modelo ONNX real y un video o cámara física.
La optimización NSGA-II continúa siendo un marcador de implementación; las
unidades de una flota se enrutan individualmente. Estos resultados no equivalen
a validar una operación de emergencias en campo.
