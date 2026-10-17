"""Road network after a disaster: instance generator, MST backbone, shortest paths.

All algorithms are written from scratch (standard library only) because the point of the
project is their design and analysis, not a library call.
"""
import heapq
import math
import random
from dataclasses import dataclass, field

COMMODITIES = ("water", "food", "medical")
SPEED_KMPH = 25.0          # post-disaster average: debris, detours, checkpoints


@dataclass
class Edge:
    u: int
    v: int
    minutes: float          # travel time when passable
    damaged: bool           # blocked until cleared
    clear_hours: float      # effort to clear (0 if intact)


@dataclass
class Instance:
    n: int
    xy: list                          # node coordinates in km
    edges: list                       # list[Edge]
    depots: list                      # node ids
    supply: dict                      # depot -> {commodity: units}
    vehicles: dict                    # depot -> number of vehicles
    capacity: int                     # units per vehicle
    demand: dict                      # node -> {commodity: units}
    priority: dict                    # node -> 1 (normal), 2 (urgent), 3 (critical)
    deadline: dict                    # node -> minutes after dispatch
    sigma: dict = field(default_factory=dict)   # edge index -> log-normal spread of travel time


def make_instance(n=150, n_depots=3, n_demand=40, k=4, damage_p=0.25, supply_ratio=0.7,
                  vehicles_per_depot=3, capacity=60, size_km=25.0, seed=0):
    """Random geometric road graph: each node joins its k nearest neighbours."""
    rng = random.Random(seed)
    xy = [(rng.uniform(0, size_km), rng.uniform(0, size_km)) for _ in range(n)]
    pairs = set()
    for i in range(n):
        near = sorted(range(n), key=lambda j: (xy[i][0] - xy[j][0]) ** 2 + (xy[i][1] - xy[j][1]) ** 2)[1:k + 1]
        for j in near:
            pairs.add((min(i, j), max(i, j)))
    # join any disconnected components with their closest pair, so a backbone always exists
    uf = UnionFind(n)
    for a, b in pairs:
        uf.union(a, b)
    roots = {uf.find(i) for i in range(n)}
    while len(roots) > 1:
        comp = [i for i in range(n) if uf.find(i) == uf.find(0)]
        rest = [i for i in range(n) if uf.find(i) != uf.find(0)]
        a, b = min(((a, b) for a in comp for b in rest), key=lambda p: _km(xy, *p))
        pairs.add((min(a, b), max(a, b)))
        uf.union(a, b)
        roots = {uf.find(i) for i in range(n)}
    edges, sigma = [], {}
    for idx, (a, b) in enumerate(sorted(pairs)):
        km = _km(xy, a, b) * 1.3                       # roads are longer than straight lines
        damaged = rng.random() < damage_p
        edges.append(Edge(a, b, km / SPEED_KMPH * 60, damaged, rng.uniform(0.5, 6.0) if damaged else 0.0))
        sigma[idx] = 0.5 if damaged else 0.2         # cleared roads are less predictable
    depots = rng.sample(range(n), n_depots)
    others = [i for i in range(n) if i not in depots]
    dnodes = rng.sample(others, n_demand)
    demand, priority, deadline = {}, {}, {}
    for v in dnodes:
        demand[v] = {c: rng.randint(2, 12) for c in COMMODITIES}
        priority[v] = rng.choices([1, 2, 3], weights=[5, 3, 2])[0]
        deadline[v] = {3: 75, 2: 130, 1: 200}[priority[v]] + rng.randint(-15, 15)
    total = {c: sum(demand[v][c] for v in dnodes) for c in COMMODITIES}
    supply = {d: {c: int(total[c] * supply_ratio / n_depots) for c in COMMODITIES} for d in depots}
    return Instance(n, xy, edges, depots, supply, {d: vehicles_per_depot for d in depots}, capacity,
                    demand, priority, deadline, sigma)


def _km(xy, a, b):
    return math.dist(xy[a], xy[b])


class UnionFind:
    """Disjoint sets with path halving and union by rank: near-constant amortised time."""

    def __init__(self, n):
        self.parent = list(range(n))
        self.rank = [0] * n

    def find(self, x):
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return False
        if self.rank[ra] < self.rank[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        if self.rank[ra] == self.rank[rb]:
            self.rank[ra] += 1
        return True


def kruskal_backbone(n, edges):
    """Minimum-clearance spanning tree. Weight = clearing effort (0 for intact roads), ties
    broken by travel time, so intact fast roads are always preferred. O(E log E)."""
    order = sorted(range(len(edges)), key=lambda i: (edges[i].clear_hours, edges[i].minutes))
    uf, tree = UnionFind(n), []
    for i in order:
        if uf.union(edges[i].u, edges[i].v):
            tree.append(i)
            if len(tree) == n - 1:
                break
    return tree


def usable_adjacency(n, edges, cleared, multipliers=None):
    """Adjacency list of passable roads: intact ones plus those chosen for clearing."""
    adj = [[] for _ in range(n)]
    cleared = set(cleared)
    for i, e in enumerate(edges):
        if e.damaged and i not in cleared:
            continue
        w = e.minutes * (multipliers[i] if multipliers else 1.0)
        adj[e.u].append((e.v, w))
        adj[e.v].append((e.u, w))
    return adj


def dijkstra(adj, src):
    """Single-source shortest times with a binary heap. O((V + E) log V)."""
    dist = [math.inf] * len(adj)
    dist[src] = 0.0
    heap = [(0.0, src)]
    while heap:
        d, u = heapq.heappop(heap)
        if d > dist[u]:
            continue                      # stale entry
        for v, w in adj[u]:
            nd = d + w
            if nd < dist[v]:
                dist[v] = nd
                heapq.heappush(heap, (nd, v))
    return dist


def floyd_warshall(adj):
    """All-pairs shortest times, for comparison with repeated Dijkstra. O(V^3)."""
    n = len(adj)
    d = [[math.inf] * n for _ in range(n)]
    for u in range(n):
        d[u][u] = 0.0
        for v, w in adj[u]:
            d[u][v] = min(d[u][v], w)
    for k in range(n):
        dk = d[k]
        for i in range(n):
            dik = d[i][k]
            if dik == math.inf:
                continue
            di = d[i]
            for j in range(n):
                if dik + dk[j] < di[j]:
                    di[j] = dik + dk[j]
    return d
