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
writeFileSync(
  'functions/seed.json',
  JSON.stringify({ hazards: SEED_HAZARDS, drivers }),
);
for (const d of drivers)
  console.log(d.id, d.depot, `${d.path.length} nodes`, d.stops.map((s) => `${s.place}${s.idx < 0 ? '(dropped)' : ''}`).join(' → '));
