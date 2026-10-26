import { Icon } from './ui';
import './connectionNotice.css';

export function ConnectionNotice({ message, retrying, onRetry }: { message: string; retrying: boolean; onRetry: () => void }) {
  const offline = message.startsWith('You are offline.');
  const casesOnly = message.startsWith('Camera sources are available, but saved cases');
  const title = offline ? 'You are offline' : casesOnly ? 'Saved cases need a refresh' : 'Camera catalog unavailable';
  const guidance = offline
    ? 'Reconnect to refresh sources and saved cases. You can continue reading the guide and exploring the interface.'
    : casesOnly
      ? 'Camera sources are available. Treat previously loaded cases as potentially out of date until a refresh succeeds.'
      : 'Source availability is uncertain. Previously loaded information may be out of date; check the source before using it.';

  return <section className="p-connection-error p-connection-notice" aria-label="Connection notice">
    <span className="p-connection-notice-icon" aria-hidden="true"><Icon name="alert" size={18} /></span>
    <div className="p-connection-notice-copy">
      <div role="status" aria-live="polite" aria-atomic="true"><h2>{title}</h2><p>{retrying ? 'Refreshing sources and saved cases…' : 'You can keep exploring. Previously loaded data may be out of date.'}</p></div>
      <details><summary>Why am I seeing this?</summary><p>{guidance}</p><span className="p-connection-retry-status">The workspace also retries automatically.</span><p className="p-connection-technical" tabIndex={0}>{message}</p></details>
    </div>
    <button type="button" className="p-button" aria-busy={retrying} disabled={retrying} onClick={onRetry}><span className={retrying ? 'p-request-progress' : undefined} aria-hidden="true"><Icon name="refresh" size={15} /></span>{retrying ? 'Retrying…' : 'Retry connection'}</button>
  </section>;
}
