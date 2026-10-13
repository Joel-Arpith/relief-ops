/**
 * The report's six-stage pipeline (DAA Group 16), ported from the Python reference in
 * logistics/graph.py + logistics/plan.py and run on a real OSM road graph instead of a random
 * geometric one. Everything here is plain TypeScript with no dependencies, so the same module
 * runs in the browser, in the seed script (node) and could run in a Worker.
 *
 *   1. Kruskal MST (union–find)        -> least-effort set of blocked roads to clear
 *   2. Dijkstra (binary heap)          -> travel times on passable roads
 *   3. greedy allocation               -> critical first, earliest deadline, nearest stocked depot
 *   4. 0/1 knapsack DP                 -> what each vehicle carries
 *   5. subset DP (Held–Karp, deadlines)-> which stops each vehicle visits and in what order
 *   6. hazard assessment               -> what each driver will run into, live
 */

export type LngLat = [number, number];
export type RawGraph = { nodes: LngLat[]; edges: [number, number, number, number, number[]][] };

export interface Graph {
  nodes: LngLat[];
  eu: Int32Array;
  ev: Int32Array;
  minutes: Float64Array; // free-flow travel time
  km: Float64Array;
  kind: Uint8Array; // 0 motorway … 4 tertiary
  geom: number[][]; // interior shape points, flat lon,lat, oriented u -> v
  adj: number[][]; // node -> edge ids
  key: Map<number, number>; // min*N+max -> edge id
}

export const COMMODITIES = ['water', 'food', 'medical'] as const;
export type Commodity = (typeof COMMODITIES)[number];
export type Mix = Record<Commodity, number>;

export function meters(a: LngLat, b: LngLat) {
  const dx = (b[0] - a[0]) * 111320 * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  return Math.hypot(dx, (b[1] - a[1]) * 110570);
}

export function loadGraph(raw: RawGraph): Graph {
  const n = raw.nodes.length;
  const m = raw.edges.length;
  const g: Graph = {
    nodes: raw.nodes,
    eu: new Int32Array(m),
    ev: new Int32Array(m),
    minutes: new Float64Array(m),
    km: new Float64Array(m),
    kind: new Uint8Array(m),
    geom: new Array(m),
    adj: Array.from({ length: n }, () => []),
    key: new Map(),
  };
  raw.edges.forEach(([u, v, tenths, kind, flat], i) => {
    g.eu[i] = u;
    g.ev[i] = v;
    g.minutes[i] = tenths / 10;
    g.kind[i] = kind;
    g.geom[i] = flat;
    g.km[i] = polylineMeters(edgeCoords(g, i)) / 1000;
    g.adj[u].push(i);
    g.adj[v].push(i);
    g.key.set(Math.min(u, v) * n + Math.max(u, v), i);
  });
  return g;
}

export function edgeCoords(g: Graph, e: number, from = g.eu[e]): LngLat[] {
  const out: LngLat[] = [g.nodes[g.eu[e]]];
  const f = g.geom[e];
  for (let i = 0; i < f.length; i += 2) out.push([f[i], f[i + 1]]);
  out.push(g.nodes[g.ev[e]]);
  return from === g.eu[e] ? out : out.reverse();
}

function polylineMeters(c: LngLat[]) {
  let s = 0;
  for (let i = 1; i < c.length; i++) s += meters(c[i - 1], c[i]);
  return s;
}

export const edgeBetween = (g: Graph, a: number, b: number) =>
  g.key.get(Math.min(a, b) * g.nodes.length + Math.max(a, b)) ?? -1;

// ponytail: linear scan over 9k nodes, a grid index if this ever runs per frame
export function nearestNode(g: Graph, p: LngLat) {
  let best = 0;
  let bd = Infinity;
  g.nodes.forEach((q, i) => {
    const d = meters(p, q);
    if (d < bd && g.adj[i].length) (bd = d), (best = i);
  });
  return best;
}

/* ───────────────────────── hazards → road state ───────────────────────── */

export type HazardKind = 'flood' | 'fire' | 'collapse' | 'landslide' | 'cyclone' | 'chemical';

export interface Hazard {
  id: string;
  kind: HazardKind;
  lat: number;
  lon: number;
  radius_m: number;
  severity: 1 | 2 | 3; // 1 slows traffic, 2–3 close the road
  starts_at: number; // epoch ms; in the future = forecast
  note: string;
  created_at: number;
}

export const NEAR_M = 600; // warning band around a hazard
export const SLOW = 2.5; // severity-1 travel-time multiplier

export interface RoadState {
  /** travel-time multiplier per edge: 1, SLOW, or Infinity when closed */
  mult: Float64Array;
  /** hazard ids touching each edge (inside radius), and within the warning band */
  inside: Map<number, string[]>;
  near: Map<number, string[]>;
}

/**
 * Which roads each hazard closes or slows. `forecast` decides whether hazards that have not
 * started yet already count: the driver's reroute avoids them, the live ETA does not.
 */
export function roadState(g: Graph, hazards: Hazard[], now: number, forecast = false): RoadState {
  const mult = new Float64Array(g.eu.length).fill(1);
  const inside = new Map<number, string[]>();
  const near = new Map<number, string[]>();
  for (const h of hazards) {
    const c: LngLat = [h.lon, h.lat];
    const live = h.starts_at <= now;
    const reach = h.radius_m + NEAR_M;
    const dLat = reach / 110570;
    const dLon = reach / (111320 * Math.cos((h.lat * Math.PI) / 180));
    for (let e = 0; e < g.eu.length; e++) {
      const a = g.nodes[g.eu[e]];
      const b = g.nodes[g.ev[e]];
      if (Math.max(a[0], b[0]) < h.lon - dLon - 0.02 || Math.min(a[0], b[0]) > h.lon + dLon + 0.02) continue;
      if (Math.max(a[1], b[1]) < h.lat - dLat - 0.02 || Math.min(a[1], b[1]) > h.lat + dLat + 0.02) continue;
      let d = Infinity;
      for (const p of edgeCoords(g, e)) d = Math.min(d, meters(p, c));
      if (d > reach) continue;
      push(near, e, h.id);
      if (d > h.radius_m) continue;
      push(inside, e, h.id);
      if (live || forecast) mult[e] = Math.max(mult[e], h.severity >= 2 ? Infinity : SLOW);
    }
  }
  return { mult, inside, near };
}

function push(m: Map<number, string[]>, k: number, v: string) {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}

/* ───────────────────────── 1. Kruskal backbone ───────────────────────── */

export class UnionFind {
  parent: Int32Array;
  rank: Uint8Array;
  constructor(n: number) {
    this.parent = Int32Array.from({ length: n }, (_, i) => i);
    this.rank = new Uint8Array(n);
  }
  find(x: number) {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number) {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return false;
    if (this.rank[ra] < this.rank[rb]) [ra, rb] = [rb, ra];
    this.parent[rb] = ra;
    if (this.rank[ra] === this.rank[rb]) this.rank[ra]++;
    return true;
  }
}

/** Clearing effort in crew-hours for a closed road: longer and more severe takes longer. */
export function clearHours(g: Graph, e: number) {
  return 0.5 + g.km[e] * 1.5;
}

/**
 * Minimum-clearance spanning tree: weight = clearing effort (0 for open roads), ties by travel
 * time, so crews are sent only where the open network is disconnected. Returns the closed
 * edges in the tree — the clearance plan. O(E log E).
 */
export function clearancePlan(g: Graph, mult: Float64Array) {
  const w = (e: number) => (mult[e] === Infinity ? clearHours(g, e) : 0);
  const order = Array.from(g.eu.keys()).sort((a, b) => w(a) - w(b) || g.minutes[a] - g.minutes[b]);
  const uf = new UnionFind(g.nodes.length);
  const clear: number[] = [];
  let joined = 0;
  for (const e of order) {
    if (!uf.union(g.eu[e], g.ev[e])) continue;
    if (mult[e] === Infinity) clear.push(e);
    if (++joined === g.nodes.length - 1) break;
  }
  return { edges: clear, hours: clear.reduce((s, e) => s + clearHours(g, e), 0) };
}

/* ───────────────────────── 2. Dijkstra ───────────────────────── */

export function dijkstra(g: Graph, mult: Float64Array, src: number) {
  const n = g.nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1); // edge used to reach the node
  dist[src] = 0;
  // binary heap of (dist, node); stale entries are skipped instead of decreased
  const hd: number[] = [0];
  const hn: number[] = [src];
  while (hd.length) {
    const d = hd[0];
    const u = hn[0];
    const ld = hd.pop()!;
    const ln = hn.pop()!;
    if (hd.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= hd.length) break;
        const c = l + 1 < hd.length && hd[l + 1] < hd[l] ? l + 1 : l;
        if (hd[c] >= ld) break;
        hd[i] = hd[c];
        hn[i] = hn[c];
        i = c;
      }
      hd[i] = ld;
      hn[i] = ln;
    }
    if (d > dist[u]) continue;
    for (const e of g.adj[u]) {
      const w = g.minutes[e] * mult[e];
      if (w === Infinity) continue;
      const v = g.eu[e] === u ? g.ev[e] : g.eu[e];
      const nd = d + w;
      if (nd < dist[v]) {
        dist[v] = nd;
        prev[v] = e;
        let i = hd.length;
        hd.push(nd);
        hn.push(v);
        while (i > 0) {
          const p = (i - 1) >> 1;
          if (hd[p] <= nd) break;
          hd[i] = hd[p];
          hn[i] = hn[p];
          i = p;
        }
        hd[i] = nd;
        hn[i] = v;
      }
    }
  }
  return { dist, prev };
}

export function walkBack(g: Graph, prev: Int32Array, dst: number) {
  const path = [dst];
  for (let v = dst; prev[v] !== -1; ) {
    const e = prev[v];
    v = g.eu[e] === v ? g.ev[e] : g.eu[e];
    path.push(v);
  }
  return path.reverse();
}

/* ───────────────────────── 3. greedy allocation ───────────────────────── */

export interface Depot {
  id: string;
  name: string;
  node: number;
  supply: Mix;
  vehicles: number;
}
export interface Demand {
  id: string;
  name: string;
  kind: string;
  node: number;
  need: Mix;
  priority: 1 | 2 | 3;
  deadline: number; // minutes after dispatch
}
export type Bundle = { depot: string; place: string; c: Commodity; units: number };

export function allocate(
  depots: Depot[],
  demands: Demand[],
  t: (depot: string, place: string) => number,
  policy: 'priority' | 'fcfs' = 'priority',
) {
  const stock = Object.fromEntries(depots.map((d) => [d.id, { ...d.supply }]));
  const order = [...demands];
  if (policy === 'priority') order.sort((a, b) => b.priority - a.priority || a.deadline - b.deadline);
  const bundles: Bundle[] = [];
  for (const v of order) {
    let from = depots.filter((d) => t(d.id, v.id) <= v.deadline).sort((a, b) => t(a.id, v.id) - t(b.id, v.id));
    if (policy === 'fcfs') from = from.slice(0, 1);
    for (const c of COMMODITIES) {
      let need = v.need[c];
      for (const d of from) {
        const take = Math.min(need, stock[d.id][c]);
        if (take > 0) {
          stock[d.id][c] -= take;
          need -= take;
          bundles.push({ depot: d.id, place: v.id, c, units: take });
        }
        if (need === 0) break;
      }
    }
  }
  return bundles;
}

/* ───────────────────────── 4. 0/1 knapsack ───────────────────────── */

export function knapsack(items: [number, number][], capacity: number) {
  const n = items.length;
  const best = Array.from({ length: n + 1 }, () => new Float64Array(capacity + 1));
  items.forEach(([w, val], k) => {
    const row = best[k + 1];
    const prev = best[k];
    for (let c = 0; c <= capacity; c++) {
      row[c] = prev[c];
      if (w <= c && prev[c - w] + val > row[c]) row[c] = prev[c - w] + val;
    }
  });
  const chosen: number[] = [];
  for (let i = n, c = capacity; i > 0; i--) {
    if (best[i][c] !== best[i - 1][c]) {
      chosen.push(i - 1);
      c -= items[i - 1][0];
    }
  }
  return { value: best[n][capacity], chosen: chosen.reverse() };
}

/** Per depot: merge bundles into per-place parcels, fill each vehicle by knapsack. */
export function loadVehicles(depots: Depot[], demands: Demand[], bundles: Bundle[], capacity: number) {
  const pri = Object.fromEntries(demands.map((d) => [d.id, d.priority]));
  const loads: Record<string, { place: string; units: number; mix: Mix }[][]> = {};
  for (const d of depots) {
    const parcels = new Map<string, Mix>();
    for (const b of bundles) {
      if (b.depot !== d.id) continue;
      const m = parcels.get(b.place) ?? { water: 0, food: 0, medical: 0 };
      m[b.c] += b.units;
      parcels.set(b.place, m);
    }
    let items: { place: string; units: number; mix: Mix }[] = [];
    for (const [place, mix] of parcels) {
      // split parcels larger than one vehicle, keeping the commodity mix proportional
      let left = mix.water + mix.food + mix.medical;
      const total = left;
      while (left > 0) {
        const part = Math.min(left, capacity);
        const f = part / total;
        items.push({ place, units: part, mix: scaleMix(mix, f) });
        left -= part;
      }
    }
    const trips: (typeof items)[] = [];
    for (let k = 0; k < d.vehicles && items.length; k++) {
      const { chosen } = knapsack(
        items.map((it) => [it.units, it.units * pri[it.place]]),
        capacity,
      );
      const set = new Set(chosen);
      trips.push(chosen.map((i) => items[i]));
      items = items.filter((_, i) => !set.has(i));
    }
    loads[d.id] = trips;
  }
  return loads;
}

const scaleMix = (m: Mix, f: number): Mix => ({
  water: Math.round(m.water * f),
  food: Math.round(m.food * f),
  medical: Math.round(m.medical * f),
});

/* ───────────────────────── 5. routing with deadlines ───────────────────────── */

/**
 * dp[mask][j] = earliest arrival at stop j having visited exactly `mask`, every one on time.
 * Maximises delivered value; ties broken by earliest finish. O(2^k k^2), exact for k ≤ 13.
 */
export function routeDp(
  start: number,
  stops: number[],
  value: number[],
  deadline: number[],
  t: (a: number, b: number) => number,
) {
  const k = stops.length;
  const full = 1 << k;
  const dp = new Float64Array(full * k).fill(Infinity);
  const par = new Int8Array(full * k).fill(-1);
  for (let j = 0; j < k; j++) {
    const a = t(start, stops[j]);
    if (a <= deadline[j]) dp[(1 << j) * k + j] = a;
  }
  for (let mask = 1; mask < full; mask++) {
    for (let j = 0; j < k; j++) {
      const a = dp[mask * k + j];
      if (a === Infinity) continue;
      for (let nx = 0; nx < k; nx++) {
        if ((mask >> nx) & 1) continue;
        const arr = a + t(stops[j], stops[nx]);
        const s = (mask | (1 << nx)) * k + nx;
        if (arr <= deadline[nx] && arr < dp[s]) {
          dp[s] = arr;
          par[s] = j;
        }
      }
    }
  }
  let best = { val: 0, time: 0, mask: 0, last: -1 };
  for (let mask = 1; mask < full; mask++) {
    let val = 0;
    for (let i = 0; i < k; i++) if ((mask >> i) & 1) val += value[i];
    for (let j = 0; j < k; j++) {
      const a = dp[mask * k + j];
      if (a === Infinity) continue;
      if (val > best.val || (val === best.val && a < best.time)) best = { val, time: a, mask, last: j };
    }
  }
  const order: number[] = [];
  for (let { mask, last: j } = best; j !== -1; ) {
    order.push(j);
    const pj = par[mask * k + j];
    mask ^= 1 << j;
    j = pj;
  }
  return { value: best.val, order: order.reverse() }; // indices into `stops`
}

/** Nearest-neighbour baseline: closest stop still on time. O(k^2). Used above 13 stops. */
export function routeNearest(
  start: number,
  stops: number[],
  value: number[],
  deadline: number[],
  t: (a: number, b: number) => number,
  lateOk = false,
) {
  let here = start;
  let clock = 0;
  let val = 0;
  const left = new Set(stops.keys());
  const order: number[] = [];
  while (left.size) {
    const feas = [...left].filter((j) => t(here, stops[j]) < Infinity && (lateOk || clock + t(here, stops[j]) <= deadline[j]));
    if (!feas.length) break;
    const j = feas.reduce((a, b) => (t(here, stops[a]) <= t(here, stops[b]) ? a : b));
    clock += t(here, stops[j]);
    here = stops[j];
    left.delete(j);
    order.push(j);
    val += value[j];
  }
  return { value: val, order };
}

/* ───────────────────────── the whole pipeline ───────────────────────── */

export interface Stop {
  place: string;
  units: number;
  mix: Mix;
  /** index in the trip path where this stop is served; -1 = dropped */
  idx: number;
}
export interface Trip {
  depot: string;
  path: number[];
  stops: Stop[];
}

/** Dijkstra from every node in `sources`; returns t(a, b) in minutes and the trees for paths. */
export function travelTimes(g: Graph, mult: Float64Array, sources: number[]) {
  const trees = new Map<number, ReturnType<typeof dijkstra>>();
  for (const s of new Set(sources)) trees.set(s, dijkstra(g, mult, s));
  return { trees, t: (a: number, b: number) => (a === b ? 0 : trees.get(a)!.dist[b]) };
}

/** Stitch per-leg shortest paths into one node path; returns the path and each stop's index. */
export function stitch(g: Graph, trees: Map<number, ReturnType<typeof dijkstra>>, start: number, nodes: number[]) {
  const path = [start];
  const idx: number[] = [];
  let here = start;
  for (const v of nodes) {
    if (v !== here) path.push(...walkBack(g, trees.get(here)!.prev, v).slice(1));
    idx.push(path.length - 1);
    here = v;
  }
  return { path, idx };
}

export function plan(g: Graph, mult: Float64Array, depots: Depot[], demands: Demand[], capacity: number) {
  const byId = Object.fromEntries([...depots, ...demands].map((p) => [p.id, p]));
  const { trees, t } = travelTimes(g, mult, [...depots, ...demands].map((p) => p.node));
  const bundles = allocate(depots, demands, (d, v) => t(byId[d].node, byId[v].node));
  const loads = loadVehicles(depots, demands, bundles, capacity);
  const trips: Trip[] = [];
  for (const d of depots) {
    for (const trip of loads[d.id]) {
      const merged = new Map<string, { units: number; mix: Mix }>();
      for (const it of trip) {
        const m = merged.get(it.place) ?? { units: 0, mix: { water: 0, food: 0, medical: 0 } };
        m.units += it.units;
        for (const c of COMMODITIES) m.mix[c] += it.mix[c];
        merged.set(it.place, m);
      }
      const places = [...merged.keys()];
      const nodes = places.map((p) => byId[p].node);
      const value = places.map((p) => merged.get(p)!.units * (byId[p] as Demand).priority);
      const dl = places.map((p) => (byId[p] as Demand).deadline);
      const fn = places.length <= 13 ? routeDp : routeNearest;
      const { order } = fn(d.node, nodes, value, dl, t);
      const { path, idx } = stitch(g, trees, d.node, order.map((j) => nodes[j]));
      const stops: Stop[] = places.map((p, j) => ({
        place: p,
        ...merged.get(p)!,
        idx: order.includes(j) ? idx[order.indexOf(j)] : -1,
      }));
      stops.sort((a, b) => (a.idx === -1 ? 1e9 : a.idx) - (b.idx === -1 ? 1e9 : b.idx));
      trips.push({ depot: d.id, path, stops });
    }
  }
  return { trips, bundles, t };
}

/* ───────────────────────── 6. live trip state ───────────────────────── */

export const SIM_RATE = 6; // one real minute = six trip minutes, so a demo trip runs in ~15 min
export const DWELL = 12; // trip minutes parked at the end before the demo loop restarts

export interface Threat {
  hazard: Hazard;
  effect: 'closed' | 'slowed' | 'near';
  forecast: boolean;
  inMinutes: number;
  km: number;
}
export interface Assessment {
  pos: LngLat;
  bearing: number;
  at: number; // path index of the edge being driven (path[at] -> path[at+1])
  clock: number; // trip minutes since dispatch
  total: number; // free-flow trip length
  halted: boolean; // held at the last open node before a closed road
  done: boolean;
  threats: Threat[];
  level: 'critical' | 'warning' | 'clear';
  eta: { stop: Stop; minutes: number; late: boolean; served: boolean }[];
  remainingKm: number;
}

export function pathEdges(g: Graph, path: number[]) {
  const out: number[] = [];
  for (let i = 1; i < path.length; i++) out.push(edgeBetween(g, path[i - 1], path[i]));
  return out;
}

export function pathCoords(g: Graph, path: number[], from = 0): LngLat[] {
  const out: LngLat[] = [g.nodes[path[from]]];
  for (let i = from + 1; i < path.length; i++) {
    const e = edgeBetween(g, path[i - 1], path[i]);
    if (e >= 0) out.push(...edgeCoords(g, e, path[i - 1]).slice(1));
  }
  return out;
}

function along(c: LngLat[], f: number): { p: LngLat; bearing: number } {
  const total = polylineMeters(c);
  let goal = total * f;
  for (let i = 1; i < c.length; i++) {
    const seg = meters(c[i - 1], c[i]);
    if (goal <= seg || i === c.length - 1) {
      const r = seg ? Math.min(1, goal / seg) : 0;
      const p: LngLat = [c[i - 1][0] + (c[i][0] - c[i - 1][0]) * r, c[i - 1][1] + (c[i][1] - c[i - 1][1]) * r];
      const bearing = (Math.atan2(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]) * 180) / Math.PI;
      return { p, bearing };
    }
    goal -= seg;
  }
  return { p: c[c.length - 1], bearing: 0 };
}

/**
 * Where a driver is and what lies ahead. Position is simulated from the dispatch time at
 * SIM_RATE along free-flow times (ponytail: simulated GPS; swap in navigator.geolocation for
 * real vehicles). The vehicle holds at the last open node before a closed road.
 */
export function assess(
  g: Graph,
  trip: { path: number[]; stops: Stop[]; started_at: number },
  live: RoadState,
  hazards: Hazard[],
  deadlines: Record<string, number>,
  now: number,
): Assessment {
  const edges = pathEdges(g, trip.path);
  const cum = [0];
  for (const e of edges) cum.push(cum[cum.length - 1] + (e >= 0 ? g.minutes[e] : 0));
  const total = cum[cum.length - 1];
  let clock = (((now - trip.started_at) / 60000) * SIM_RATE) % (total + DWELL);
  if (clock < 0) clock = 0;

  let at = 0;
  while (at < edges.length - 1 && cum[at + 1] <= clock) at++;
  let halted = false;
  const blockedAt = edges.findIndex((e, i) => i >= at && e >= 0 && live.mult[e] === Infinity);
  if (blockedAt !== -1 && clock >= cum[blockedAt]) {
    // ponytail: held at the node before the closure; the loop restarts the demo after DWELL
    halted = true;
    at = blockedAt;
    clock = cum[blockedAt];
  }
  const done = !halted && clock >= total;
  let pos: LngLat = g.nodes[trip.path[trip.path.length - 1]];
  let bearing = 0;
  if (!done && edges.length) {
    const e = edges[at];
    const f = halted ? 0 : (clock - cum[at]) / Math.max(1e-9, cum[at + 1] - cum[at]);
    const r = along(edgeCoords(g, e, trip.path[at]), Math.min(1, Math.max(0, f)));
    pos = r.p;
    bearing = r.bearing;
  }

  // walk the road ahead under live conditions; per hazard keep first contact and worst effect
  const hz = new Map(hazards.map((h) => [h.id, h]));
  const seen = new Map<string, Threat>();
  let t = 0;
  let km = 0;
  const etaAt = new Float64Array(trip.path.length).fill(Infinity);
  etaAt[at] = clock;
  const touch = (ids: string[] | undefined, inside: boolean) =>
    ids?.forEach((id) => {
      const h = hz.get(id);
      const prev = seen.get(id);
      if (!h || (prev && (prev.effect !== 'near' || !inside))) return;
      const effect = !inside ? 'near' : h.severity >= 2 ? 'closed' : 'slowed';
      seen.set(id, { hazard: h, effect, forecast: h.starts_at > now, inMinutes: t, km });
    });
  for (let i = done ? edges.length : at; i < edges.length; i++) {
    const e = edges[i];
    if (e < 0) continue;
    touch(live.inside.get(e), true);
    touch(live.near.get(e), false);
    const partial = i === at && !halted ? 1 - (clock - cum[at]) / Math.max(1e-9, cum[at + 1] - cum[at]) : 1;
    t += g.minutes[e] * live.mult[e] * partial;
    km += g.km[e] * partial;
    etaAt[i + 1] = clock + t;
  }
  const threats = [...seen.values()].sort((a, b) => a.inMinutes - b.inMinutes);
  // critical: a road ahead is closed now. warning: closure forecast, slowdown, or passing close.
  const level = threats.some((x) => x.effect === 'closed' && !x.forecast)
    ? 'critical'
    : threats.some((x) => x.effect !== 'near' || !x.forecast)
      ? 'warning'
      : 'clear';
  const eta = trip.stops
    .filter((s) => s.idx >= 0)
    .map((stop) => {
      const served = stop.idx <= at && (done || stop.idx < at || (stop.idx === at && clock >= cum[at]));
      const minutes = served ? cum[stop.idx] : etaAt[stop.idx];
      return { stop, minutes, late: minutes > (deadlines[stop.place] ?? Infinity), served };
    });
  return { pos, bearing, at, clock, total, halted, done, threats, level, eta, remainingKm: km };
}

/**
 * Driver reroute: keep the road already driven up to the next intersection, then re-solve the
 * remaining stops on roads that avoid every hazard, forecast ones included. On-time stops are
 * chosen by the subset DP exactly as in the report; unlike the report's planner a driver
 * already on the road still delivers stops that can only be reached late, after the on-time
 * ones, rather than abandoning them. Unreachable stops are dropped (idx = -1).
 */
export function reroute(
  g: Graph,
  trip: { path: number[]; stops: Stop[] },
  a: Assessment,
  avoid: RoadState,
  places: Record<string, { node: number; priority: number; deadline: number }>,
) {
  const keep = Math.min(a.halted ? a.at : a.at + 1, trip.path.length - 1);
  const from = trip.path[keep];
  const pending = trip.stops.filter((s) => s.idx > keep || s.idx === -1); // dropped stops get another chance
  const done = trip.stops.filter((s) => s.idx >= 0 && s.idx <= keep);
  const nodes = pending.map((s) => places[s.place].node);
  const { trees, t } = travelTimes(g, avoid.mult, [from, ...nodes]);
  const value = pending.map((s) => s.units * places[s.place].priority);
  const dl = pending.map((s) => places[s.place].deadline - a.clock);
  const fn = pending.length <= 13 ? routeDp : routeNearest;
  const onTime = fn(from, nodes, value, dl, t).order;
  const lastNode = onTime.length ? nodes[onTime[onTime.length - 1]] : from;
  const restIdx = pending.map((_, j) => j).filter((j) => !onTime.includes(j));
  const late = routeNearest(lastNode, restIdx.map((j) => nodes[j]), restIdx.map((j) => value[j]), restIdx.map(() => Infinity), t, true).order.map(
    (r) => restIdx[r],
  );
  const order = [...onTime, ...late];
  const leg = stitch(g, trees, from, order.map((j) => nodes[j]));
  const path = [...trip.path.slice(0, keep), ...leg.path];
  const stops: Stop[] = [
    ...done,
    ...order.map((j, k) => ({ ...pending[j], idx: keep + leg.idx[k] })),
    ...pending.filter((_, j) => !order.includes(j)).map((s) => ({ ...s, idx: -1 })),
  ];
  const minutes = (p: number[], i0: number) => pathEdges(g, p.slice(i0)).reduce((s, e) => s + g.minutes[e] * avoid.mult[e], 0);
  return { path, stops, newMinutes: minutes(path, keep), oldMinutes: minutes(trip.path, keep) };
}
