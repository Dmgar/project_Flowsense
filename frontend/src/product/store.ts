import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Camera, MobilityCase } from './types';

interface ProductState {
  path: string; navigate: (path: string) => void; cameras: Camera[]; setCameras: (v: Camera[]) => void;
  cases: MobilityCase[]; setCases: (v: MobilityCase[]) => void; selectedSignal: string; selectSignal: (v: string) => void;
  district: string; setDistrict: (v: string) => void; period: string; setPeriod: (v: string) => void;
  query: string; setQuery: (v: string) => void; mode: 'presentation' | 'observed'; setMode: (v: 'presentation' | 'observed') => void;
  layers: Record<string, boolean>; toggleLayer: (v: string) => void; toast: string; notify: (v: string) => void;
  error: string; setError: (v: string) => void; connected: boolean; setConnected: (v: boolean) => void;
  demoIndex: number; setDemoIndex: (v: number) => void;
  mapFocus: [number, number] | null; setMapFocus: (v: [number, number] | null) => void;
}
export const useProduct = create<ProductState>()(persist((set) => ({
  path: window.location.pathname === '/' ? '/overview' : window.location.pathname,
  navigate: (path) => { window.history.pushState({}, '', path); set({ path, query: '' }); },
  cameras: [], setCameras: (cameras) => set({ cameras }), cases: [], setCases: (cases) => set({ cases }),
  selectedSignal: 'SIG-001', selectSignal: (selectedSignal) => set({ selectedSignal }),
  district: 'Todos los distritos', setDistrict: (district) => set({ district }),
  period: 'Últimos 15 min', setPeriod: (period) => set({ period }), query: '', setQuery: (query) => set({ query }),
  mode: 'presentation', setMode: (mode) => set({ mode }),
  layers: { congestion: true, cameras: true, incidents: true, pedestrians: false, freight: false, clusterCameras: true },
  toggleLayer: (name) => set((state) => ({ layers: { ...state.layers, [name]: name === 'clusterCameras' ? state.layers[name] === false : !state.layers[name] } })),
  toast: '', notify: (toast) => set({ toast }), error: '', setError: (error) => set({ error }),
  connected: false, setConnected: (connected) => set({ connected }), demoIndex: -1, setDemoIndex: (demoIndex) => set({ demoIndex }),
  mapFocus: null, setMapFocus: (mapFocus) => set({ mapFocus }),
}), { name: 'flowsense-product-preferences', partialize: (state) => ({ period: state.period, mode: state.mode, layers: state.layers }) }));
window.addEventListener('popstate', () => useProduct.setState({ path: window.location.pathname, query: '' }));
