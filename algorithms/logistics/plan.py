"""Allocation, vehicle loading and routing, and the robustness evaluation."""
import math
import random
from itertools import permutations

from .graph import COMMODITIES, dijkstra, kruskal_backbone, usable_adjacency


# ── 1. allocation: greedy priority heuristic for the multi-commodity transport problem ──

def allocate(inst, times, policy="priority"):
    """Assign each demand node's commodities to depots.

    priority: critical first, then earliest deadline; each commodity from the depot that
              arrives soonest and still has stock (split across depots if needed).
    fcfs:     demand in arrival order from the nearest depot only (the manual baseline).
    Returns list of bundles (depot, node, commodity, units). O(N log N + N*D*C)."""
    stock = {d: dict(inst.supply[d]) for d in inst.depots}
    nodes = list(inst.demand)
    if policy == "priority":
        nodes.sort(key=lambda v: (-inst.priority[v], inst.deadline[v]))
    bundles = []
    for v in nodes:
        reachable = [d for d in inst.depots if times[d][v] <= inst.deadline[v]]
        order = sorted(reachable, key=lambda d: times[d][v])
        if policy == "fcfs":
            order = order[:1]
        for c in COMMODITIES:
            need = inst.demand[v][c]
            for d in order:
                take = min(need, stock[d][c])
                if take > 0:
                    stock[d][c] -= take
                    need -= take
                    bundles.append((d, v, c, take))
                if need == 0:
                    break
    return bundles


# ── 2. vehicle loading: 0/1 knapsack by dynamic programming ──

def knapsack(items, capacity):
    """items: list of (weight, value). Returns (best value, chosen indices). O(n * capacity)."""
    n = len(items)
    best = [[0] * (capacity + 1) for _ in range(n + 1)]
    for i, (w, val) in enumerate(items, 1):
        row, prev = best[i], best[i - 1]
        for c in range(capacity + 1):
            row[c] = prev[c]
            if w <= c and prev[c - w] + val > row[c]:
                row[c] = prev[c - w] + val
    chosen, c = [], capacity
    for i in range(n, 0, -1):
        if best[i][c] != best[i - 1][c]:
            chosen.append(i - 1)
            c -= items[i - 1][0]
    return best[n][capacity], chosen[::-1]


def load_vehicles(inst, bundles):
    """Per depot, merge bundles into per-node parcels and fill each vehicle with a knapsack
    that maximises priority-weighted units. Returns {depot: [list of node parcels per vehicle]}."""
    loads = {}
    for d in inst.depots:
        parcels = {}
        for (dd, v, c, u) in bundles:
            if dd == d:
                parcels[v] = parcels.get(v, 0) + u
        items = []                               # split parcels larger than a vehicle
        for v, u in parcels.items():
            while u > 0:
                part = min(u, inst.capacity)
                items.append((v, part))
                u -= part
        trips = []
        for _ in range(inst.vehicles[d]):
            if not items:
                break
            value, chosen = knapsack([(u, u * inst.priority[v]) for v, u in items], inst.capacity)
            trips.append([items[i] for i in chosen])
            items = [it for i, it in enumerate(items) if i not in set(chosen)]
        loads[d] = trips
    return loads


# ── 3. routing one vehicle: Held–Karp style subset DP with deadlines ──

def route_dp(depot, stops, value, deadline, t):
    """Choose and order stops to maximise delivered value with every visited stop on time.

    dp[mask][j] = earliest arrival at stop j having visited exactly `mask` on time.
    O(2^k * k^2) time, O(2^k * k) memory — exact, used for k <= 13."""
    k = len(stops)
    INF = math.inf
    dp = [[INF] * k for _ in range(1 << k)]
    par = [[-1] * k for _ in range(1 << k)]
    for j, s in enumerate(stops):
        a = t[depot][s]
        if a <= deadline[s]:
            dp[1 << j][j] = a
    for mask in range(1, 1 << k):
        row = dp[mask]
        for j in range(k):
            a = row[j]
            if a == INF:
                continue
            sj = stops[j]
            for nxt in range(k):
                if mask >> nxt & 1:
                    continue
                arr = a + t[sj][stops[nxt]]
                nm = mask | 1 << nxt
                if arr <= deadline[stops[nxt]] and arr < dp[nm][nxt]:
                    dp[nm][nxt] = arr
                    par[nm][nxt] = j
    best = (0, 0.0, 0, -1)                     # (value, -time, mask, last)
    for mask in range(1, 1 << k):
        for j in range(k):
            if dp[mask][j] < INF:
                val = sum(value[stops[i]] for i in range(k) if mask >> i & 1)
                cand = (val, -dp[mask][j], mask, j)
                if cand[:2] > best[:2]:
                    best = cand
    val, _, mask, j = best
    order = []
    while j != -1:
        order.append(stops[j])
        pj = par[mask][j]
        mask ^= 1 << j
        j = pj
    return val, order[::-1]


def route_nearest(depot, stops, value, deadline, t):
    """Nearest-neighbour heuristic: always drive to the closest unvisited stop that is
    still on time. O(k^2)."""
    here, clock, left, order, val = depot, 0.0, set(stops), [], 0
    while left:
        feas = [s for s in left if clock + t[here][s] <= deadline[s]]
        if not feas:
            break
        s = min(feas, key=lambda s: t[here][s])
        clock += t[here][s]
        here = s
        left.discard(s)
        order.append(s)
        val += value[s]
    return val, order


def route_bruteforce(depot, stops, value, deadline, t):
    """Exhaustive check for small k; used only by the tests."""
    best = (0, [])
    for r in range(1, len(stops) + 1):
        for perm in permutations(stops, r):
            clock, here, ok = 0.0, depot, True
            for s in perm:
                clock += t[here][s]
                here = s
                if clock > deadline[s]:
                    ok = False
                    break
            if ok:
                v = sum(value[s] for s in perm)
                if v > best[0]:
                    best = (v, list(perm))
    return best


# ── 4. the full pipeline and its evaluation ──

def travel_matrix(inst, cleared, multipliers=None):
    adj = usable_adjacency(inst.n, inst.edges, cleared, multipliers)
    nodes = set(inst.depots) | set(inst.demand)
    return {s: dijkstra(adj, s) for s in nodes}


def plan(inst, cleared=None, quantile_z=0.0, policy="priority", router="dp"):
    """Build a dispatch plan. quantile_z > 0 plans with pessimistic travel times
    exp(z * sigma) per road: the robust policy."""
    if cleared is None:
        cleared = kruskal_backbone(inst.n, inst.edges)
    mult = {i: math.exp(quantile_z * inst.sigma[i]) for i in range(len(inst.edges))} if quantile_z else None
    t = travel_matrix(inst, cleared, mult)
    bundles = allocate(inst, t, policy)
    loads = load_vehicles(inst, bundles)
    routes = []
    for d, trips in loads.items():
        for trip in trips:
            units = {}
            for v, u in trip:
                units[v] = units.get(v, 0) + u
            stops = list(units)
            value = {v: units[v] * inst.priority[v] for v in stops}
            fn = route_dp if router == "dp" and len(stops) <= 13 else route_nearest
            _, order = fn(d, stops, value, inst.deadline, t)
            routes.append((d, order, units))
    return cleared, routes


def evaluate(inst, cleared, routes, multipliers=None):
    """Replay a plan on (possibly random) actual travel times. Returns priority-weighted units
    delivered on time and units delivered on time to critical nodes."""
    t = travel_matrix(inst, cleared, multipliers)
    weighted = critical = 0
    for d, order, units in routes:
        clock, here = 0.0, d
        for s in order:
            clock += t[here][s]
            here = s
            if clock <= inst.deadline[s]:
                weighted += units[s] * inst.priority[s]
                if inst.priority[s] == 3:
                    critical += units[s]
    return weighted, critical


def total_need(inst):
    w = sum(sum(inst.demand[v].values()) * inst.priority[v] for v in inst.demand)
    c = sum(sum(inst.demand[v].values()) for v in inst.demand if inst.priority[v] == 3)
    return w, c


def sample_multipliers(inst, rng):
    return {i: rng.lognormvariate(0.0, inst.sigma[i]) for i in range(len(inst.edges))}
