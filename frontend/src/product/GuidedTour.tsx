import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { coachmarkPosition, nextTourIndex, targetPhase, sameCoachmarkPosition, tourCaseAvailability, tourCaseAvailabilityMessage, tourKey, tourRoute, tourSteps } from './journey';
import { useProduct } from './store';
import { Icon } from './ui';

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };

export function GuidedTour() {
  const index = useProduct(s => s.demoIndex);
  const path = useProduct(s => s.path);
  const mode = useProduct(s => s.mode);
  const catalogReady = useProduct(s => s.cameraCatalogLoaded);
  const casesLoaded = useProduct(s => s.casesLoaded);
  const casesLoadStatus = useProduct(s => s.casesLoadStatus);
  const caseCount = useProduct(s => s.cases.length);
  const card = useRef<HTMLDivElement>(null);
  const focusedStep = useRef<number | null>(null);
  const origin = useRef({ path: useProduct.getState().path, query: useProduct.getState().query, search: window.location.search });
  const [target, setTarget] = useState<Rect | null>(null);
  const [phase, setPhase] = useState<'waiting' | 'ready' | 'fallback'>('waiting');
  const [placement, setPlacement] = useState(() => coachmarkPosition(
    { left: 0, top: 0, right: 0, bottom: 0 }, window.innerWidth, window.innerHeight,
    Math.min(360, window.innerHeight * (window.innerHeight <= 560 ? .6 : .46)),
  ));
  const [expected, setExpected] = useState('');
  const [focusOutsideGuide, setFocusOutsideGuide] = useState(false);
  const [recenterRequest, setRecenterRequest] = useState(0);
  const [targetAvailable, setTargetAvailable] = useState(false);
  const [inspectingPage, setInspectingPage] = useState(false);
  const step = tourSteps[index];
  const caseAvailability = tourCaseAvailability(index, { mode, casesLoaded, casesLoadStatus, caseCount });
  const caseNotice = caseAvailability ? tourCaseAvailabilityMessage(caseAvailability) : '';
  const caseActionAvailable = caseAvailability === 'ready' || caseAvailability === 'refreshing' || (caseAvailability === 'stale' && caseCount > 0);

  useEffect(() => {
    const updateFocus = () => {
      if (document.activeElement instanceof HTMLElement && document.activeElement.closest('.fs-tour-return-focus')) return;
      setFocusOutsideGuide(Boolean(document.activeElement && document.activeElement !== document.body && !card.current?.contains(document.activeElement)));
    };
    document.addEventListener('focusin', updateFocus);
    return () => document.removeEventListener('focusin', updateFocus);
  }, []);

  useLayoutEffect(() => {
    const state = useProduct.getState();
    const route = tourRoute(index, state.cameras, origin.current.path, [...state.watchCameras, ...state.favoriteCameras]);
    const frame = requestAnimationFrame(() => {
      setTarget(null); setPhase('waiting'); setExpected(route);
      const waitingPlacement = coachmarkPosition({ left: 0, top: 0, right: 0, bottom: 0 }, window.innerWidth, window.innerHeight, card.current?.offsetHeight || 340);
      setPlacement(previous => sameCoachmarkPosition(previous, waitingPlacement) ? previous : waitingPlacement);
      if (route !== state.path) state.navigate(`${route}${state.query ? `?q=${encodeURIComponent(state.query)}` : ''}`);
      const stepChanged = focusedStep.current !== index;
      const focusLost = !document.activeElement || document.activeElement === document.body;
      if (stepChanged) {
        setInspectingPage(false);
        const body = card.current?.querySelector<HTMLElement>('.fs-coachmark-body');
        if (body) body.scrollTop = 0;
      }
      if (stepChanged || focusLost) card.current?.focus({ preventScroll: true });
      focusedStep.current = index;
    });
    return () => cancelAnimationFrame(frame);
  }, [index, catalogReady]);

  useEffect(() => {
    let alive = true;
    let scrolled: Element | null = null;
    let frame = 0;
    const started = performance.now();
    const content = document.querySelector<HTMLElement>('#product-content');
    let observedElement: HTMLElement | null = null;
    let lastTargetDetectedAt = 0;
    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;
    const scheduleMeasure = () => {
      if (!alive || frame) return;
      frame = requestAnimationFrame(() => { frame = 0; measure(); });
    };
    const measure = () => {
      if (!alive) return;
      const scope = document.querySelector('#product-content [data-journey-active="true"]');
      const element = path === expected ? scope?.querySelector<HTMLElement>(step.target) : null;
      setTargetAvailable(Boolean(element && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden'));
      const fallback = () => {
        setTarget(null);
        const nextPlacement = coachmarkPosition({ left: 24, top: 90, right: 24, bottom: 90 }, window.innerWidth, window.innerHeight, card.current?.offsetHeight || 360);
        setPlacement(previous => sameCoachmarkPosition(previous, nextPlacement) ? previous : nextPlacement);
        setPhase(previous => previous === 'fallback' ? previous : 'fallback');
      };
      if (element && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden') {
        if (observedElement !== element) {
          resizeObserver?.disconnect();
          observedElement = element;
          lastTargetDetectedAt = performance.now();
          resizeObserver?.observe(element);
          if (scope instanceof Element) resizeObserver?.observe(scope);
          if (content) resizeObserver?.observe(content);
          if (card.current) resizeObserver?.observe(card.current);
        }
        const contentRect = content?.getBoundingClientRect();
        const cardBottom = card.current ? Number.parseFloat(getComputedStyle(card.current).bottom) : 12;
        const bottomGap = Number.isFinite(cardBottom) ? Math.max(12, cardBottom) : 12;
        const usableBottom = window.innerHeight - (card.current?.offsetHeight || 340) - bottomGap - 16;
        const rect = element.getBoundingClientRect();
        const usableTop = Math.max(contentRect?.top || 0, 0) + 16;
        const visible = rect.bottom > usableTop && rect.top >= usableTop - 4 && rect.top < usableBottom - 24 && rect.right > 0 && rect.left < window.innerWidth;
        if (scrolled !== element) {
          scrolled = element;
          if (content) content.scrollBy({ top: rect.top - usableTop, behavior: 'instant' });
          else element.scrollIntoView({ behavior: 'instant', block: 'start', inline: 'nearest' });
        }
        if (!visible) {
          setTarget(null);
          setPhase('waiting');
          if (targetPhase(false, false, performance.now() - started) === 'fallback') fallback();
          else scheduleMeasure();
          return;
        }
        const top = Math.max(rect.top, contentRect?.top || 0, 0);
        const bottom = Math.min(rect.bottom, usableBottom);
        const left = Math.max(8, rect.left), right = Math.min(rect.right, window.innerWidth - 8);
        const clipped = { left, right, top, bottom, width: right - left, height: bottom - top };
        setTarget(previous => previous && previous.left === clipped.left && previous.top === clipped.top && previous.width === clipped.width && previous.height === clipped.height ? previous : clipped);
        const nextPlacement = coachmarkPosition(clipped, window.innerWidth, window.innerHeight, card.current?.offsetHeight || 360);
        setPlacement(previous => sameCoachmarkPosition(previous, nextPlacement) ? previous : nextPlacement);
        setPhase(previous => previous === 'ready' ? previous : 'ready');
        if (performance.now() - lastTargetDetectedAt < 450) scheduleMeasure();
      } else if (targetPhase(false, false, performance.now() - started) === 'fallback') fallback();
      else scheduleMeasure();
    };
    resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      // A route can replace its loading shell after the first scroll. Re-align on
      // layout changes so the highlighted control does not fall behind the card.
      scrolled = null;
      scheduleMeasure();
    });
    mutationObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(scheduleMeasure);
    resizeObserver?.observe(card.current || document.body);
    mutationObserver?.observe(content || document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'] });
    window.addEventListener('resize', scheduleMeasure);
    document.addEventListener('scroll', scheduleMeasure, true);
    scheduleMeasure();
    return () => {
      alive = false;
      if (frame) cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
      document.removeEventListener('scroll', scheduleMeasure, true);
    };
  }, [index, expected, path, step.target, recenterRequest]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      const modalOpen = Array.from(document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"][aria-modal="true"]'))
        .some(dialog => dialog.getClientRects().length > 0 && !dialog.closest('[hidden], [inert], [aria-hidden="true"]'));
      if (modalOpen) return;
      const action = tourKey(event.key);
      if (action === 'close') { event.preventDefault(); close(); }
      if ((action === 'next' || action === 'back') && document.activeElement === card.current) {
        event.preventDefault();
        const state = useProduct.getState();
        if (action === 'next' && index === tourSteps.length - 1) {
          state.recordJourney('tour_completed');
          close();
        } else {
          state.setDemoIndex(nextTourIndex(index, action));
        }
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [index]);
  function close() {
    const state = useProduct.getState();
    state.navigate(`${origin.current.path}${origin.current.search}`);
    state.setQuery(origin.current.query);
    state.setDemoIndex(-1);
  }
  return <div className="fs-tour-layer">
    {target ? <div className="fs-tour-spotlight" aria-hidden="true" style={{ left: target.left - 4, top: target.top - 4, width: target.width + 8, height: target.height + 8 }} /> : <div className="fs-tour-dim" aria-hidden="true" />}
    <div ref={card} role="dialog" aria-modal="false" aria-labelledby="tour-title" aria-describedby={inspectingPage ? undefined : 'tour-detail tour-status'} aria-keyshortcuts="ArrowLeft ArrowRight Escape" tabIndex={-1} className={`fs-coachmark ${placement.mobile ? 'mobile' : ''}`} style={placement.mobile ? { left: placement.left, top: 'auto', bottom: 'max(12px, env(safe-area-inset-bottom))' } : { left: placement.left, top: placement.top }}>
      <div className="fs-coachmark-top"><span aria-live="polite" aria-atomic="true">{`Step ${index + 1} of ${tourSteps.length}`}<strong id="tour-title" className="fs-tour-step-title">{step.title}</strong></span><div className="fs-coachmark-header-actions"><button type="button" className="fs-tour-inspect" aria-expanded={!inspectingPage} aria-controls="tour-explanation" onClick={() => { setInspectingPage(value => !value); if (inspectingPage) setRecenterRequest(value => value + 1); }}>{inspectingPage ? 'Read guide' : 'Inspect page'}</button>{!inspectingPage && targetAvailable && <button type="button" className="fs-tour-return-focus" aria-label="Show this step’s highlighted area" title="Bring the highlighted control into view" onClick={() => { card.current?.focus({ preventScroll: true }); setFocusOutsideGuide(false); setRecenterRequest(value => value + 1); }}>Show area<Icon name="arrow" size={14} /></button>}{!inspectingPage && focusOutsideGuide && !targetAvailable && <button type="button" className="fs-tour-return-focus" onClick={() => card.current?.focus({ preventScroll: true })}>Resume guide<Icon name="arrow" size={14} /></button>}<button className="p-icon-button" aria-label="Close guided tour" onClick={close}><Icon name="close" /></button></div></div>
      <progress hidden={inspectingPage} max={tourSteps.length} value={index + 1} aria-label="Tour progress" />
      <div id="tour-explanation" hidden={inspectingPage} className="fs-coachmark-body" role="region" aria-label="Step explanation and topic choices" tabIndex={0}>
      <div className="fs-tour-up-next" aria-hidden="true"><span>{index === tourSteps.length - 1 ? 'Your next move' : 'Coming next'}</span><b>{tourSteps[index + 1]?.title || 'Explore at your own pace'}</b></div>
      <div className="fs-coachmark-copy"><aside className="fs-tour-key-point" aria-label="Key point"><strong>KEY POINT</strong><p>{step.keyPoint}</p></aside><p id="tour-detail">{step.detail}</p></div>
      <p className="fs-tour-status" id="tour-status" role="status">{caseNotice || (phase === 'waiting' ? 'Finding this control… You can continue or close at any time.' : phase === 'fallback' ? targetAvailable ? 'This area is outside the viewing space. Choose Show area in the guide header to bring it back, or continue at your own pace.' : step.fallback : `Try this: ${step.action}. Continue when you are ready.`)}</p>
      {phase === 'ready' && (!caseAvailability || caseActionAvailable) && <button className="p-text-button" onClick={() => {
        const element = document.querySelector<HTMLElement>(`#product-content [data-journey-active="true"] ${step.target}`);
        const controls = element ? [element, ...element.querySelectorAll<HTMLElement>('button, input, select, a[href]')] : [];
        const control = controls.find(candidate => {
          if (!candidate.matches('button, input, select, a[href]') || candidate.matches(':disabled') || !candidate.getClientRects().length || candidate.closest('[inert], [hidden], [aria-hidden="true"]') || getComputedStyle(candidate).visibility === 'hidden') return false;
          const bounds = candidate.getBoundingClientRect();
          return target !== null && bounds.top >= target.top - 4 && bounds.bottom <= target.bottom + 4 && bounds.left >= target.left - 4 && bounds.right <= target.right + 4;
        });
        if (control) control.focus({ preventScroll: true });
        else if (element) {
          const area = element.matches(':disabled') ? element.closest<HTMLElement>('.p-live-player, .p-panel, section') : element;
          if (area && area.getClientRects().length && !area.closest('[inert], [hidden], [aria-hidden="true"]')) {
            if (!area.hasAttribute('tabindex')) area.tabIndex = -1;
            area.focus({ preventScroll: true });
          }
        }
      }}>Focus highlighted area <Icon name="arrow" size={14} /></button>}
      {mode === 'presentation' && <div className="fs-scenario-note">Scenario mode: illustrative indicators, not live conditions.<button className="p-text-button" onClick={() => useProduct.getState().setMode('observed')}>Return to observations</button></div>}
      <details key={index} className="fs-tour-topics" onToggle={event => { if (event.currentTarget.open) event.currentTarget.querySelector<HTMLElement>('button[aria-current="step"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' }); }}><summary><span>Choose a topic</span><span className="fs-tour-topic-current">{String(index + 1).padStart(2, '0')} · {step.title}</span><Icon name="plus" size={15} /></summary><nav aria-label="Guided tour topics"><ol>{tourSteps.map((topic, topicIndex) => <li key={topic.title}><button type="button" aria-current={topicIndex === index ? 'step' : undefined} aria-label={`Go to step ${topicIndex + 1}: ${topic.title}`} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); card.current?.focus({ preventScroll: true }); useProduct.getState().setDemoIndex(topicIndex); }}><span className="fs-tour-topic-number" aria-hidden="true">{String(topicIndex + 1).padStart(2, '0')}</span><span className="fs-tour-topic-title">{topic.title}</span>{topicIndex === index && <small aria-hidden="true">Current</small>}</button></li>)}</ol></nav></details>
      <details className="fs-tour-keyboard-help"><summary><Icon name="info" size={14} />Keyboard navigation</summary><p>← / → change steps when the guide has focus. Tab moves through page controls. Escape returns to where you started.</p></details>
      </div>
      <footer hidden={inspectingPage}><button className="p-text-button" onClick={close}>Skip tour</button><button className="p-button" disabled={index === 0} onClick={() => useProduct.getState().setDemoIndex(nextTourIndex(index, 'back'))}>Back</button><button className="p-button primary" onClick={() => { if (index === tourSteps.length - 1) { useProduct.getState().recordJourney('tour_completed'); close(); } else useProduct.getState().setDemoIndex(nextTourIndex(index, 'next')); }}>{index === tourSteps.length - 1 ? 'Finish tour' : 'Next'}<Icon name="arrow" size={14} /></button></footer>
    </div>
  </div>;
}
