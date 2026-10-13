import type { Graph, Hazard, Mix } from './algo.ts';
import { nearestNode } from './algo.ts';

/**
 * Hyderabad relief scenario. Places are real; demand, stock and deadlines are synthetic,
 * shaped like the October 2020 Musi / Gurram Cheruvu floods. Coordinates snap to the nearest
 * intersection of the OSM road graph at load time.
 */
export const CITY = { name: 'Hyderabad', center: [78.475, 17.395] as [number, number], zoom: 11.3 };
export const CAPACITY = 60; // units per vehicle, as in the report

type P = { id: string; name: string; lat: number; lon: number };

export const DEPOTS: (P & { supply: Mix; vehicles: number })[] = [
  { id: 'dp-gachibowli', name: 'Gachibowli Stadium depot', lat: 17.4448, lon: 78.3498, supply: { water: 70, food: 60, medical: 30 }, vehicles: 3 },
  { id: 'dp-parade', name: 'Parade Ground depot, Secunderabad', lat: 17.4433, lon: 78.5013, supply: { water: 80, food: 70, medical: 35 }, vehicles: 3 },
  { id: 'dp-lbnagar', name: 'LB Nagar depot', lat: 17.3457, lon: 78.5522, supply: { water: 75, food: 65, medical: 30 }, vehicles: 3 },
];

export const DEMANDS: (P & { kind: string; need: Mix; priority: 1 | 2 | 3; deadline: number })[] = [
  { id: 'osmania', name: 'Osmania General Hospital', kind: 'hospital', lat: 17.3713, lon: 78.4747, need: { water: 10, food: 6, medical: 14 }, priority: 3, deadline: 75 },
  { id: 'gandhi', name: 'Gandhi Hospital', kind: 'hospital', lat: 17.4245, lon: 78.5033, need: { water: 8, food: 6, medical: 12 }, priority: 3, deadline: 70 },
  { id: 'niloufer', name: 'Niloufer Hospital', kind: 'hospital', lat: 17.3999, lon: 78.4593, need: { water: 6, food: 5, medical: 10 }, priority: 3, deadline: 80 },
  { id: 'aljubail', name: 'Al-Jubail Colony relief camp', kind: 'camp', lat: 17.3296, lon: 78.479, need: { water: 12, food: 12, medical: 6 }, priority: 3, deadline: 90 },
  { id: 'moosarambagh', name: 'Moosarambagh shelter', kind: 'shelter', lat: 17.37, lon: 78.511, need: { water: 10, food: 10, medical: 4 }, priority: 2, deadline: 130 },
  { id: 'chaderghat', name: 'Chaderghat community hall', kind: 'shelter', lat: 17.3768, lon: 78.493, need: { water: 9, food: 10, medical: 3 }, priority: 2, deadline: 125 },
  { id: 'tolichowki', name: 'Nadeem Colony, Tolichowki', kind: 'colony', lat: 17.3967, lon: 78.4185, need: { water: 11, food: 9, medical: 4 }, priority: 2, deadline: 140 },
  { id: 'amberpet', name: 'Amberpet shelter', kind: 'shelter', lat: 17.392, lon: 78.517, need: { water: 7, food: 8, medical: 3 }, priority: 2, deadline: 135 },
  { id: 'chandrayan', name: 'Chandrayangutta school shelter', kind: 'shelter', lat: 17.317, lon: 78.48, need: { water: 8, food: 9, medical: 3 }, priority: 2, deadline: 130 },
  { id: 'mehdipatnam', name: 'Mehdipatnam function hall', kind: 'shelter', lat: 17.393, lon: 78.439, need: { water: 6, food: 7, medical: 2 }, priority: 1, deadline: 200 },
  { id: 'saroor', name: 'Saroornagar stadium camp', kind: 'camp', lat: 17.353, lon: 78.531, need: { water: 8, food: 8, medical: 2 }, priority: 1, deadline: 195 },
  { id: 'uppal', name: 'Uppal community centre', kind: 'shelter', lat: 17.4018, lon: 78.5602, need: { water: 6, food: 6, medical: 2 }, priority: 1, deadline: 205 },
  { id: 'kphb', name: 'KPHB Colony ward office', kind: 'colony', lat: 17.493, lon: 78.399, need: { water: 7, food: 6, medical: 2 }, priority: 1, deadline: 210 },
  { id: 'attapur', name: 'Attapur (Musi bank)', kind: 'colony', lat: 17.37, lon: 78.43, need: { water: 9, food: 8, medical: 3 }, priority: 2, deadline: 140 },
  { id: 'kondapur', name: 'Kondapur Area Hospital', kind: 'hospital', lat: 17.469, lon: 78.364, need: { water: 8, food: 5, medical: 12 }, priority: 3, deadline: 80 },
  { id: 'manikonda', name: 'Manikonda relief camp', kind: 'camp', lat: 17.404, lon: 78.388, need: { water: 10, food: 10, medical: 3 }, priority: 2, deadline: 130 },
  { id: 'miyapur', name: 'Miyapur ward shelter', kind: 'shelter', lat: 17.496, lon: 78.357, need: { water: 7, food: 8, medical: 2 }, priority: 1, deadline: 200 },
  { id: 'begumpet', name: 'Begumpet shelter', kind: 'shelter', lat: 17.444, lon: 78.463, need: { water: 5, food: 6, medical: 2 }, priority: 1, deadline: 190 },
];

/** Seed hazards: minutes offset of start (negative = already happening, positive = forecast). */
export const SEED_HAZARDS: (Omit<Hazard, 'id' | 'starts_at' | 'created_at'> & { id: string; starts_in: number })[] = [
  { id: 'hz-musi', kind: 'flood', lat: 17.373, lon: 78.5, radius_m: 650, severity: 3, starts_in: -90, note: 'Musi overflow at Chaderghat causeway — bridge closed' },
  { id: 'hz-gurram', kind: 'flood', lat: 17.333, lon: 78.487, radius_m: 600, severity: 3, starts_in: -120, note: 'Gurram Cheruvu bund breach, Falaknuma low-lying colonies' },
  { id: 'hz-nadeem', kind: 'flood', lat: 17.399, lon: 78.413, radius_m: 420, severity: 2, starts_in: -45, note: 'Waterlogging 1.2 m, Nadeem Colony main road' },
  { id: 'hz-begumpet', kind: 'collapse', lat: 17.442, lon: 78.47, radius_m: 180, severity: 1, starts_in: -30, note: 'Tree fall, one lane open near Begumpet flyover' },
  { id: 'hz-nacharam', kind: 'chemical', lat: 17.428, lon: 78.553, radius_m: 380, severity: 2, starts_in: -20, note: 'Solvent drum fire, Nacharam industrial estate' },
  { id: 'hz-tankbund', kind: 'flood', lat: 17.415, lon: 78.485, radius_m: 480, severity: 2, starts_in: 60, note: 'Hussain Sagar at FTL — Lower Tank Bund expected to flood' },
];

export const DRIVERS = [
  ['drv-01', 'Ravi Kumar', 'TS 09 UB 4417'],
  ['drv-02', 'Sana Fatima', 'TS 09 UC 2290'],
  ['drv-03', 'Venkat Reddy', 'TS 10 EA 7781'],
  ['drv-04', 'Imran Shaikh', 'TS 08 GJ 3304'],
  ['drv-05', 'Lakshmi Prasanna', 'TS 07 HK 9120'],
  ['drv-06', 'Arjun Naidu', 'TS 09 UD 5568'],
  ['drv-07', 'Mohammed Asif', 'TS 11 EB 1047'],
  ['drv-08', 'Kavya Rao', 'TS 12 FA 6635'],
  ['drv-09', 'Srinivas Goud', 'TS 07 HL 2813'],
] as const;

export function snapPlaces(g: Graph) {
  const depots = DEPOTS.map((d) => ({ ...d, node: nearestNode(g, [d.lon, d.lat]) }));
  const demands = DEMANDS.map((d) => ({ ...d, node: nearestNode(g, [d.lon, d.lat]) }));
  return { depots, demands };
}

/** Drivers are attached to depots in order, `vehicles` per depot. */
export const driverDepot = (i: number) => DEPOTS[Math.floor(i / 3)].id;
