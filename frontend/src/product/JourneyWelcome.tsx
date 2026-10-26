import { useEffect, useState } from 'react';
import { dismissFirstVisitTour, shouldShowFirstVisitTour } from './journey';
import { useProduct } from './store';
import { Icon } from './ui';

export function JourneyWelcome() {
  const startTour = useProduct(state => state.startTour);
  const touring = useProduct(state => state.demoIndex >= 0);
  const [welcome, setWelcome] = useState(() => shouldShowFirstVisitTour(() => window.localStorage));
  useEffect(() => {
    if (!touring || !welcome) return;
    dismissFirstVisitTour(() => window.localStorage);
    setWelcome(false);
  }, [touring, welcome]);
  const dismissWelcome = () => {
    dismissFirstVisitTour(() => window.localStorage);
    setWelcome(false);
  };
  const continueWithoutTour = () => {
    dismissWelcome();
    requestAnimationFrame(() => {
      const heading = document.querySelector<HTMLElement>('#product-content [data-journey-active="true"] h1');
      const destination = heading || document.getElementById('product-content');
      if (!destination) return;
      if (!destination.hasAttribute('tabindex')) destination.tabIndex = -1;
      destination.focus({ preventScroll: true });
    });
  };
  if (!welcome) return null;
  return <aside className="fs-first-visit" aria-labelledby="fs-first-visit-title" aria-describedby="fs-first-visit-detail">
    <div><span className="p-eyebrow">WELCOME TO FLOWSENSE</span><h2 id="fs-first-visit-title">New here? Want a guided tour?</h2><p id="fs-first-visit-detail">Follow the interactive guide to find your way around. Choose “Explore on my own” to start without it.</p><ol className="fs-first-visit-preview" aria-label="What the guide introduces"><li><Icon name="search" size={16} /><span>Find sources</span></li><li><Icon name="map" size={16} /><span>Compare context</span></li><li><Icon name="shield" size={16} /><span>Review evidence</span></li></ol><small className="fs-first-visit-reopen"><Icon name="info" size={13} />You can reopen the guide from “Guided tour” at any time.</small></div>
    <div className="fs-first-visit-actions"><span className="fs-first-visit-choice-hint">Go step by step · skip at any time</span><button className="p-button primary" onClick={event => { const returnFocus = document.querySelector<HTMLButtonElement>('#product-content [data-journey-active="true"] .fs-entry-heading button') || document.querySelector<HTMLButtonElement>('.p-tour-trigger') || event.currentTarget; dismissWelcome(); startTour(returnFocus); }}>Start guided tour <Icon name="arrow" size={15} /></button><button className="p-text-button" onClick={continueWithoutTour}>Explore on my own</button></div>
    <button className="fs-first-visit-close" aria-label="Dismiss introduction" title="Dismiss introduction" onClick={continueWithoutTour}><Icon name="close" size={15} /></button>
  </aside>;
}
