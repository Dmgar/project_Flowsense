export function shouldLoadMap(entry: {
  isIntersecting: boolean;
  boundingClientRect: Pick<DOMRect, 'width' | 'height' | 'bottom'>;
  rootBounds: Pick<DOMRect, 'top'> | null;
}): boolean {
  if (entry.isIntersecting) return true;
  const visibleSize = entry.boundingClientRect.width > 0 && entry.boundingClientRect.height > 0;
  return visibleSize && entry.rootBounds !== null && entry.boundingClientRect.bottom < entry.rootBounds.top;
}
