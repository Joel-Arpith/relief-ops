"""Smallest checks that fail if an algorithm breaks. Run: python3 test_logistics.py"""
import itertools
import math
import random

from logistics.graph import Edge, UnionFind, dijkstra, floyd_warshall, kruskal_backbone, make_instance, usable_adjacency
from logistics.plan import evaluate, knapsack, plan, route_bruteforce, route_dp, route_nearest


def test_union_find():
    uf = UnionFind(5)
    assert uf.union(0, 1) and uf.union(3, 4) and not uf.union(1, 0)
    assert uf.find(0) == uf.find(1) and uf.find(2) != uf.find(3)


def test_kruskal_prefers_intact_roads():
    # triangle: two intact roads, one damaged; the tree must avoid clearing
    es = [Edge(0, 1, 5, False, 0), Edge(1, 2, 5, False, 0), Edge(0, 2, 1, True, 3)]
    assert sorted(kruskal_backbone(3, es)) == [0, 1]


def test_dijkstra_matches_floyd():
    inst = make_instance(n=40, n_demand=8, seed=3)
    adj = usable_adjacency(inst.n, inst.edges, kruskal_backbone(inst.n, inst.edges))
    fw = floyd_warshall(adj)
    for s in range(0, inst.n, 7):
        d = dijkstra(adj, s)
        assert all(math.isclose(d[v], fw[s][v]) for v in range(inst.n))


def test_knapsack_against_exhaustive():
    rng = random.Random(1)
    for _ in range(30):
        items = [(rng.randint(1, 15), rng.randint(1, 40)) for _ in range(9)]
        cap = rng.randint(10, 40)
        best = max(sum(v for w, v in sub) for r in range(10) for sub in itertools.combinations(items, r)
                   if sum(w for w, v in sub) <= cap)
        val, chosen = knapsack(items, cap)
        assert val == best and sum(items[i][0] for i in chosen) <= cap


def test_route_dp_is_exact_and_beats_nearest():
    rng = random.Random(2)
    worse = 0
    for trial in range(25):
        k = 6
        pts = {i: (rng.uniform(0, 30), rng.uniform(0, 30)) for i in range(k + 1)}
        t = {a: {b: math.dist(pts[a], pts[b]) for b in pts} for a in pts}
        stops = list(range(1, k + 1))
        value = {s: rng.randint(1, 9) for s in stops}
        deadline = {s: rng.uniform(20, 90) for s in stops}
        exact = route_bruteforce(0, stops, value, deadline, t)[0]
        assert route_dp(0, stops, value, deadline, t)[0] == exact
        worse += route_nearest(0, stops, value, deadline, t)[0] < exact
    assert worse > 0          # the heuristic is genuinely suboptimal sometimes


def test_plan_delivers_only_on_time():
    inst = make_instance(n=80, n_demand=15, seed=5)
    cleared, routes = plan(inst)
    w, c = evaluate(inst, cleared, routes)
    assert w > 0
    shipped = sum(sum(u.values()) for _, _, u in routes)
    assert shipped <= sum(sum(s.values()) for s in inst.supply.values())


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("PASS", name)
