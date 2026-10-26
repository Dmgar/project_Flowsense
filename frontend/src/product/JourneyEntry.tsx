import { useEffect } from 'react';
import { journeyTasks } from './journey';
import { useProduct } from './store';
import { Icon } from './ui';

export function JourneyEntry() {
  const mode = useProduct(state => state.mode);
  const query = useProduct(state => state.query);
  const setMode = useProduct(state => state.setMode);
  const startTour = useProduct(state => state.startTour);
  const navigate = useProduct(state => state.navigate);
  const recordJourney = useProduct(state => state.recordJourney);
  useEffect(() => { useProduct.getState().recordJourney('entry'); }, []);
  return <section className="fs-entry" data-tour="tasks" aria-labelledby="journey-title">
    <div className="fs-entry-heading"><div><span className="p-eyebrow">YOUR NEXT QUESTION</span><h2 id="journey-title">What would you like to understand?</h2><p className="fs-entry-intro">Choose a starting point. You can switch tools at any time.</p></div><button className="p-text-button fs-entry-tour" onClick={event => startTour(event.currentTarget)}><Icon name="play" size={16} />Take the guided tour <Icon name="arrow" size={15} /></button></div>
    <div className="fs-mode-choice" role="group" aria-label="Working mode">
      <button type="button" aria-pressed={mode === 'observed'} onClick={() => setMode('observed')}><span><Icon name="camera" size={17} /><strong>Available observations</strong>{mode === 'observed' && <span className="fs-mode-selected" aria-hidden="true">Selected</span>}</span><small>Use connected sources and saved measurements. Missing data stays unavailable.</small></button>
      <button type="button" aria-pressed={mode === 'presentation'} onClick={() => setMode('presentation')}><span><Icon name="play" size={17} /><strong>Presentation scenario</strong>{mode === 'presentation' && <span className="fs-mode-selected" aria-hidden="true">Selected</span>}</span><small>Explore illustrative examples; they do not describe current traffic.</small></button>
    </div>
    <div className="fs-tasks">{journeyTasks.map((task, index) => <a key={task.id} href={`${task.route}${query ? `?q=${encodeURIComponent(query)}` : ''}`} style={{ animationDelay: `${index * 55}ms` }} aria-label={`${task.title}. ${task.detail} Get started.`} onClick={event => { if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); recordJourney('task_chosen'); navigate(`${task.route}${query ? `?q=${encodeURIComponent(query)}` : ''}`); }}><span className="fs-task-top" aria-hidden="true"><span className="fs-task-icon"><Icon name={task.icon} /></span><span className="fs-task-category">{task.category}</span></span><strong>{task.title}</strong><span className="fs-task-detail">{task.detail}</span><span className="fs-task-open" aria-hidden="true">Get started <Icon name="arrow" size={14} /></span></a>)}</div>
  </section>;
}
