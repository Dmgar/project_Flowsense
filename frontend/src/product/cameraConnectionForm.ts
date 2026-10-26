export interface CameraConnectionInput {
  name: string;
  source: string;
  lat: string;
  lng: string;
}

export interface CameraConnectionErrors {
  name?: string;
  source?: string;
  lat?: string;
  lng?: string;
}

export function validateCameraConnection(input: CameraConnectionInput): CameraConnectionErrors {
  const errors: CameraConnectionErrors = {};
  const name = input.name.trim();
  const source = input.source.trim();
  const lat = Number(input.lat);
  const lng = Number(input.lng);

  if (name.length < 2 || name.length > 120) errors.name = 'Enter a name from 2 to 120 characters.';
  if (!source || source.length > 500) errors.source = 'Enter a source address up to 500 characters.';
  else if (!/^\d+$/.test(source)) {
    let url: URL | null = null;
    try { url = new URL(source); } catch { /* The field message below explains the accepted formats. */ }
    if (!url || !['http:', 'https:', 'rtsp:'].includes(url.protocol) || !url.hostname) {
      errors.source = 'Enter an HTTP(S) or RTSP video URL, or a webcam index such as 0.';
    } else if (url.username || url.password) {
      errors.source = 'Remove usernames and passwords from the URL. Credentials are not supported.';
    } else if (/\.(jpg|jpeg|png|gif|webp)$/i.test(url.pathname)) {
      errors.source = 'Still images are not supported. Enter a continuous video source.';
    }
  }
  if (!input.lat.trim() || !Number.isFinite(lat) || lat < -90 || lat > 90) errors.lat = 'Enter a latitude between -90 and 90.';
  if (!input.lng.trim() || !Number.isFinite(lng) || lng < -180 || lng > 180) errors.lng = 'Enter a longitude between -180 and 180.';
  return errors;
}
