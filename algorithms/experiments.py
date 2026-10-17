"""Runs every experiment in the report and writes results/results.json and figures/*.png.
   PYTHONPATH=<dir with matplotlib> python3 experiments.py"""
import json
import math
import random
import statistics as st
import time
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from logistics.graph import dijkstra, floyd_warshall, kruskal_backbone, make_instance, usable_adjacency
from logistics.plan import (evaluate, knapsack, plan, route_dp, route_nearest, sample_multipliers,
                            total_need, travel_matrix)

OUT = Path(__file__).parent
(OUT / "figures").mkdir(exist_ok=True)
(OUT / "results").mkdir(exist_ok=True)
R = {}
plt.rcParams.update({"font.family": "serif", "font.size": 9, "axes.spines.top": False, "axes.spines.right": False,
                     "figure.dpi": 200})


def timed(fn, reps=3):
    best = math.inf
    for _ in range(reps):
        t0 = time.perf_counter()
        out = fn()
        best = min(best, time.perf_counter() - t0)
    return best * 1000, out


# E1: scaling of the graph algorithms
sizes = [50, 100, 200, 400, 800, 1600]
e1 = []
for n in sizes:
    inst = make_instance(n=n, n_demand=min(40, n // 4), seed=11)
    tk, tree = timed(lambda: kruskal_backbone(inst.n, inst.edges))
    adj = usable_adjacency(inst.n, inst.edges, tree)
    td, _ = timed(lambda: [dijkstra(adj, d) for d in inst.depots])
    tall, _ = timed(lambda: [dijkstra(adj, s) for s in range(inst.n)], reps=1) if n <= 800 else (None, None)
    tf, _ = timed(lambda: floyd_warshall(adj), reps=1) if n <= 200 else (None, None)
    e1.append({"n": n, "E": len(inst.edges), "kruskal_ms": tk, "dijkstra_depots_ms": td,
               "dijkstra_apsp_ms": tall, "floyd_ms": tf})
R["scaling"] = e1

fig, ax = plt.subplots(figsize=(3.4, 2.4))
ax.loglog([r["n"] for r in e1], [r["kruskal_ms"] for r in e1], "o-", label="Kruskal (MST)")
ax.loglog([r["n"] for r in e1], [r["dijkstra_depots_ms"] for r in e1], "s-", label="Dijkstra, 3 depots")
ap = [r for r in e1 if r["dijkstra_apsp_ms"]]
ax.loglog([r["n"] for r in ap], [r["dijkstra_apsp_ms"] for r in ap], "^-", label="Dijkstra, all pairs")
fw = [r for r in e1 if r["floyd_ms"]]
ax.loglog([r["n"] for r in fw], [r["floyd_ms"] for r in fw], "x--", label="Floyd–Warshall")
ax.set_xlabel("nodes V (E ≈ 2.6V)"); ax.set_ylabel("time (ms)"); ax.legend(fontsize=7, frameon=False)
fig.tight_layout(); fig.savefig(OUT / "figures/fig_scaling.png"); plt.close(fig)

# E2: knapsack DP time grows with n * C
e2 = []
rng = random.Random(4)
for n in [10, 20, 40, 80]:
    for cap in [30, 60, 120, 240]:
        items = [(rng.randint(1, 30), rng.randint(1, 90)) for _ in range(n)]
        t, _ = timed(lambda: knapsack(items, cap), reps=5)
        e2.append({"n": n, "C": cap, "nC": n * cap, "ms": t})
R["knapsack"] = e2

# E3: exact subset DP vs nearest-neighbour routing
e3 = []
rng = random.Random(9)
for k in range(4, 14):
    ratios, tdp, tnn = [], [], []
    for trial in range(20 if k <= 10 else 6):
        pts = {i: (rng.uniform(0, 25), rng.uniform(0, 25)) for i in range(k + 1)}
        t = {a: {b: math.dist(pts[a], pts[b]) * 2.0 for b in pts} for a in pts}
        stops = list(range(1, k + 1))
        value = {s: rng.randint(2, 30) for s in stops}
        deadline = {s: rng.uniform(40, 160) for s in stops}
        a, (vd, _) = timed(lambda: route_dp(0, stops, value, deadline, t), reps=1)
        b, (vn, _) = timed(lambda: route_nearest(0, stops, value, deadline, t), reps=1)
        tdp.append(a); tnn.append(b)
        ratios.append(vn / vd if vd else 1.0)
    e3.append({"k": k, "dp_ms": st.median(tdp), "nn_ms": st.median(tnn), "nn_value_ratio": st.mean(ratios),
               "nn_worst": min(ratios)})
R["routing"] = e3

fig, ax1 = plt.subplots(figsize=(3.4, 2.4))
ax1.semilogy([r["k"] for r in e3], [r["dp_ms"] for r in e3], "o-", label="subset DP time")
ax1.semilogy([r["k"] for r in e3], [r["nn_ms"] for r in e3], "s-", label="nearest-neighbour time")
ax1.set_xlabel("stops on one vehicle k"); ax1.set_ylabel("time (ms)")
ax2 = ax1.twinx(); ax2.spines["right"].set_visible(True)
ax2.plot([r["k"] for r in e3], [100 * r["nn_value_ratio"] for r in e3], "k:", label="NN value, % of exact")
ax2.set_ylabel("NN value (% of DP)"); ax2.set_ylim(60, 101)
h1, l1 = ax1.get_legend_handles_labels(); h2, l2 = ax2.get_legend_handles_labels()
ax1.legend(h1 + h2, l1 + l2, fontsize=6.5, frameon=False, loc="center left")
fig.tight_layout(); fig.savefig(OUT / "figures/fig_routing.png"); plt.close(fig)

# E4: allocation and routing policies on 30 random disasters
e4 = {"priority+dp": [], "priority+nn": [], "fcfs+nn": []}
crit = {k: [] for k in e4}
for seed in range(30):
    inst = make_instance(n=150, n_demand=40, seed=100 + seed)
    need_w, need_c = total_need(inst)
    for key, (pol, rt) in {"priority+dp": ("priority", "dp"), "priority+nn": ("priority", "nn"),
                           "fcfs+nn": ("fcfs", "nn")}.items():
        cleared, routes = plan(inst, policy=pol, router=rt)
        w, c = evaluate(inst, cleared, routes)
        e4[key].append(100 * w / need_w)
        crit[key].append(100 * c / need_c if need_c else 100)
R["policies"] = {k: {"weighted_mean": st.mean(v), "weighted_sd": st.stdev(v), "critical_mean": st.mean(crit[k])}
                 for k, v in e4.items()}

fig, ax = plt.subplots(figsize=(3.4, 2.3))
labels = ["FCFS + nearest\n(manual baseline)", "Priority + nearest", "Priority + DP\n(proposed)"]
keys = ["fcfs+nn", "priority+nn", "priority+dp"]
x = range(3)
ax.bar([i - 0.18 for i in x], [R["policies"][k]["weighted_mean"] for k in keys], 0.36, label="priority-weighted demand")
ax.bar([i + 0.18 for i in x], [R["policies"][k]["critical_mean"] for k in keys], 0.36, label="critical demand")
ax.set_xticks(list(x)); ax.set_xticklabels(labels, fontsize=7); ax.set_ylabel("served on time (%)")
ax.legend(fontsize=7, frameon=False, loc="upper left"); ax.set_ylim(0, 100)
fig.tight_layout(); fig.savefig(OUT / "figures/fig_policies.png"); plt.close(fig)

# E5: robust (90th-percentile) planning vs nominal under random travel times
Z90 = 1.2816
inst = make_instance(n=150, n_demand=40, seed=7)
need_w, need_c = total_need(inst)
cl_n, routes_n = plan(inst, quantile_z=0.0)
cl_r, routes_r = plan(inst, quantile_z=Z90)
rng = random.Random(2024)
nom, rob, nom_c, rob_c = [], [], [], []
for _ in range(500):
    m = sample_multipliers(inst, rng)
    w, c = evaluate(inst, cl_n, routes_n, m); nom.append(100 * w / need_w); nom_c.append(100 * c / need_c)
    w, c = evaluate(inst, cl_r, routes_r, m); rob.append(100 * w / need_w); rob_c.append(100 * c / need_c)
pct = lambda xs, q: sorted(xs)[int(q * (len(xs) - 1))]
R["robust"] = {
    "planned_nominal": 100 * evaluate(inst, cl_n, routes_n)[0] / need_w,
    "planned_robust": 100 * evaluate(inst, cl_r, routes_r)[0] / need_w,
    "nominal": {"mean": st.mean(nom), "p5": pct(nom, 0.05), "critical_mean": st.mean(nom_c), "critical_p5": pct(nom_c, 0.05)},
    "robust": {"mean": st.mean(rob), "p5": pct(rob, 0.05), "critical_mean": st.mean(rob_c), "critical_p5": pct(rob_c, 0.05)},
    "scenarios": 500,
}
fig, ax = plt.subplots(figsize=(3.4, 2.3))
ax.hist(nom, bins=30, alpha=0.6, label="nominal plan")
ax.hist(rob, bins=30, alpha=0.6, label="robust plan (P90 times)")
ax.set_xlabel("priority-weighted demand served on time (%)"); ax.set_ylabel("scenarios")
ax.legend(fontsize=7, frameon=False)
fig.tight_layout(); fig.savefig(OUT / "figures/fig_robust.png"); plt.close(fig)

# E6: MST backbone vs clearing shortest-path trees from the depots
e6 = []
for seed in range(30):
    inst = make_instance(n=150, n_demand=40, seed=300 + seed)
    tree = kruskal_backbone(inst.n, inst.edges)
    mst_cost = sum(inst.edges[i].clear_hours for i in tree)
    # alternative: clear every damaged road on the depots' shortest paths to demand nodes in the undamaged graph
    full = usable_adjacency(inst.n, inst.edges, range(len(inst.edges)))
    import heapq
    spt = set()
    index = {(min(e.u, e.v), max(e.u, e.v)): i for i, e in enumerate(inst.edges)}
    for d in inst.depots:
        dist = [math.inf] * inst.n; par = [-1] * inst.n; dist[d] = 0; h = [(0, d)]
        while h:
            du, u = heapq.heappop(h)
            if du > dist[u]: continue
            for v, w in full[u]:
                if du + w < dist[v]:
                    dist[v] = du + w; par[v] = u; heapq.heappush(h, (dist[v], v))
        for v in inst.demand:
            while par[v] != -1:
                spt.add(index[(min(v, par[v]), max(v, par[v]))]); v = par[v]
    spt_cost = sum(inst.edges[i].clear_hours for i in spt if inst.edges[i].damaged)
    t_mst = travel_matrix(inst, tree); t_spt = travel_matrix(inst, spt)
    avg = lambda t: st.mean(min(t[d][v] for d in inst.depots) for v in inst.demand)
    e6.append({"mst_hours": mst_cost, "spt_hours": spt_cost, "mst_avg_min": avg(t_mst), "spt_avg_min": avg(t_spt)})
R["backbone"] = {k: st.mean(r[k] for r in e6) for k in e6[0]}

# Figure: one instance with backbone and routes
inst = make_instance(n=150, n_demand=40, seed=7)
tree = set(kruskal_backbone(inst.n, inst.edges))
cleared, routes = plan(inst)
fig, ax = plt.subplots(figsize=(3.4, 3.2))
for i, e in enumerate(inst.edges):
    (x1, y1), (x2, y2) = inst.xy[e.u], inst.xy[e.v]
    if e.damaged and i not in tree:
        ax.plot([x1, x2], [y1, y2], color="#d9534f", lw=0.5, ls=":", alpha=0.6)
    elif e.damaged:
        ax.plot([x1, x2], [y1, y2], color="#e08e0b", lw=1.6)
    else:
        ax.plot([x1, x2], [y1, y2], color="#bbbbbb", lw=0.5)
t = travel_matrix(inst, cleared)
colors = ["#1f77b4", "#2ca02c", "#9467bd", "#17becf", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#ff7f0e"]
for k, (d, order, units) in enumerate(routes[:9]):
    pts = [inst.xy[d]] + [inst.xy[s] for s in order]
    ax.plot([p[0] for p in pts], [p[1] for p in pts], color=colors[k % 9], lw=1.1, alpha=0.9)
for v in inst.demand:
    ax.scatter(*inst.xy[v], s=10 + 8 * inst.priority[v], c={1: "#9ecae1", 2: "#fd8d3c", 3: "#cb181d"}[inst.priority[v]], zorder=3, edgecolors="k", linewidths=0.3)
for d in inst.depots:
    ax.scatter(*inst.xy[d], marker="s", s=60, c="k", zorder=4)
ax.set_xticks([]); ax.set_yticks([]); ax.set_aspect("equal")
for s in ax.spines.values(): s.set_visible(True)
fig.tight_layout(); fig.savefig(OUT / "figures/fig_map.png"); plt.close(fig)

R["instance"] = {"n": inst.n, "E": len(inst.edges), "damaged": sum(e.damaged for e in inst.edges),
                 "cleared": sum(inst.edges[i].damaged for i in tree), "routes": len(routes),
                 "stops": sum(len(r[1]) for r in routes)}
(OUT / "results/results.json").write_text(json.dumps(R, indent=2))
print(json.dumps(R, indent=1))
