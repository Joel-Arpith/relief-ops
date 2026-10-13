// Builds functions/seed.json — the initial dispatch the backend loads into an empty D1.
// node scripts/seed.ts   (Node ≥ 23 runs TypeScript directly)
import { readFileSync, writeFileSync } from 'node:fs';
import { loadGraph, plan, roadState } from '../src/lib/algo.ts';
import { CAPACITY, DRIVERS, SEED_HAZARDS, driverDepot, snapPlaces } from '../src/lib/places.ts';

const g = loadGraph(JSON.parse(readFileSync('public/graph.json', 'utf8')));
const { depots, demands } = snapPlaces(g);
const now = Date.now();
const hazards = SEED_HAZARDS.map(({ starts_in, ...h }) => ({ ...h, starts_at: now + starts_in * 60000, created_at: now }));
const { trips } = plan(g, roadState(g, hazards, now).mult, depots, demands, CAPACITY);

const drivers = DRIVERS.map(([id, name, vehicle], i) => {
  const depot = driverDepot(i);
  const mine = trips.filter((t) => t.depot === depot);
  const k = i - DRIVERS.findIndex((_, j) => driverDepot(j) === depot);
  const trip = mine[k] ?? { path: [depots.find((d) => d.id === depot)!.node], stops: [] };
  return { id, name, vehicle, depot, path: trip.path, stops: trip.stops };
});

// Demo story: the plan above was made before these were reported, so they land on live routes.
// A point 45–70% along a trip, snapped to a road node, guarantees the driver actually meets it.
const at = (d: (typeof drivers)[number], f: number) => {
  const n = g.nodes[d.path[Math.floor(d.path.length * f)]];
  return { lat: n[1], lon: n[0] };
};
const loaded = drivers.filter((d) => d.stops.length > 1).sort((a, b) => b.path.length - a.path.length);
const [a, b, c, e] = loaded;
const demo = [
  { id: 'hz-demo-slide', kind: 'landslide', ...at(a, 0.55), radius_m: 320, severity: 3, starts_in: -8, note: 'Retaining wall collapse blocks both lanes — police diverting' },
  { id: 'hz-demo-fire', kind: 'fire', ...at(b, 0.5), radius_m: 260, severity: 2, starts_in: -4, note: 'Godown fire, road cordoned by fire service' },
  { id: 'hz-demo-water', kind: 'flood', ...at(c, 0.6), radius_m: 380, severity: 1, starts_in: -15, note: 'Knee-deep waterlogging, vehicles crawling' },
  { id: 'hz-demo-forecast', kind: 'cyclone', ...at(e, 0.7), radius_m: 700, severity: 3, starts_in: 45, note: 'Squall line forecast — IMD red alert for this belt' },
].filter((h) => h.lat);
drivers.forEach((d) => {
  if (d.id === c.id) (d as any).acked = [`hz-demo-water`];
});
const messages = [
  { driver_id: null, sender: 'system', text: 'Dispatch plan issued: Kruskal clearance → Dijkstra → greedy allocation → knapsack loading → subset-DP routing.', ago: 62 },
  { driver_id: null, sender: 'admin', text: 'Musi is over the Chaderghat causeway. All vehicles avoid the old city crossing.', ago: 41 },
  { driver_id: c.id, sender: 'driver', text: 'Water over the axle near the colony road — crawling, still moving.', ago: 14 },
  { driver_id: c.id, sender: 'admin', text: 'Copy. Hold your pace, your next drop has 40 minutes of slack.', ago: 13 },
  { driver_id: null, sender: 'system', text: 'New landslide hazard (severity 3, 320 m) — Retaining wall collapse blocks both lanes — police diverting', ago: 8 },
  { driver_id: b.id, sender: 'driver', text: 'Fire service has the road cordoned ahead. Waiting for instructions.', ago: 4 },
];
writeFileSync(
  'functions/seed.json',
  JSON.stringify({ hazards: [...SEED_HAZARDS, ...demo], drivers, messages }),
);
for (const d of drivers)
  console.log(d.id, d.depot, `${d.path.length} nodes`, d.stops.map((s) => `${s.place}${s.idx < 0 ? '(dropped)' : ''}`).join(' → '));
