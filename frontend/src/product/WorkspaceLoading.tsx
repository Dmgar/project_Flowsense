import { useId } from 'react';
import { Icon } from './ui';
import './workspaceLoading.css';

export function WorkspaceLoading({ name }: { name: string }) {
  const titleId = useId();
  return <section className="p-screen p-workspace-loading" aria-labelledby={titleId} aria-busy="true">
    <div className="p-workspace-loading-copy" role="status" aria-live="polite">
      <span className="p-workspace-loading-icon" aria-hidden="true"><span className="p-request-progress"><Icon name="refresh" size={24} /></span></span>
      <span className="p-eyebrow">OPENING YOUR VIEW</span>
      <h1 id={titleId}>Preparing {name}</h1>
      <p>Loading the interface. Source and saved-evidence availability will be shown when the view opens.</p>
    </div>
    <div className="p-workspace-loading-outline" aria-hidden="true"><span /><span /><span /></div>
  </section>;
}
