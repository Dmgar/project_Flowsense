import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import type {
  WebSocketMessage,
  EdgeUpdate,
  VehiclePosition,
  MissionAlert,
  RouteResponse,
} from '../types';

const WS_URL =
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/telemetry`;

const RECONNECT_DELAY = 2000;
const HEARTBEAT_INTERVAL = 15000;
const MAX_RECONNECT_DELAY = 15000;

export function useTelemetrySocket() {
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
          const d = msg.data as { updated_edges: EdgeUpdate[] };
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
              message: `Ruta recalculada en vivo — ahorro ${r.savings_pct}%`,
              severity: 'info',
              timestamp: msg.timestamp,
            });
          } else {
            addAlert({
              message: 'Corredor dinámico FlowSense despejado',
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
              message: `Siguiendo ${v.vehicle_id} en vivo`,
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
    const delay = Math.min(RECONNECT_DELAY * (retryCount.current + 1), MAX_RECONNECT_DELAY);
    retryCount.current++;
    clearTimeout(reconnectTimer.current);
    reconnectTimer.current = setTimeout(connectRef.current, delay);
  }

  function connect() {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

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
    connect();

    heartbeatTimer.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send('ping');
      }
    }, HEARTBEAT_INTERVAL);

    return () => {
      if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}