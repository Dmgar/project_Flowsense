export interface SearchNavigationItem { name: string; path: string }
export interface SearchEntityItem { name: string; path: string; signal?: string }
export interface SearchMatches {
  cameras: SearchEntityItem[];
  signals: SearchEntityItem[];
}

export function nextSearchOption(current: number, direction: 'next' | 'previous', count: number): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return direction === 'next' ? 0 : count - 1;
  return (current + (direction === 'next' ? 1 : -1) + count) % count;
}

export function searchReturnUrl(pathname: string, query: string, currentSearch = '', hash = '') {
  const term = query.trim();
  if (!term) return null;
  const params = new URLSearchParams(currentSearch);
  params.set('q', term);
  return `${pathname}?${params.toString()}${hash}`;
}

export function searchSubmitDestination(query: string, modules: SearchNavigationItem[], matches: SearchMatches) {
  const normalized = query.trim().toLocaleLowerCase('en-US');
  if (normalized.length < 2) return null;

  const exactModule = modules.find(item => item.name.toLocaleLowerCase('en-US') === normalized);
  const modulePrefix = modules.find(item => item.name.toLocaleLowerCase('en-US').startsWith(normalized));
  if (exactModule || modulePrefix) return { path: (exactModule || modulePrefix)!.path };

  const entities = [...matches.cameras, ...matches.signals];
  const exactEntity = entities.find(item => item.name.toLocaleLowerCase('en-US') === normalized);
  const entityPrefix = entities.find(item => item.name.toLocaleLowerCase('en-US').startsWith(normalized));
  const match = exactEntity || entityPrefix || matches.cameras[0] || matches.signals[0];
  if (match) return { path: match.path, ...(match.signal ? { signal: match.signal } : {}) };
  return { path: `/explore?q=${encodeURIComponent(query.trim())}` };
}
