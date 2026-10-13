import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  assess,
  clearancePlan,
  loadGraph,
  roadState,
  type Assessment,
  type Graph,
  type Hazard,
  type HazardKind,
  type Stop,
} from './algo';
import { DEMANDS, snapPlaces } from './places';

export interface Driver {
  id: string;
  name: string;
  vehicle: string;
  depot: string;
  path: number[];
  stops: Stop[];
  started_at: number;
  acked: string[];
  updated_at: number;
}
export interface Message {
  id: number;
  driver_id: string | null;
  sender: 'admin' | 'driver' | 'system';
  text: string;
  created_at: number;
}
export interface OpsState {
  now: number;
  hazards: Hazard[];
  drivers: Driver[];
  messages: Message[];
}

const BASE = import.meta.env.VITE_API_BASE ?? '';

async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  state: () => call<OpsState>('GET', '/state'),
  addHazard: (h: { kind: HazardKind; lat: number; lon: number; radius_m: number; severity: number; starts_in?: number; note: string }) =>
    call('POST', '/hazards', h),
  clearHazard: (id: string) => call('DELETE', `/hazards/${id}`),
  setTrip: (id: string, trip: { path: number[]; stops: Stop[]; restart?: boolean }) => call('PUT', `/drivers/${id}`, trip),
  ack: (id: string, hazard_ids: string[]) => call('POST', `/drivers/${id}/ack`, { hazard_ids }),
  message: (driver_id: string | null, sender: Message['sender'], text: string) => call('POST', '/messages', { driver_id, sender, text }),
  reset: () => call('POST', '/reset'),
};

export const DEADLINES = Object.fromEntries(DEMANDS.map((d) => [d.id, d.deadline]));

/**
 * One store for both views: the road graph (static asset), the backend state (polled), a
 * ticking clock, and everything derived — road closures, each driver's assessment, and the
 * Kruskal clearance plan.
 */
export function useOps(pollMs = 4000) {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [state, setState] = useState<OpsState | null>(null);
  const [link, setLink] = useState<'connecting' | 'live' | 'down'>('connecting');
  const [skew, setSkew] = useState(0); // server clock minus ours, so every viewer sees the same trip clock
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    fetch('/graph.json')
      .then((r) => r.json())
      .then((raw) => setGraph(loadGraph(raw)));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const s = await api.state();
      setSkew(s.now - Date.now());
      setState(s);
      setLink('live');
    } catch {
      setLink('down');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), pollMs);
    const onVis = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [refresh, pollMs]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const serverNow = now + skew;
  const places = useMemo(() => (graph ? snapPlaces(graph) : null), [graph]);
  // a hazard flips from forecast to live on the minute — recompute closures then, not every second
  const minute = Math.floor(serverNow / 60000);
  const hazards = state?.hazards ?? [];
  const live = useMemo(() => (graph ? roadState(graph, hazards, minute * 60000) : null), [graph, hazards, minute]);
  const avoid = useMemo(() => (graph ? roadState(graph, hazards, minute * 60000, true) : null), [graph, hazards, minute]);
  const clearance = useMemo(() => (graph && live ? clearancePlan(graph, live.mult) : null), [graph, live]);

  const fleet = useMemo(() => {
    if (!graph || !live || !state) return [];
    return state.drivers.map((d) => ({ driver: d, a: assess(graph, d, live, hazards, DEADLINES, serverNow) }));
  }, [graph, live, state, hazards, serverNow]);

  return { graph, state, link, refresh, now: serverNow, places, live, avoid, clearance, fleet };
}

export type Ops = ReturnType<typeof useOps>;
export type FleetRow = { driver: Driver; a: Assessment };

/* ───────────── shared presentation bits ───────────── */

export const LEVEL = {
  critical: { tone: '#FF3B4E', label: 'Route blocked' },
  warning: { tone: '#FBBF24', label: 'Hazard ahead' },
  clear: { tone: '#34D399', label: 'Clear' },
} as const;

export const KIND_META: Record<HazardKind, { label: string; tone: string; glyph: string }> = {
  flood: { label: 'Flood', tone: '#38BDF8', glyph: '🌊' },
  fire: { label: 'Fire', tone: '#FF6B2C', glyph: '🔥' },
  collapse: { label: 'Collapse', tone: '#FBBF24', glyph: '🧱' },
  landslide: { label: 'Landslide', tone: '#D97706', glyph: '⛰️' },
  cyclone: { label: 'Cyclone', tone: '#A855F7', glyph: '🌀' },
  chemical: { label: 'Chemical', tone: '#84CC16', glyph: '☣️' },
};

export const PRIORITY = { 3: { label: 'Critical', tone: '#FF3B4E' }, 2: { label: 'Urgent', tone: '#FBBF24' }, 1: { label: 'Normal', tone: '#7DD3FC' } } as const;

export const fmtMin = (m: number) =>
  !Number.isFinite(m) ? '—' : m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')}`;

export const ago = (t: number, now: number) => {
  const s = Math.max(0, Math.round((now - t) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
};

export function threatLine(t: Assessment['threats'][number]) {
  const k = KIND_META[t.hazard.kind].label.toLowerCase();
  const where = t.km < 0.05 ? 'here' : `in ${t.km.toFixed(1)} km`;
  const what = t.effect === 'closed' ? `road closed by ${k}` : t.effect === 'slowed' ? `${k} slowing traffic` : `passing near ${k}`;
  return `${t.forecast ? 'Forecast: ' : ''}${what} ${where}`;
}

/** Open-Meteo hourly rain for the city — free, key-less, CORS-enabled. */
export function useRain() {
  const [rain, setRain] = useState<{ total: number; peak: number; peakAt: string } | null>(null);
  useEffect(() => {
    const load = () =>
      fetch('https://api.open-meteo.com/v1/forecast?latitude=17.39&longitude=78.48&hourly=precipitation&forecast_hours=12&timezone=Asia%2FKolkata')
        .then((r) => r.json())
        .then((d) => {
          const p: number[] = d.hourly.precipitation;
          const i = p.indexOf(Math.max(...p));
          setRain({ total: p.reduce((s, x) => s + x, 0), peak: p[i], peakAt: String(d.hourly.time[i]).slice(11, 16) });
        })
        .catch(() => setRain(null));
    load();
    const id = setInterval(load, 15 * 60000);
    return () => clearInterval(id);
  }, []);
  return rain;
}
