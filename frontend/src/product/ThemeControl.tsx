import { useLayoutEffect } from 'react';
import { useProduct } from './store';
import { Icon } from './ui';

export function ThemeControl() {
  const theme = useProduct(state => state.theme);
  const dark = theme === 'dark';
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#111216' : '#f5f6f8');
  }, [theme, dark]);
  return <button className="p-theme-toggle p-icon-button" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Switch to light mode' : 'Switch to dark mode'} aria-pressed={dark} onClick={() => useProduct.getState().setTheme(dark ? 'light' : 'dark')}><Icon name={dark ? 'sun' : 'moon'} size={19} /></button>;
}

export function ThemeSettings() {
  const theme = useProduct(state => state.theme);
  return <fieldset className="p-theme-settings"><legend>Appearance</legend><p>Choose a theme for the entire workspace. Your preference is saved in this browser.</p><div>{(['light', 'dark'] as const).map(value => <label key={value}><input type="radio" name="theme" value={value} checked={theme === value} onChange={() => useProduct.getState().setTheme(value)} /><Icon name={value === 'dark' ? 'moon' : 'sun'} />{value === 'dark' ? 'Dark mode' : 'Light mode'}</label>)}</div></fieldset>;
}
