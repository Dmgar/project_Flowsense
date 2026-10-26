import { useId, useLayoutEffect } from 'react';
import { useProduct } from './store';
import { Icon } from './ui';
import './appearance.css';

export function ThemeControl() {
  const theme = useProduct(state => state.theme);
  const dark = theme === 'dark';
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#111316' : '#F2F3F1');
  }, [theme, dark]);
  return <button className="p-theme-toggle p-icon-button" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => useProduct.getState().setTheme(dark ? 'light' : 'dark')}><Icon name={dark ? 'sun' : 'moon'} size={19} /></button>;
}

export function ThemeSettings() {
  const theme = useProduct(state => state.theme);
  const groupId = useId();
  return <fieldset className="p-theme-settings"><legend>Appearance</legend><p>Choose a theme for the entire workspace. Your preference is saved in this browser.</p><div>{(['light', 'dark'] as const).map(value => <label key={value} className={`p-theme-option ${theme === value ? 'selected' : ''}`}>
    <span className="p-theme-preview" data-preview={value} aria-hidden="true"><span className="p-theme-preview-rail"><img src={`/brand/isotipo-${value === 'dark' ? 'white' : 'petrol'}.png`} alt="" /><i /><i /><i /></span><span className="p-theme-preview-workspace"><span className="p-theme-preview-toolbar"><i /><i /></span><span className="p-theme-preview-heading" /><span className="p-theme-preview-tiles"><i /><i /><i /></span><span className="p-theme-preview-chart"><i /><i /><i /><i /><i /><i /></span></span></span>
    <span className="p-theme-option-heading"><input type="radio" name={`${groupId}-theme`} aria-label={value === 'dark' ? 'Dark mode' : 'Light mode'} aria-describedby={`${groupId}-${value}-description`} value={value} checked={theme === value} onChange={() => useProduct.getState().setTheme(value)} /><Icon name={value === 'dark' ? 'moon' : 'sun'} size={17} /><strong>{value === 'dark' ? 'Dark mode' : 'Light mode'}</strong>{theme === value && <span className="p-theme-selected" aria-hidden="true"><Icon name="check" size={13} />Selected</span>}</span>
    <span id={`${groupId}-${value}-description`} className="p-theme-option-description">{value === 'dark' ? 'Dark surfaces with clear petrol accents.' : 'Bright surfaces with crisp, readable details.'}</span>
  </label>)}</div></fieldset>;
}
