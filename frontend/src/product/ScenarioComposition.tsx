import { classColors, classLabels } from './data';
import './scenarioComposition.css';

const categories = ['car', 'motorcycle', 'bus', 'truck'];
const periodValues = [72, 14, 9, 5];
const baselineValues = [68, 18, 9, 5];

export function ScenarioComposition({ baseline }: { baseline: boolean }) {
  return <figure className="p-scenario-composition"><figcaption>Illustrative class shares · not measured corridor traffic</figcaption><div className="p-stack-comparison" aria-hidden="true">{[periodValues, ...(baseline ? [baselineValues] : [])].map((values, row) => <div key={row}><span>{row === 0 ? 'Example period' : 'Example baseline'}</span><div className="p-stacked-bar">{values.map((value, index) => <span key={categories[index]} style={{ width: `${value}%`, background: classColors[categories[index]] }}>{value}%</span>)}</div></div>)}</div><div className="p-composition-table-scroll" role="region" aria-label="Illustrative traffic composition" tabIndex={0}><table><caption className="p-sr-only">Illustrative class shares in percent</caption><thead><tr><th scope="col">Category</th><th scope="col">Example period</th>{baseline && <th scope="col">Example baseline</th>}</tr></thead><tbody>{categories.map((category, index) => <tr key={category}><th scope="row"><i style={{ background: classColors[category] }} aria-hidden="true" />{classLabels[category]}</th><td>{periodValues[index]}%</td>{baseline && <td>{baselineValues[index]}%</td>}</tr>)}</tbody></table></div></figure>;
}
