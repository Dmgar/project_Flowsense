import { useEffect, useRef } from 'react';
import { telemetryUrl } from '../api/urls';
import { useStore } from '../store/useStore';
import type {
  WebSocketMessage,
  EdgeUpdate,
  VehiclePosition,
  MissionAlert,
  RouteResponse,
} from '../types';

const WS_URL = telemetryUrl(window.location.origin);

const RECONNECT_DELAY = 2000;
const HEARTBEAT_INTERVAL = 15000;
const MAX_RECONNECT_DELAY = 15000;

export function useTelemetrySocket() {
  const mounted = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const retryCount = useRef(0);
  const connectRef = useRef<() => void>(() => {});

  const setConnectionStatus = useStore((s) => s.setConnectionStatus);
  const updateEdgeCongestion = useStore((s) => s.updateEdgeCongestion);
  const updateVehicle = useStore((s) => s.updateVehicle);
  const addAlert = useStore((s) => s.addAlert);
  const addSecondsSaved = useStore((s) => s.addSecondsSaved);
  const setActiveRoute = useStore((s) => s.setActiveRoute);
  const setFollowUnitId = useStore((s) => s.setFollowUnitId);

  function handleMessage(raw: string) {
    try {
      const msg: WebSocketMessage = JSON.parse(raw);

      switch (msg.event) {
        case 'traffic_update': {
          const d = msg.data as { updated_edges?: EdgeUpdate[]; status?: string };
          if (d.status === 'reset' && (!d.updated_edges || d.updated_edges.length === 0)) {
            useStore.setState((state) => ({
              geojsonEdges: state.geojsonEdges.map((edge) => ({
                ...edge,
                properties: {
                  ...edge.properties,
                  congestion_factor: 0,
                  vehicle_count: 0,
                  color: '#10B981',
                },
              })),
            }));
          }
          for (const e of d.updated_edges ?? []) {
            updateEdgeCongestion(e.u, e.v, e.key, e.congestion_factor, e.vehicle_count);
          }
          break;
        }
        case 'route_update':
        case 'route_recalculated': {
          const r = msg.data as RouteResponse;
          setActiveRoute(r);
          const savedThisRoute = Math.max(0, r.baseline_eta_seconds - r.total_estimated_time_s);
          if (savedThisRoute > 0) addSecondsSaved(Math.round(savedThisRoute));
          if (r.recalculated) {
            addAlert({
              message: `Route recalculated live — savings ${r.savings_pct}%`,
              severity: 'info',
              timestamp: msg.timestamp,
            });
          } else {
            addAlert({
              message: 'FlowSense dynamic corridor cleared',
              severity: 'info',
              timestamp: msg.timestamp,
            });
          }
          break;
        }
        case 'vehicle_telemetry': {
          const v = msg.data as VehiclePosition;
          updateVehicle(v);
          if (useStore.getState().autoFollowNextDispatch) {
            useStore.getState().setAutoFollowNextDispatch(false);
            setFollowUnitId(v.vehicle_id);
            addAlert({
              message: `Following ${v.vehicle_id} live`,
              severity: 'info',
              timestamp: msg.timestamp,
            });
          }
          break;
        }
        case 'mission_alert': {
          const a = msg.data as MissionAlert;
          addAlert({ ...a, timestamp: msg.timestamp });
          if (a.severity === 'info' && a.message.includes('saved')) {
            const match = a.message.match(/(\d+)/);
            if (match) addSecondsSaved(parseInt(match[1], 10));
          }
          break;
        }
      }
    } catch {
      // ignore malformed messages
    }
  }

  function scheduleReconnect() {
    if (!mounted.current) return;
    const delay = Math.min(RECONNECT_DELAY * (retryCount.current + 1), MAX_RECONNECT_DELAY);
    retryCount.current++;
    clearTimeout(reconnectTimer.current);
    reconnectTimer.current = setTimeout(connectRef.current, delay);
  }

  function connect() {
    if (!mounted.current || wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return;

    setConnectionStatus('reconnecting');

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        retryCount.current = 0;
        setConnectionStatus('connected');
      };

      ws.onmessage = (e) => handleMessage(e.data);

      ws.onclose = () => {
        if (!mounted.current || wsRef.current !== ws) return;
        wsRef.current = null;
        setConnectionStatus('offline');
        scheduleReconnect();
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      setConnectionStatus('offline');
      scheduleReconnect();
    }
  }

  connectRef.current = connect;

  useEffect(() => {
    mounted.current = true;
    connect();

    heartbeatTimer.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send('ping');
      }
    }, HEARTBEAT_INTERVAL);

    return () => {
      mounted.current = false;
      if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
        ws.close();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
