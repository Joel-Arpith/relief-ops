import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { Map as MLMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { edgeCoords, NEAR_M, pathCoords, type Graph, type Hazard, type LngLat, type RoadState } from '../lib/algo';
import { tintVectorStyle, VECTOR_BASEMAP_IDS, VECTOR_PROBE, type Basemap } from '../lib/basemaps';
import { CITY } from '../lib/places';
import { KIND_META, LEVEL, PRIORITY, type FleetRow, type Ops } from '../lib/ops';

export interface MapLayers {
  routes: boolean;
  closures: boolean;
  clearance: boolean;
  places: boolean;
}

interface Props {
  ops: Ops;
  basemap: Basemap;
  layers: MapLayers;
  /** drivers to draw; the driver view passes just one */
  rows: FleetRow[];
  selectedId: string | null;
  onSelectDriver?: (id: string) => void;
  onMapClick?: (p: LngLat) => void;
  /** candidate reroute, drawn dashed */
  preview?: number[] | null;
  /** keep the camera on this driver */
  follow?: boolean;
  focus?: { lng: number; lat: number; zoom?: number; t: number } | null;
  draft?: { lng: number; lat: number; radius_m: number } | null;
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });
const line = (coords: LngLat[], props: Record<string, unknown> = {}): GeoJSON.Feature => ({
  type: 'Feature',
  properties: props,
  geometry: { type: 'LineString', coordinates: coords },
});

export function circle(lng: number, lat: number, r: number, steps = 56): LngLat[] {
  const out: LngLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    out.push([lng + (r * Math.sin(a)) / (111320 * Math.cos((lat * Math.PI) / 180)), lat + (r * Math.cos(a)) / 110570]);
  }
  return out;
}

function hazardsGeo(hazards: Hazard[], now: number) {
  return fc(
    hazards.flatMap((h) => {
      const props = { id: h.id, tone: KIND_META[h.kind].tone, forecast: h.starts_at > now ? 1 : 0, severity: h.severity };
      return [
        { type: 'Feature', properties: { ...props, band: 0 }, geometry: { type: 'Polygon', coordinates: [circle(h.lon, h.lat, h.radius_m)] } },
        { type: 'Feature', properties: { ...props, band: 1 }, geometry: { type: 'Polygon', coordinates: [circle(h.lon, h.lat, h.radius_m + NEAR_M)] } },
      ] as GeoJSON.Feature[];
    }),
  );
}

function roadsGeo(g: Graph, live: RoadState | null, edges?: number[]) {
  if (!live) return EMPTY;
  const list = edges ?? [...live.inside.keys()].filter((e) => live.mult[e] > 1);
  return fc(list.map((e) => line(edgeCoords(g, e), { closed: live.mult[e] === Infinity ? 1 : 0 })));
}

export default function OpsMap({ ops, basemap, layers, rows, selectedId, onSelectDriver, onMapClick, preview, follow, focus, draft }: Props) {
  const holder = useRef<HTMLDivElement | null>(null);
  const map = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(0); // bumps on every style load so data re-applies
  const [degraded, setDegraded] = useState<string[]>([]);
  const applied = useRef<unknown>(null);
  const basemapRef = useRef(basemap);
  basemapRef.current = basemap;
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;
  const selectRef = useRef(onSelectDriver);
  selectRef.current = onSelectDriver;
  const driverMarkers = useRef(new Map<string, Marker>());
  const placeMarkers = useRef<Marker[]>([]);

  const style = degraded.includes(basemap.id) && basemap.fallback ? basemap.fallback : basemap.style;
  const { graph, live, clearance, places, state, now } = ops;

  useEffect(() => {
    fetch(VECTOR_PROBE, { signal: AbortSignal.timeout(4500) })
      .then((r) => {
        if (!r.ok) throw new Error();
      })
      .catch(() => setDegraded((p) => [...new Set([...p, ...VECTOR_BASEMAP_IDS])]));
  }, []);

  useEffect(() => {
    if (!holder.current || map.current) return;
    const m = new maplibregl.Map({
      container: holder.current,
      style: basemap.style as any,
      center: CITY.center,
      zoom: CITY.zoom,
      attributionControl: { compact: true },
      maxZoom: 18,
      minZoom: 9,
    });
    map.current = m;
    applied.current = basemap.style;
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    m.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-left');
    m.on('style.load', () => {
      if (basemapRef.current.tint) tintVectorStyle(m as any);
      addLayers(m);
      setReady((n) => n + 1);
    });
    m.on('error', () => {
      const b = basemapRef.current;
      if (b.fallback) setDegraded((p) => (p.includes(b.id) ? p : [...p, b.id]));
    });
    m.on('click', (e) => clickRef.current?.([e.lngLat.lng, e.lngLat.lat]));
    m.on('click', 'routes-hit', (e) => {
      const id = e.features?.[0]?.properties?.id;
      if (id) {
        e.preventDefault();
        selectRef.current?.(String(id));
      }
    });
    m.on('mouseenter', 'routes-hit', () => (m.getCanvas().style.cursor = 'pointer'));
    m.on('mouseleave', 'routes-hit', () => (m.getCanvas().style.cursor = ''));
    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || applied.current === style) return;
    applied.current = style;
    m.setStyle(style as any, { diff: false });
  }, [style]);

  useEffect(() => {
    if (map.current) map.current.getCanvas().style.cursor = onMapClick ? 'crosshair' : '';
  }, [onMapClick, ready]);

  /* ---------- data ---------- */
  const hazardData = useMemo(() => hazardsGeo(state?.hazards ?? [], now), [state?.hazards, Math.floor(now / 60000)]);
  const closureData = useMemo(() => (graph ? roadsGeo(graph, live) : EMPTY), [graph, live]);
  const clearanceData = useMemo(() => (graph && clearance ? roadsGeo(graph, live, clearance.edges) : EMPTY), [graph, live, clearance]);
  // routes only change when a trip changes or a driver passes an intersection
  const routeKey = rows.map((r) => `${r.driver.id}:${r.driver.updated_at}:${r.a.at}:${r.a.level}`).join('|');
  const routeData = useMemo(() => {
    if (!graph) return EMPTY;
    return fc(
      rows.flatMap(({ driver, a }) => {
        if (driver.path.length < 2) return [];
        const props = { id: driver.id, tone: LEVEL[a.level].tone, sel: driver.id === selectedId ? 1 : 0 };
        return [
          line(pathCoords(graph, driver.path.slice(0, a.at + 1)), { ...props, done: 1 }),
          line([a.pos, ...pathCoords(graph, driver.path, a.at + 1)], { ...props, done: 0 }),
        ];
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, routeKey, selectedId]);
  const previewData = useMemo(() => (graph && preview ? fc([line(pathCoords(graph, preview))]) : EMPTY), [graph, preview]);
  const draftData = useMemo(
    () => (draft ? fc([{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circle(draft.lng, draft.lat, draft.radius_m)] } }]) : EMPTY),
    [draft],
  );

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const set = (id: string, d: GeoJSON.FeatureCollection) => (m.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(d);
    set('hazards', hazardData);
    set('closures', closureData);
    set('clearance', clearanceData);
    set('routes', routeData);
    set('preview', previewData);
    set('draft', draftData);
  }, [ready, hazardData, closureData, clearanceData, routeData, previewData, draftData]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const vis = (ids: string[], on: boolean) => ids.forEach((id) => m.getLayer(id) && m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));
    vis(['routes-done', 'routes-ahead', 'routes-glow', 'routes-hit'], layers.routes);
    vis(['closures'], layers.closures);
    vis(['clearance'], layers.clearance);
    placeMarkers.current.forEach((mk) => (mk.getElement().style.display = layers.places ? '' : 'none'));
  }, [ready, layers]);

  /* ---------- depots + demand points ---------- */
  useEffect(() => {
    const m = map.current;
    if (!m || !places || !graph) return;
    placeMarkers.current.forEach((mk) => mk.remove());
    placeMarkers.current = [];
    const add = (html: string, p: LngLat, title: string) => {
      const el = document.createElement('div');
      el.innerHTML = html;
      el.title = title;
      el.style.display = layers.places ? '' : 'none';
      placeMarkers.current.push(new maplibregl.Marker({ element: el }).setLngLat(p).addTo(m));
    };
    places.depots.forEach((d) =>
      add(`<div class="ro-depot">D</div>`, graph.nodes[d.node], `${d.name} — water ${d.supply.water} · food ${d.supply.food} · medical ${d.supply.medical}`),
    );
    places.demands.forEach((d) =>
      add(
        `<div class="ro-place" style="--tone:${PRIORITY[d.priority].tone}"><span></span></div>`,
        graph.nodes[d.node],
        `${d.name} · ${PRIORITY[d.priority].label} · deadline ${d.deadline} min`,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, graph]);

  /* ---------- driver markers, moved every tick ---------- */
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const keep = new Set(rows.map((r) => r.driver.id));
    for (const [id, mk] of driverMarkers.current) if (!keep.has(id)) (mk.remove(), driverMarkers.current.delete(id));
    for (const { driver, a } of rows) {
      let mk = driverMarkers.current.get(driver.id);
      if (!mk) {
        const el = document.createElement('button');
        el.className = 'ro-truck';
        el.innerHTML = `<span class="ro-truck__halo"></span><span class="ro-truck__body"><svg viewBox="0 0 24 24" width="12" height="12"><path d="M12 3l7 16-7-4-7 4z" fill="currentColor"/></svg></span><span class="ro-truck__tag"></span>`;
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          selectRef.current?.(driver.id);
        });
        mk = new maplibregl.Marker({ element: el, rotationAlignment: 'map' }).setLngLat(a.pos).addTo(m);
        driverMarkers.current.set(driver.id, mk);
      }
      const el = mk.getElement();
      el.style.setProperty('--tone', LEVEL[a.level].tone);
      el.dataset.selected = String(driver.id === selectedId);
      el.dataset.level = a.level;
      (el.querySelector('.ro-truck__body svg') as SVGElement).style.transform = `rotate(${a.bearing}deg)`;
      (el.querySelector('.ro-truck__tag') as HTMLElement).textContent = driver.name.split(' ')[0];
      el.title = `${driver.name} · ${driver.vehicle} · ${LEVEL[a.level].label}`;
      mk.setLngLat(a.pos);
    }
  }, [rows, selectedId]);

  useEffect(
    () => () => {
      driverMarkers.current.forEach((mk) => mk.remove());
      driverMarkers.current.clear();
    },
    [],
  );

  /* ---------- camera ---------- */
  useEffect(() => {
    if (focus) map.current?.flyTo({ center: [focus.lng, focus.lat], zoom: focus.zoom ?? Math.max(map.current.getZoom(), 13), speed: 1.1, essential: true });
  }, [focus]);

  const followPos = follow ? rows[0]?.a.pos : undefined;
  useEffect(() => {
    if (followPos) map.current?.easeTo({ center: followPos, zoom: Math.max(map.current.getZoom(), 13.2), duration: 900 });
  }, [followPos?.[0], followPos?.[1]]);

  return (
    <div className="absolute inset-0">
      <div ref={holder} className="absolute inset-0 transition-[filter] duration-700" style={{ filter: basemap.filter }} />
      <div className="pointer-events-none absolute inset-0 transition-opacity duration-700" style={{ background: '#04060B', opacity: basemap.dim }} />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(130%_95%_at_50%_10%,transparent_50%,rgba(4,6,11,0.7)_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[170px] bg-gradient-to-b from-[#04060B]/90 via-[#04060B]/45 to-transparent" />
    </div>
  );
}

function addLayers(m: MLMap) {
  for (const id of ['hazards', 'closures', 'clearance', 'routes', 'preview', 'draft']) {
    if (!m.getSource(id)) m.addSource(id, { type: 'geojson', data: EMPTY });
  }
  const band = ['==', ['get', 'band'], 1] as any;
  const core = ['==', ['get', 'band'], 0] as any;
  m.addLayer({ id: 'hazard-band', type: 'fill', source: 'hazards', filter: band, paint: { 'fill-color': ['get', 'tone'], 'fill-opacity': 0.05 } });
  m.addLayer({
    id: 'hazard-band-line',
    type: 'line',
    source: 'hazards',
    filter: band,
    paint: { 'line-color': ['get', 'tone'], 'line-opacity': 0.35, 'line-width': 1, 'line-dasharray': [2, 3] },
  });
  m.addLayer({
    id: 'hazard-fill',
    type: 'fill',
    source: 'hazards',
    filter: core,
    paint: { 'fill-color': ['get', 'tone'], 'fill-opacity': ['case', ['==', ['get', 'forecast'], 1], 0.08, ['interpolate', ['linear'], ['get', 'severity'], 1, 0.14, 3, 0.26]] },
  });
  m.addLayer({
    id: 'hazard-line',
    type: 'line',
    source: 'hazards',
    filter: core,
    paint: { 'line-color': ['get', 'tone'], 'line-width': 1.6, 'line-opacity': 0.9 },
  });
  m.addLayer({
    id: 'closures',
    type: 'line',
    source: 'closures',
    paint: { 'line-color': ['case', ['==', ['get', 'closed'], 1], '#FF3B4E', '#FBBF24'], 'line-width': 3, 'line-opacity': 0.85 },
  });
  m.addLayer({
    id: 'clearance',
    type: 'line',
    source: 'clearance',
    layout: { visibility: 'none' },
    paint: { 'line-color': '#34D399', 'line-width': 4, 'line-dasharray': [1, 1.2], 'line-opacity': 0.95 },
  });
  const done = ['==', ['get', 'done'], 1] as any;
  const ahead = ['==', ['get', 'done'], 0] as any;
  m.addLayer({ id: 'routes-done', type: 'line', source: 'routes', filter: done, paint: { 'line-color': '#94A3B8', 'line-width': 2, 'line-opacity': 0.28 } });
  m.addLayer({
    id: 'routes-glow',
    type: 'line',
    source: 'routes',
    filter: ahead,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'tone'], 'line-width': ['case', ['==', ['get', 'sel'], 1], 14, 7], 'line-opacity': 0.16, 'line-blur': 4 },
  });
  m.addLayer({
    id: 'routes-ahead',
    type: 'line',
    source: 'routes',
    filter: ahead,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'tone'], 'line-width': ['case', ['==', ['get', 'sel'], 1], 4.5, 2.4], 'line-opacity': 0.92 },
  });
  m.addLayer({ id: 'routes-hit', type: 'line', source: 'routes', filter: ahead, paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 14 } });
  m.addLayer({
    id: 'preview',
    type: 'line',
    source: 'preview',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#22D3EE', 'line-width': 4, 'line-dasharray': [1.4, 1.1] },
  });
  m.addLayer({ id: 'draft-fill', type: 'fill', source: 'draft', paint: { 'fill-color': '#F8FAFC', 'fill-opacity': 0.1 } });
  m.addLayer({ id: 'draft-line', type: 'line', source: 'draft', paint: { 'line-color': '#F8FAFC', 'line-width': 1.5, 'line-dasharray': [2, 2] } });
}
