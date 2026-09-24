import { create } from 'zustand';
import type {
  GraphStatus,
  Coordinates,
  RouteResponse,
  VehiclePosition,
  MissionAlert,
  ConnectionStatus,
  GeoJsonEdgeFeature,
  ReplayFrame,
} from '../types';

export type MobilePanel = 'none' | 'dispatch' | 'layers' | 'follow';
export type ReplaySpeed = 1 | 2;

export interface MapPlace extends Coordinates {
  label: string;
  category: 'hospital' | 'fire_station' | 'water' | 'destination';
}

interface FlowSenseState {
  connectionStatus: ConnectionStatus;
  setConnectionStatus: (s: ConnectionStatus) => void;

  graphStatus: GraphStatus | null;
  setGraphStatus: (s: GraphStatus) => void;

  geojsonEdges: GeoJsonEdgeFeature[];
  setGeojsonEdges: (e: GeoJsonEdgeFeature[]) => void;
  updateEdgeCongestion: (u: number, v: number, key: number, congestion: number, vehicleCount: number) => void;

  showCongestionLayer: boolean;
  toggleCongestionLayer: () => void;

  activeRoute: RouteResponse | null;
  setActiveRoute: (r: RouteResponse | null) => void;
  routeOptions: RouteResponse[];
  setRouteOptions: (routes: RouteResponse[]) => void;

  vehicles: Record<string, VehiclePosition>;
  updateVehicle: (v: VehiclePosition) => void;
  clearVehicles: () => void;

  followUnitId: string | null;
  setFollowUnitId: (id: string | null) => void;

  alerts: MissionAlert[];
  addAlert: (a: MissionAlert) => void;
  clearAlerts: () => void;

  secondsSaved: number;
  addSecondsSaved: (s: number) => void;
  resetSecondsSaved: () => void;

  isSimulating: boolean;
  setIsSimulating: (v: boolean) => void;

  isPresentationMode: boolean;
  togglePresentationMode: () => void;

  showBenchmark: boolean;
  toggleBenchmark: () => void;

  replayFrames: ReplayFrame[];
  setReplayFrames: (f: ReplayFrame[]) => void;
  currentReplayIndex: number;
  setCurrentReplayIndex: (i: number) => void;
  isReplaying: boolean;
  setIsReplaying: (v: boolean) => void;
  replaySpeed: ReplaySpeed;
  setReplaySpeed: (s: ReplaySpeed) => void;

  showPrivacyBadge: boolean;
  togglePrivacyBadge: () => void;

  isBooted: boolean;
  setIsBooted: (v: boolean) => void;

  mobilePanel: MobilePanel;
  setMobilePanel: (p: MobilePanel) => void;

  autoFollowNextDispatch: boolean;
  setAutoFollowNextDispatch: (v: boolean) => void;

  origin: MapPlace;
  setOrigin: (p: MapPlace) => void;
  destination: MapPlace | null;
  setDestination: (p: MapPlace | null) => void;
}

export const useStore = create<FlowSenseState>((set) => ({
  connectionStatus: 'offline',
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),

  graphStatus: null,
  setGraphStatus: (graphStatus) => set({ graphStatus }),

  geojsonEdges: [],
  setGeojsonEdges: (geojsonEdges) => set({ geojsonEdges }),
  updateEdgeCongestion: (u, v, key, congestion, vehicleCount) =>
    set((state) => ({
      geojsonEdges: state.geojsonEdges.map((edge) =>
        edge.properties.u === u && edge.properties.v === v && edge.properties.key === key
          ? {
              ...edge,
              properties: {
                ...edge.properties,
                congestion_factor: congestion,
                vehicle_count: vehicleCount,
                color: getCongestionColor(congestion),
              },
            }
          : edge
      ),
    })),

  showCongestionLayer: false,
  toggleCongestionLayer: () => set((s) => ({ showCongestionLayer: !s.showCongestionLayer })),

  activeRoute: null,
  setActiveRoute: (activeRoute) => set({ activeRoute }),
  routeOptions: [],
  setRouteOptions: (routeOptions) => set({ routeOptions }),

  vehicles: {},
  updateVehicle: (v) =>
    set((state) => ({
      vehicles: { ...state.vehicles, [v.vehicle_id]: v },
    })),
  clearVehicles: () => set({ vehicles: {} }),

  followUnitId: null,
  setFollowUnitId: (followUnitId) => set({ followUnitId }),

  alerts: [],
  addAlert: (a) =>
    set((state) => ({
      alerts: [a, ...state.alerts].slice(0, 50),
    })),
  clearAlerts: () => set({ alerts: [] }),

  secondsSaved: 0,
  addSecondsSaved: (s) => set((state) => ({ secondsSaved: state.secondsSaved + s })),
  resetSecondsSaved: () => set({ secondsSaved: 0 }),

  isSimulating: false,
  setIsSimulating: (isSimulating) => set({ isSimulating }),

  isPresentationMode: false,
  togglePresentationMode: () => set((s) => ({ isPresentationMode: !s.isPresentationMode })),

  showBenchmark: false,
  toggleBenchmark: () => set((s) => ({ showBenchmark: !s.showBenchmark })),

  replayFrames: [],
  setReplayFrames: (replayFrames) => set({ replayFrames }),
  currentReplayIndex: 0,
  setCurrentReplayIndex: (currentReplayIndex) => set({ currentReplayIndex }),
  isReplaying: false,
  setIsReplaying: (isReplaying) => set({ isReplaying }),
  replaySpeed: 2,
  setReplaySpeed: (replaySpeed) => set({ replaySpeed }),

  showPrivacyBadge: true,
  togglePrivacyBadge: () => set((s) => ({ showPrivacyBadge: !s.showPrivacyBadge })),

  isBooted: false,
  setIsBooted: (isBooted) => set({ isBooted }),

  mobilePanel: 'none',
  setMobilePanel: (mobilePanel) => set({ mobilePanel }),

  autoFollowNextDispatch: false,
  setAutoFollowNextDispatch: (autoFollowNextDispatch) => set({ autoFollowNextDispatch }),

  origin: { label: 'Times Square, Manhattan', latitude: 40.758, longitude: -73.9855, category: 'destination' },
  setOrigin: (origin) => set({ origin }),
  destination: null,
  setDestination: (destination) => set({ destination }),
}));

function getCongestionColor(c: number): string {
  if (c < 0.35) return '#00e676';
  if (c < 0.7) return '#ffab00';
  return '#ff1744';
}
