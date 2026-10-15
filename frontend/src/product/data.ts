import type { Corridor, Signal } from './types';

export const classLabels: Record<string, string> = { car: 'Autos', motorcycle: 'Motos', bus: 'Buses', truck: 'Camiones', bicycle: 'Bicicletas', pedestrian: 'Peatones' };
export const classColors: Record<string, string> = { car: '#428363', motorcycle: '#c5933b', bus: '#688b78', truck: '#d07461', bicycle: '#8e7ca6', pedestrian: '#b5a24b' };
export const statusLabels: Record<string, string> = { new: 'Revisión requerida', assigned: 'Asignado', under_review: 'En revisión', confirmed: 'Confirmado por operador', resolved: 'Resuelto', dismissed: 'Descartado' };
export const severityLabels = { low: 'Baja', medium: 'Media', high: 'Alta' };
export const corridors: Corridor[] = [
  { id: 'harbor', name: 'Harbor Freeway · I-110', district: 'Downtown', length: 4.8, intersections: 12, congestion: .72, speed: 24, truck: 14, queue: 210, pedestrians: 2400, lat: 34.048, lng: -118.262 },
  { id: 'hollywood', name: 'Hollywood Freeway · US-101', district: 'Civic Center', length: 5.2, intersections: 14, congestion: .58, speed: 32, truck: 9, queue: 160, pedestrians: 1800, lat: 34.057, lng: -118.246 },
  { id: 'santa-monica', name: 'Santa Monica Freeway · I-10', district: 'South Park', length: 6.1, intersections: 16, congestion: .42, speed: 41, truck: 18, queue: 125, pedestrians: 920, lat: 34.027, lng: -118.275 },
];
export const signals: Signal[] = [
  { id: 'SIG-001', title: 'Acumulación de vehículos', location: 'Wilshire Blvd · I-110', district: 'Downtown', type: 'Congestión', severity: 'high', confidence: .92, impact: 180, evidence: '42 min · demora ilustrativa', duration: 12, lat: 34.0517, lng: -118.2599, action: 'Revisar la demanda y la coordinación de accesos.', owner: 'Operaciones de tráfico', cameraIndex: 1, causes: ['Demanda elevada en hora punta', 'Ingreso concentrado al corredor', 'Posible restricción aguas abajo'] },
  { id: 'SIG-002', title: 'Presión de transporte pesado', location: '7th St · Harbor Freeway', district: 'Downtown', type: 'Carga', severity: 'medium', confidence: .87, impact: 80, evidence: '1,8× · volumen de carga', duration: 8, lat: 34.0504, lng: -118.2619, action: 'Verificar ocupación y acceso de vehículos de carga.', owner: 'Carga y espacio vial', cameraIndex: 2, causes: ['Concentración de vehículos pesados', 'Posible acumulación en acceso'] },
  { id: 'SIG-003', title: 'Demanda en cruces peatonales', location: 'Grand Ave · Civic Center', district: 'Civic Center', type: 'Peatones', severity: 'high', confidence: .90, impact: 250, evidence: '320 peatones/h · ejemplo', duration: 5, lat: 34.0558, lng: -118.2468, action: 'Revisar los tiempos de cruce y la accesibilidad.', owner: 'Seguridad vial', cameraIndex: 4, causes: ['Actividad próxima al centro cívico', 'Ventana de cruce limitada'] },
  { id: 'SIG-004', title: 'Vehículo detenido', location: 'James M. Wood Blvd · I-110', district: 'Westlake', type: 'Vehículo detenido', severity: 'high', confidence: .89, impact: 120, evidence: '3 km/h · señal ilustrativa', duration: 11, lat: 34.048, lng: -118.265, action: 'Inspeccionar la evidencia antes de confirmar obstrucción.', owner: 'Equipo de campo', cameraIndex: 3, causes: ['Parada temporal', 'Posible avería o maniobra de incorporación'] },
  { id: 'SIG-005', title: 'Desbalance de fase semafórica', location: 'Figueroa St · Olympic Blvd', district: 'South Park', type: 'Semáforos', severity: 'medium', confidence: .78, impact: 90, evidence: '+35% · fase estimada', duration: 9, lat: 34.0444, lng: -118.2645, action: 'Solicitar verificación del plan de coordinación.', owner: 'Operación de señales', cameraIndex: 5, causes: ['Demanda asimétrica', 'Posible desajuste de programación'] },
  { id: 'SIG-006', title: 'Cola recurrente en acceso', location: '6th St · Harbor Freeway', district: 'Downtown', type: 'Congestión', severity: 'low', confidence: .76, impact: 60, evidence: '6 eventos · escenario', duration: 7, lat: 34.051649, lng: -118.259584, action: 'Observar el acceso y registrar recurrencia.', owner: 'Operaciones de tráfico', cameraIndex: 0, causes: ['Incorporación concentrada', 'Capacidad limitada de acceso'] },
  { id: 'SIG-007', title: 'Demora en corredor de buses', location: 'Broadway · 4th St', district: 'Downtown', type: 'Transporte público', severity: 'medium', confidence: .81, impact: 110, evidence: '14 min · viaje ilustrativo', duration: 10, lat: 34.049, lng: -118.249, action: 'Revisar continuidad de circulación y paradas.', owner: 'Movilidad colectiva', cameraIndex: 6, causes: ['Paradas próximas', 'Interferencia de tráfico general'] },
  { id: 'SIG-008', title: 'Interacción en cruce', location: 'Hope St · 9th St', district: 'South Park', type: 'Conflicto potencial', severity: 'low', confidence: .72, impact: 40, evidence: '1,3× · demanda', duration: 4, lat: 34.0458, lng: -118.262, action: 'Revisar trayectorias agregadas sin identificar personas.', owner: 'Seguridad vial', cameraIndex: 7, causes: ['Movimientos de giro simultáneos', 'Demanda peatonal elevada'] },
];
export const hours = ['00', '02', '04', '06', '08', '10', '12', '14', '16', '18', '20', '22'];
const congestion = [.10, .08, .17, .36, .77, .62, .34, .31, .48, .84, .63, .26];
export function trendSeries(factor = 1) { return hours.map((hour, i) => ({ hour, current: Math.round(congestion[i] * factor * 100) / 100, baseline: Math.round(congestion[i] * 68) / 100, speed: Math.round(50 - congestion[i] * factor * 35), speed_baseline: Math.round(50 - congestion[i] * .68 * 35), pedestrians: Math.round(160 + congestion[i] * factor * 1620), conflicts: Math.round(3 + congestion[i] * factor * 18) })); }
export const demoSteps = [
  { title: 'La ciudad, de un vistazo', detail: 'Explora capas y prioriza dónde revisar.', route: '/overview' },
  { title: 'Entender un corredor', detail: 'Compara la tendencia y la línea base ilustrativa.', route: '/corridors/harbor' },
  { title: 'De señal a prioridad', detail: 'Selecciona un punto crítico y abre su evidencia.', route: '/hotspots' },
  { title: 'Evidencia de una cámara pública', detail: 'Consulta una imagen real de Caltrans y su detección.', route: '/cameras/caltrans-d7-1002' },
  { title: 'La decisión es humana', detail: 'Asigna y revisa un caso antes de confirmarlo.', route: '/risk-signals' },
  { title: 'Continuidad para emergencias', detail: 'Calcula un corredor real con una alternativa.', route: '/emergency-corridor' },
  { title: 'Cerrar el ciclo', detail: 'Exporta el reporte y explica el sistema.', route: '/reports' },
];
