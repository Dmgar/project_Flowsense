import { Icon } from './ui';
import './guideGlossary.css';

const terms = [
  ['Registered source', 'A camera listed in the catalog. Having a video link does not guarantee that the provider is sending usable video now.'],
  ['Observation', 'Information produced from an analyzed video sample. Check its camera and timestamp; a detection alone does not confirm an incident.'],
  ['Evidence score', 'A model score used to help prioritize human review. It is not a calibrated probability that an incident occurred. Some records have no score.'],
  ['Road zone', 'A reviewed area and travel direction inside a camera scene. It helps associate tracks with a road; it does not calibrate speed or prove coverage of a whole corridor.'],
  ['Saved case', 'A review record with a status, responsible team and audit history. Read its provenance to distinguish observations from presentation examples.'],
  ['Unavailable or zero?', 'Unavailable means a measurement could not be supplied or established. Zero is a reported value. Missing samples, an offline camera or an unloaded record must not be read as zero traffic.'],
  ['Comparison baseline', 'A reference used to compare measurements. Without a measured baseline and matching observation periods, a percentage change does not establish an improvement. Presentation comparisons remain illustrative.'],
  ['Presentation scenario', 'Illustrative data for learning the interface. Its indicators and comparisons do not describe current traffic or demonstrate a measured improvement.'],
];

export function GuideGlossary() {
  return <section className="fs-guide-glossary" aria-labelledby="guide-glossary-title"><details><summary id="guide-glossary"><span><Icon name="info" size={19} /><span><strong id="guide-glossary-title">A few useful terms</strong><small>Plain-language reference for the workspace</small></span></span><Icon name="plus" size={17} /></summary><dl>{terms.map(([term, definition]) => <div key={term}><dt>{term}</dt><dd>{definition}</dd></div>)}</dl></details></section>;
}
