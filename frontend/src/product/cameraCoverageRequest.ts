const REQUEST_TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 500;

export async function loadCameraCoverage<T>(
  url: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  retryDelayMs = RETRY_DELAY_MS,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (signal.aborted) throw signal.reason;
    try {
      const response = await fetcher(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      });
      if (!response.ok) throw new Error('Road-zone coverage is temporarily unavailable.');
      return await response.json() as T;
    } catch (error) {
      if (signal.aborted || attempt === 1) throw error;
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
  }
  throw lastError;
}
