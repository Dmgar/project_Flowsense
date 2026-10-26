import { Icon } from './ui';
import './pageReturn.css';

export function PageReturn() {
  const returnToHeading = () => {
    const content = document.getElementById('product-content');
    const heading = content?.querySelector<HTMLElement>('[data-journey-active="true"] h1');
    const destination = heading || content;
    if (!destination) return;
    if (!destination.hasAttribute('tabindex')) destination.tabIndex = -1;
    destination.focus({ preventScroll: true });
    content?.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };
  return <nav className="p-page-return" aria-label="Page navigation"><span>Continue from the top of this page</span><button type="button" onClick={returnToHeading}><Icon name="arrow" size={16} />Back to page heading</button></nav>;
}
