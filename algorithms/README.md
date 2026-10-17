# Disaster Response Logistics — Multi-Depot Routing & Resource Allocation

DAA PBL, Group 16 (Bulla Joel Arpith 3011, Joe Daniel 3019, Macha Saikamal 3026, Jayanth 3021).

Pipeline, all algorithms from scratch in the Python standard library:

1. **Kruskal MST** (union–find) on road-clearing effort → minimum-effort backbone that reconnects the network
2. **Dijkstra** (binary heap) from each depot over passable roads → travel-time matrix
3. **Greedy prioritisation** (critical first, earliest deadline) → multi-commodity, multi-depot allocation
4. **0/1 knapsack DP** → which parcels each vehicle carries
5. **Subset DP (Held–Karp with deadlines)** → which stops each vehicle visits, and in what order
6. **Robust policy**: plan on 90th-percentile travel times, evaluate on 500 random scenarios

```bash
python3 test_logistics.py        # 6 checks, incl. DP vs brute force
python3 experiments.py           # needs matplotlib; writes results/results.json and figures/
```
