export async function refreshCameraCatalogAfterConnect<T extends { id: string }>(
  connectedCamera: T,
  currentCameras: T[],
  refresh: () => Promise<T[]>,
): Promise<{ cameras: T[]; refreshed: boolean }> {
  try {
    const cameras = await refresh();
    return {
      cameras: cameras.some(camera => camera.id === connectedCamera.id)
        ? cameras
        : [...cameras, connectedCamera],
      refreshed: true,
    };
  } catch {
    return {
      cameras: [...currentCameras.filter(camera => camera.id !== connectedCamera.id), connectedCamera],
      refreshed: false,
    };
  }
}
