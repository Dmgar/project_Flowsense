import { useProduct } from './store';
import { Icon } from './ui';
import { journeyNextCheck, journeyNextUrl } from './journey';

export function JourneyNext() {
  const path = useProduct(s => s.path);
  const query = useProduct(s => s.query);
  const next = journeyNextCheck(path, {
    cameraCatalogLoaded: useProduct(s => s.cameraCatalogLoaded),
    cameraCatalogFailed: useProduct(s => s.cameraCatalogFailed),
    cameraCount: useProduct(s => s.cameras.length),
    casesLoadStatus: useProduct(s => s.casesLoadStatus),
    caseCount: useProduct(s => s.cases.length),
  });
  if (!next) return null;
  const destination = journeyNextUrl(next, query);
  return <aside className="fs-next-check" aria-labelledby="next-check-title"><div className="fs-next-check-content"><span className="fs-next-check-icon" aria-hidden="true"><Icon name="arrow" size={22} /></span><div><span className="p-eyebrow">NEXT USEFUL CHECK</span><h2 id="next-check-title">{next[1]}</h2><p>{next[0]}</p></div></div><a className="p-button" href={destination} onClick={event => { if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); useProduct.getState().navigate(destination); }}>Continue: {next[1]}<Icon name="arrow" size={15} /></a></aside>;
}
