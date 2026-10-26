import { useEffect, useRef } from 'react';
import { Icon } from './ui';
import './workspaceNotice.css';

export function WorkspaceNotice({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const root = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) returnFocus.current = document.activeElement;
    const rememberOutsideFocus = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && event.target !== document.body && !root.current?.contains(event.target)) returnFocus.current = event.target;
    };
    document.addEventListener('focusin', rememberOutsideFocus);
    return () => document.removeEventListener('focusin', rememberOutsideFocus);
  }, []);

  const dismiss = () => {
    const restoreFocus = root.current?.contains(document.activeElement);
    onDismiss();
    if (!restoreFocus) return;
    requestAnimationFrame(() => {
      const previous = returnFocus.current;
      const destination = previous?.isConnected && previous.getClientRects().length > 0 && !previous.matches(':disabled') && !previous.closest('[inert], [hidden], [aria-hidden="true"]') ? previous : document.getElementById('product-content');
      destination?.focus({ preventScroll: true });
    });
  };

  return <section ref={root} className="p-toast p-workspace-notice" aria-label="Workspace notice" aria-keyshortcuts="Escape" onKeyDown={event => { if (!event.defaultPrevented && !event.nativeEvent.isComposing && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); } }}>
    <span className="p-workspace-notice-icon" aria-hidden="true"><Icon name="info" size={20} /></span>
    <div className="p-workspace-notice-copy"><strong>Workspace notice</strong><p className="p-workspace-notice-message" role="status" aria-live="polite" aria-atomic="true" tabIndex={message.length > 180 ? 0 : undefined}>{message}</p><small>Kept here until dismissed. Press Escape while focused here to close.</small></div>
    <button type="button" className="p-workspace-notice-close" aria-label="Dismiss workspace notice" title="Dismiss notice" onClick={dismiss}><Icon name="close" size={17} /></button>
  </section>;
}
