import type { StyleSpecification } from 'maplibre-gl';

/**
 * Every basemap here is key-free OpenStreetMap data: CARTO styles over OSM, and the OSM
 * standard tiles themselves. Attribution is rendered by
 * the map's own control — do not strip it.
 *
 * Vector styles look better (crisp labels, rotation, no tile seams) but some networks
 * block CARTO's vector tile hosts. Each vector basemap therefore carries a raster twin
 * in `fallback`, which MapView swaps in automatically if tiles fail to load.
 */
export interface Basemap {
  id: string;
  label: string;
  hint: string;
  /** Swatch shown in the Google-Maps-style switcher. */
  swatch: string;
  style: string | StyleSpecification;
  fallback?: StyleSpecification;
  /** Bright basemaps are dimmed so the thermal ramp stays the brightest thing on screen. */
  dim: number;
  /** CSS filter applied to the canvas — imagery is graded, never shown raw. */
  filter?: string;
  /** Vector styles get recoloured into the console palette after they load. */
  tint?: boolean;
}

const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const CARTO_ATTR = `${OSM_ATTR} &copy; <a href="https://carto.com/attributions">CARTO</a>`;

function rasterStyle(tiles: string[], attribution: string): StyleSpecification {
  return {
    version: 8,
    sources: { base: { type: 'raster', tiles, tileSize: 256, attribution, maxzoom: 19 } },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#04060B' } },
      { id: 'base', type: 'raster', source: 'base', paint: { 'raster-opacity': 1 } },
    ],
  };
}

const cartoRaster = (name: string) => [
  `https://a.basemaps.cartocdn.com/${name}/{z}/{x}/{y}@2x.png`,
  `https://b.basemaps.cartocdn.com/${name}/{z}/{x}/{y}@2x.png`,
  `https://c.basemaps.cartocdn.com/${name}/{z}/{x}/{y}@2x.png`,
];

export const BASEMAPS: Basemap[] = [
  {
    id: 'obsidian',
    label: 'Obsidian',
    hint: 'Dark vector — default operating picture',
    swatch: 'linear-gradient(135deg,#0b1018,#1b2434 60%,#0a3b45)',
    style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    fallback: rasterStyle(cartoRaster('dark_all'), CARTO_ATTR),
    dim: 0,
    tint: true,
  },
  {
    id: 'osm',
    label: 'OSM',
    hint: 'OpenStreetMap standard tiles',
    swatch: 'linear-gradient(135deg,#f2efe9,#d7d0c3 50%,#aad3df)',
    style: rasterStyle(['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], OSM_ATTR),
    dim: 0.42,
    filter: 'brightness(0.78) saturate(0.7) contrast(1.05)',
  },
  {
    id: 'streets',
    label: 'Streets',
    hint: 'CARTO Voyager — infrastructure detail',
    swatch: 'linear-gradient(135deg,#dfe6ee,#b9c6d4 55%,#8fa4b8)',
    style: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
    fallback: rasterStyle(cartoRaster('rastertiles/voyager'), CARTO_ATTR),
    dim: 0.34,
    filter: 'brightness(0.82) saturate(0.75)',
  },
  {
    id: 'briefing',
    label: 'Briefing',
    hint: 'Light basemap for printed briefs',
    swatch: 'linear-gradient(135deg,#f2f5f8,#d8dfe6 55%,#aab6c2)',
    style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    fallback: rasterStyle(cartoRaster('light_all'), CARTO_ATTR),
    dim: 0.18,
    filter: 'brightness(0.94) saturate(0.7)',
  },
];

/** Every basemap is OpenStreetMap data; the dark one keeps hazards and routes the brightest thing on screen. */
export const DEFAULT_BASEMAP = BASEMAPS[0];

/**
 * Recolour a CARTO vector style into the console palette: navy water, a graphite landmass,
 * legible roads and muted labels, tuned for city-scale routing.
 */
export function tintVectorStyle(map: {
  getStyle: () => StyleSpecification;
  setPaintProperty: (layer: string, prop: string, value: unknown) => void;
}) {
  const style = map.getStyle();
  if (!style?.layers) return;
  const set = (id: string, prop: string, value: unknown) => {
    try {
      map.setPaintProperty(id, prop, value);
    } catch {
      /* layer absent in this style — nothing to recolour */
    }
  };

  style.layers.forEach((layer) => {
    const id = layer.id;
    if (layer.type === 'background') set(id, 'background-color', '#070B12');
    else if (/^water$|water_shadow|^waterway$/.test(id)) {
      set(id, layer.type === 'line' ? 'line-color' : 'fill-color', '#0F2740'); // the Musi and the lakes are what floods
    } else if (/landcover|landuse|park/.test(id)) {
      set(id, 'fill-color', '#0C121B');
      set(id, 'fill-opacity', 0.9);
    } else if (/boundary_country/.test(id)) {
      set(id, 'line-color', 'rgba(125,211,252,0.55)');
      set(id, 'line-width', 0.9);
    } else if (/boundary_state|boundary_county/.test(id)) {
      set(id, 'line-color', 'rgba(125,211,252,0.22)');
    } else if (/^road|bridge|tunnel/.test(id)) {
      set(id, 'line-color', /_(mot|trunk|pri)_/.test(id) ? '#4A5870' : '#2F3B4F'); // a routing map needs its roads
    } else if (/rail/.test(id)) {
      set(id, 'line-color', '#1C2532');
    } else if (/building/.test(id)) {
      set(id, 'fill-color', '#141B25');
    } else if (layer.type === 'symbol') {
      set(id, 'text-color', '#94A3B8');
      set(id, 'text-halo-color', 'rgba(4,6,11,0.9)');
      set(id, 'text-halo-width', 1.1);
    }
  });
}

/**
 * One vector tile, fetched once at startup. If it does not come back the network
 * blocks CARTO's vector hosts, and every vector basemap switches to its raster twin
 * before the user ever sees an empty canvas.
 */
export const VECTOR_PROBE = 'https://tiles-a.basemaps.cartocdn.com/vectortiles/carto.streets/v1/4/11/6.mvt';

export const VECTOR_BASEMAP_IDS = BASEMAPS.filter((b) => b.fallback).map((b) => b.id);
