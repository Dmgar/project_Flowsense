export function parseCoordinates(input: string) {
  const parts = input.split(',').map(part => part.trim());
  const values = parts.map(Number);
  if (parts.length !== 2 || parts.some(part => !part) || !values.every(Number.isFinite) || Math.abs(values[0]) > 90 || Math.abs(values[1]) > 180) {
    throw new Error('Enter a latitude between -90 and 90, and a longitude between -180 and 180.');
  }
  return { latitude: values[0], longitude: values[1] };
}
