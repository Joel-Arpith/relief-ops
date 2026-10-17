"""Time spent in each pipeline stage on 10 random 150-node disasters (median ms)."""
import json, random, statistics as st, time
from pathlib import Path
from logistics.graph import kruskal_backbone, make_instance
from logistics.plan import (allocate, evaluate, load_vehicles, route_dp, sample_multipliers, travel_matrix)

T = {k: [] for k in ["kruskal", "dijkstra", "allocate", "knapsack", "routing", "evaluate500"]}
for seed in range(10):
    inst = make_instance(n=150, n_demand=40, seed=700 + seed)
    t0 = time.perf_counter(); tree = kruskal_backbone(inst.n, inst.edges); T["kruskal"].append(time.perf_counter() - t0)
    t0 = time.perf_counter(); t = travel_matrix(inst, tree); T["dijkstra"].append(time.perf_counter() - t0)
    t0 = time.perf_counter(); b = allocate(inst, t); T["allocate"].append(time.perf_counter() - t0)
    t0 = time.perf_counter(); loads = load_vehicles(inst, b); T["knapsack"].append(time.perf_counter() - t0)
    t0 = time.perf_counter(); routes = []
    for d, trips in loads.items():
        for trip in trips:
            u = {}
            for v, q in trip: u[v] = u.get(v, 0) + q
            stops = list(u); _, order = route_dp(d, stops, {v: u[v] * inst.priority[v] for v in stops}, inst.deadline, t)
            routes.append((d, order, u))
    T["routing"].append(time.perf_counter() - t0)
    rng = random.Random(1); t0 = time.perf_counter()
    for _ in range(500): evaluate(inst, tree, routes, sample_multipliers(inst, rng))
    T["evaluate500"].append(time.perf_counter() - t0)
res = {k: round(st.median(v) * 1000, 2) for k, v in T.items()}
Path("results/profile.json").write_text(json.dumps(res, indent=1)); print(res)
