// node scripts/check.ts — the report's worked examples and brute-force checks, on the TS port.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assess, clearancePlan, dijkstra, knapsack, loadGraph, reroute, roadState, routeDp, routeNearest } from '../src/lib/algo.ts';

// Section V-A worked example: depot 0, stops 1..3, values 3/6/2, deadlines 30/45/50
const T: Record<string, number> = { '0-1': 10, '0-2': 25, '0-3': 20, '1-2': 12, '1-3': 14, '2-3': 9 };
const t = (a: number, b: number) => (a === b ? 0 : T[`${Math.min(a, b)}-${Math.max(a, b)}`]);
let r = routeDp(0, [1, 2, 3], [3, 6, 2], [30, 45, 50], t);
assert.equal(r.value, 11);
assert.deepEqual(r.order.map((j) => [1, 2, 3][j]), [1, 2, 3]);

// nearest neighbour takes the wrong first move: value 1 vs DP value 11
const T2: Record<string, number> = { '0-1': 5, '0-2': 18, '1-2': 16 };
const t2 = (a: number, b: number) => (a === b ? 0 : T2[`${Math.min(a, b)}-${Math.max(a, b)}`]);
assert.equal(routeNearest(0, [1, 2], [1, 10], [100, 20], t2).value, 1);
assert.equal(routeDp(0, [1, 2], [1, 10], [100, 20], t2).value, 11);

// knapsack vs brute force on random instances
for (let s = 1; s <= 30; s++) {
  const items: [number, number][] = Array.from({ length: 8 }, (_, i) => [((s * 7 + i * 13) % 17) + 1, ((s * 11 + i * 5) % 23) + 1]);
  let best = 0;
  for (let m = 0; m < 256; m++) {
    let w = 0, v = 0;
    items.forEach(([iw, iv], i) => { if ((m >> i) & 1) { w += iw; v += iv; } });
    if (w <= 30) best = Math.max(best, v);
  }
  assert.equal(knapsack(items, 30).value, best);
}

// on the real graph: a severity-3 flood closes roads, Dijkstra routes around, Kruskal reconnects
const g = loadGraph(JSON.parse(readFileSync('public/graph.json', 'utf8')));
const now = Date.now();
const flood = { id: 'x', kind: 'flood' as const, lat: 17.373, lon: 78.5, radius_m: 650, severity: 3 as const, starts_at: now - 1, note: '', created_at: now };
const open = roadState(g, [], now);
const closed = roadState(g, [flood], now);
assert.ok([...closed.mult].some((m) => m === Infinity));
const a = 100, b = 5000;
assert.ok(dijkstra(g, closed.mult, a).dist[b] >= dijkstra(g, open.mult, a).dist[b]);
assert.ok(clearancePlan(g, closed.mult).edges.length > 0);
assert.equal(clearancePlan(g, open.mult).edges.length, 0);

// a driver whose path runs through the flood is critical; the reroute avoids every closed road
// plan on an open city, then the flood arrives
const { DEMANDS, CAPACITY, snapPlaces } = await import('../src/lib/places.ts');
const { plan } = await import('../src/lib/algo.ts');
const { depots, demands } = snapPlaces(g);
const dl = Object.fromEntries(DEMANDS.map((d) => [d.id, d.deadline]));
let rerouted = 0;
for (const d of plan(g, open.mult, depots, demands, CAPACITY).trips) {
  const trip = { ...d, started_at: now };
  const x = assess(g, trip, closed, [flood], dl, now);
  if (x.level !== 'critical') continue;
  const places = Object.fromEntries(demands.map((p) => [p.id, p]));
  const nr = reroute(g, trip, x, closed, places);
  const ahead = nr.path.slice(x.halted ? x.at : x.at + 1);
  for (let i = 1; i < ahead.length; i++) {
    const e = g.key.get(Math.min(ahead[i - 1], ahead[i]) * g.nodes.length + Math.max(ahead[i - 1], ahead[i]))!;
    assert.notEqual(closed.mult[e], Infinity, `reroute from ${d.depot} still crosses the flood`);
  }
  rerouted++;
  console.log(`reroute from ${d.depot}: ${x.threats.length} threats → ${nr.oldMinutes.toFixed(0)} min → ${nr.newMinutes.toFixed(0)} min`);
}
assert.ok(rerouted > 0, 'no trip crossed the flood, reroute untested');
console.log('all checks passed');
