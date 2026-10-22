export type CameraCatalogStatus = 'loading' | 'ready' | 'empty' | 'error';

export function cameraCatalogStatus(cameraCount: number, loaded: boolean, failed: boolean): CameraCatalogStatus {
  if (failed) return 'error';
  if (!loaded) return 'loading';
  return cameraCount > 0 ? 'ready' : 'empty';
}
