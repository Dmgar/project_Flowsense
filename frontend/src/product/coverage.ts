export const regions = [
  { name: 'Los Angeles', lat: 34.0522, lng: -118.2437 },
  { name: 'Santa Monica', lat: 34.0259, lng: -118.4894 },
  { name: 'Burbank', lat: 34.1808, lng: -118.3090 },
  { name: 'El Monte', lat: 34.0686, lng: -118.0276 },
  { name: 'West Covina', lat: 34.0686, lng: -117.9389 },
  { name: 'Norwalk', lat: 33.9022, lng: -118.0817 },
  { name: 'Long Beach', lat: 33.7701, lng: -118.1937 },
];
export const zoneOptions = ['Todos los distritos', ...regions.map(r => r.name)];
export function matchesZone(zone: string, district: string) {
  if (zone === 'Todos los distritos' || zone === district) return true;
  if (zone === 'Los Angeles') return ['Downtown', 'Westlake', 'Civic Center', 'South Park', 'Downtown Los Angeles'].includes(district);
  return zone === 'Downtown' && district === 'Downtown Los Angeles';
}
