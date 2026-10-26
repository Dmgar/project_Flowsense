export const flowSenseUnavailableMessage = 'The FlowSense service could not complete this request. Check service status and retry.';
export const flowSenseUnreachableMessage = 'Unable to reach the FlowSense service. Check your connection or service status, then retry.';

export function apiErrorMessage(payload: unknown, fallback: string): string {
  const detail = payload && typeof payload === 'object' && 'detail' in payload ? payload.detail : null;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const messages = detail.flatMap(item => {
      if (!item || typeof item.msg !== 'string') return [];
      const field = Array.isArray(item.loc) ? item.loc.filter((value: unknown) => value !== 'body' && value !== 'query').join('.') : '';
      return [field ? `${field}: ${item.msg}` : item.msg];
    });
    if (messages.length) return messages.join(' ');
  }
  return fallback;
}
