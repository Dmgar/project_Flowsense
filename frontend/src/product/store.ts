import { recordJourney, type JourneyEvent } from './journey.ts';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Camera, MobilityCase } from './types';
import { updateProviderAvailability } from './monitoring.ts';

interface ProductState {
  path: string; navigate: (path: string) => void; cameras: Camera[]; setCameras: (v: Camera[]) => void;
  setCameraVideoHealth: (id: string, health: NonNullable<Camera['video_health']>) => void;
  cameraCatalogLoaded: boolean; cameraCatalogFailed: boolean; setCameraCatalogStatus: (loaded: boolean, failed: boolean) => void;
  casesLoaded: boolean; casesLoadStatus: 'loading' | 'refreshing' | 'ready' | 'error'; setCasesLoadStatus: (status: ProductState['casesLoadStatus']) => void;
  cases: MobilityCase[]; setCases: (v: MobilityCase[]) => void; selectedSignal: string; selectSignal: (v: string) => void;
  district: string; setDistrict: (v: string) => void; period: string; setPeriod: (v: string) => void;
  query: string; setQuery: (v: string) => void; mode: 'presentation' | 'observed'; setMode: (v: 'presentation' | 'observed') => void;
  explorerRadiusKm: number; setExplorerRadiusKm: (v: number) => void;
  explorerMapStyle: 'streets' | 'terrain'; setExplorerMapStyle: (v: 'streets' | 'terrain') => void;
  explorerVideoFilter: 'all' | 'registered' | 'checked'; setExplorerVideoFilter: (v: 'all' | 'registered' | 'checked') => void;
  layers: Record<string, boolean>; toggleLayer: (v: string) => void; toast: string; notify: (v: string) => void;
  error: string; setError: (v: string) => void; connected: boolean; setConnected: (v: boolean) => void;
  journeyEvents: JourneyEvent[]; recordJourney: (event: JourneyEvent) => void;
  tourReturnFocus: HTMLElement | null; startTour: (trigger?: HTMLElement) => void;
  demoIndex: number; setDemoIndex: (v: number) => void;
  mapFocus: [number, number] | null; setMapFocus: (v: [number, number] | null) => void;
  favoriteCameras: string[]; toggleFavorite: (id: string) => void;
  watchCameras: string[]; toggleWatch: (id: string) => void;
  theme: 'light' | 'dark'; setTheme: (theme: 'light' | 'dark') => void;
}
export const useProduct = create<ProductState>()(persist((set) => ({
  path: window.location.pathname === '/' ? '/overview' : window.location.pathname,
  navigate: (path) => { window.history.pushState({}, '', path); set({ path: path.split('?')[0], query: new URLSearchParams(path.split('?')[1]).get('q') || '' }); },
  cameras: [], setCameras: (cameras) => { updateProviderAvailability(cameras); set({ cameras }); },
  setCameraVideoHealth: (id, health) => set(state => {
    const cameras = state.cameras.map(camera => camera.id === id ? { ...camera, video_health: health } : camera);
    updateProviderAvailability(cameras);
    return { cameras };
  }), cameraCatalogLoaded: false, cameraCatalogFailed: false,
  setCameraCatalogStatus: (cameraCatalogLoaded, cameraCatalogFailed) => set({ cameraCatalogLoaded, cameraCatalogFailed }),
  casesLoaded: false, casesLoadStatus: 'loading', setCasesLoadStatus: (casesLoadStatus) => set({ casesLoadStatus }), cases: [], setCases: (cases) => set({ cases, casesLoaded: true, casesLoadStatus: 'ready' }),
  selectedSignal: 'SIG-001', selectSignal: (selectedSignal) => set({ selectedSignal }),
  district: "All districts", setDistrict: (district) => set({ district }),
  period: "Last 15 min", setPeriod: (period) => set({ period }), query: new URLSearchParams(window.location.search).get('q') || '', setQuery: (query) => {
    if (window.location.pathname === '/explore') window.history.replaceState({}, '', `/explore${query ? `?q=${encodeURIComponent(query)}` : ''}`);
    set({ query });
  },
  mode: 'presentation', setMode: (mode) => set({ mode }),
  explorerRadiusKm: 1.5, setExplorerRadiusKm: (explorerRadiusKm) => set({ explorerRadiusKm }),
  explorerMapStyle: 'streets', setExplorerMapStyle: (explorerMapStyle) => set({ explorerMapStyle }),
  explorerVideoFilter: 'all', setExplorerVideoFilter: (explorerVideoFilter) => set({ explorerVideoFilter }),
  theme: window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  setTheme: (theme) => set({ theme }),
  layers: { congestion: true, cameras: true, incidents: true, pedestrians: false, freight: false, clusterCameras: true },
  toggleLayer: (name) => set((state) => ({ layers: { ...state.layers, [name]: name === 'clusterCameras' ? state.layers[name] === false : !state.layers[name] } })),
  toast: '', notify: (toast) => set({ toast }), error: '', setError: (error) => set({ error }),
  journeyEvents: [], recordJourney: (event) => set(state => ({ journeyEvents: recordJourney(state.journeyEvents, event) })),
  tourReturnFocus: null, startTour: (trigger) => set({ demoIndex: 0, tourReturnFocus: trigger ?? (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null) }),
  connected: false, setConnected: (connected) => set({ connected }), demoIndex: -1, setDemoIndex: (demoIndex) => set({ demoIndex }),
  mapFocus: null, setMapFocus: (mapFocus) => set({ mapFocus }),
  favoriteCameras: [], toggleFavorite: (id) => set((state) => ({ favoriteCameras: state.favoriteCameras.includes(id) ? state.favoriteCameras.filter(key => key !== id) : [...state.favoriteCameras, id] })),
  watchCameras: [], toggleWatch: (id) => set(state => state.watchCameras.includes(id) ? { watchCameras: state.watchCameras.filter(key => key !== id) } : state.watchCameras.length < 4 ? { watchCameras: [...state.watchCameras, id] } : { toast: "The desk supports four cameras. Remove one to add another." }),
}), {
  name: 'flowsense-product-preferences',
  partialize: (state) => ({ period: state.period, mode: state.mode, theme: state.theme, layers: state.layers, favoriteCameras: state.favoriteCameras, watchCameras: state.watchCameras }),
  merge: (persisted, current) => {
    const preferences = persisted as Partial<ProductState> | undefined;
    const savedPeriod = preferences?.period;
    const periods = ['Last 15 min', 'Last hour', 'Last 24 h', 'Last 7 days'];
    // Older releases persisted translated labels. Recover their duration without
    // changing camera selections, layers or the operator's working mode.
    const duration = savedPeriod?.match(/\d+/)?.[0];
    const period = savedPeriod && periods.includes(savedPeriod) ? savedPeriod
      : !savedPeriod ? current.period
      : duration === '15' ? periods[0]
      : duration === '24' ? periods[2]
      : duration === '7' ? periods[3] : periods[1];
    return { ...current, ...preferences, period,
      theme: preferences?.theme === 'dark' || preferences?.theme === 'light' ? preferences.theme : current.theme,
      layers: { ...current.layers, ...preferences?.layers },
    };
  },
}));
window.addEventListener('popstate', () => useProduct.setState({ path: window.location.pathname, query: new URLSearchParams(window.location.search).get('q') || '' }));

export function openObservedCamera(id: string) {
  const state = useProduct.getState();
  state.setMode('observed');
  state.navigate(`/cameras/${id}`);
}
