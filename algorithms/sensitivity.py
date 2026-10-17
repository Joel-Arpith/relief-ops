"""Sensitivity of on-time critical service to supply and fleet size (10 disasters per cell).
   PYTHONPATH=<dir with matplotlib> python3 sensitivity.py"""
import json, statistics as st
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from logistics.graph import make_instance
from logistics.plan import evaluate, plan, total_need

plt.rcParams.update({"font.family": "serif", "font.size": 9, "axes.spines.top": False, "axes.spines.right": False})
res = {"supply": [], "vehicles": []}
for ratio in [0.5, 0.7, 0.9, 1.1]:
    row = {"x": ratio}
    for key, pol, rt in [("proposed", "priority", "dp"), ("fcfs", "fcfs", "nn")]:
        vals = []
        for seed in range(10):
            inst = make_instance(n=150, n_demand=40, supply_ratio=ratio, seed=500 + seed)
            _, need_c = total_need(inst)
            cl, routes = plan(inst, policy=pol, router=rt)
            vals.append(100 * evaluate(inst, cl, routes)[1] / need_c)
        row[key] = st.mean(vals)
    res["supply"].append(row)
for veh in [1, 2, 3, 4, 5]:
    row = {"x": veh}
    for key, pol, rt in [("proposed", "priority", "dp"), ("fcfs", "fcfs", "nn")]:
        vals = []
        for seed in range(10):
            inst = make_instance(n=150, n_demand=40, vehicles_per_depot=veh, seed=500 + seed)
            _, need_c = total_need(inst)
            cl, routes = plan(inst, policy=pol, router=rt)
            vals.append(100 * evaluate(inst, cl, routes)[1] / need_c)
        row[key] = st.mean(vals)
    res["vehicles"].append(row)
Path("results/sensitivity.json").write_text(json.dumps(res, indent=1))
fig, axs = plt.subplots(1, 2, figsize=(3.4, 1.9), sharey=True)
for ax, k, lab in [(axs[0], "supply", "supply / demand"), (axs[1], "vehicles", "vehicles per depot")]:
    ax.plot([r["x"] for r in res[k]], [r["proposed"] for r in res[k]], "o-", label="proposed")
    ax.plot([r["x"] for r in res[k]], [r["fcfs"] for r in res[k]], "s--", label="FCFS")
    ax.set_xlabel(lab, fontsize=8)
axs[0].set_ylabel("critical served (%)", fontsize=8); axs[0].legend(fontsize=7, frameon=False); axs[0].set_ylim(0, 100)
fig.tight_layout(); fig.savefig("figures/fig_sensitivity.png", dpi=220)
print(json.dumps(res))
