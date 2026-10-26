import type { MouseEvent } from 'react';
import { useProduct } from './store';
import { Icon } from './ui';
import './missingView.css';

export function MissingView() {
  const path = useProduct(state => state.path);
  const query = useProduct(state => state.query);
  const exploreUrl = `/explore${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`;
  const followLink = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    useProduct.getState().navigate(event.currentTarget.getAttribute('href') || '/overview');
  };
  return <div className="p-screen p-missing-view"><span className="p-missing-view-icon" aria-hidden="true"><Icon name="map" size={30} /></span><span className="p-eyebrow">FIND YOUR WAY BACK</span><h1>This view is not available</h1><p>The address may be incomplete or point to a view that no longer exists. Choose where to continue.</p><code>{path}</code><div className="p-missing-view-actions"><a className="p-button primary" href="/overview" onClick={followLink}><Icon name="grid" />Open overview</a><a className="p-button" href={exploreUrl} onClick={followLink}><Icon name="search" />Explore streets</a></div><small>Your saved preferences and camera selections stay in this browser.</small></div>;
}
