"""OSM (Overpass JSON) -> compact road graph for the browser.

Intersections become graph nodes; the shape points between them are kept as edge geometry.
Output: public/graph.json = {nodes: [[lon,lat]...], edges: [[u, v, minutes*10, kind, [lon,lat,...]]...]}
Run:  python3 scripts/build_graph.py scripts/osm_raw.json public/graph.json
"""
import json, math, sys
from collections import Counter

# post-disaster speeds (km/h): the report assumes 25 km/h average through debris and checkpoints
SPEED = {"motorway": 50, "trunk": 35, "primary": 30, "secondary": 25, "tertiary": 20}
KIND = {"motorway": 0, "trunk": 1, "primary": 2, "secondary": 3, "tertiary": 4}

src, out = sys.argv[1], sys.argv[2]
els = json.load(open(src))["elements"]
pt = {e["id"]: (e["lon"], e["lat"]) for e in els if e["type"] == "node"}
ways = [e for e in els if e["type"] == "way"]

use = Counter()
for w in ways:
    for i, n in enumerate(w["nodes"]):
        use[n] += 2 if i in (0, len(w["nodes"]) - 1) else 1
is_node = lambda n: use[n] >= 2

def km(a, b):
    (x1, y1), (x2, y2) = pt[a], pt[b]
    dx = (x2 - x1) * 111.32 * math.cos(math.radians((y1 + y2) / 2))
    return math.hypot(dx, (y2 - y1) * 110.57)

raw = {}  # (u, v) -> (minutes, kind, interior osm ids); keep the faster duplicate
for w in ways:
    hw = w["tags"]["highway"].replace("_link", "")
    ns = [n for n in w["nodes"] if n in pt]
    start, length, mid = ns[0], 0.0, []
    for a, b in zip(ns, ns[1:]):
        length += km(a, b)
        if is_node(b) or b == ns[-1]:
            if start != b:
                key = (min(start, b), max(start, b))
                mins = length / SPEED[hw] * 60
                if key not in raw or raw[key][0] > mins:
                    raw[key] = (mins, KIND[hw], mid if start < b else mid[::-1])
            start, length, mid = b, 0.0, []
        else:
            mid.append(b)

# keep the largest connected component
adj = {}
for u, v in raw:
    adj.setdefault(u, []).append(v); adj.setdefault(v, []).append(u)
seen, best = set(), []
for s in adj:
    if s in seen: continue
    comp, stack = [], [s]; seen.add(s)
    while stack:
        x = stack.pop(); comp.append(x)
        for y in adj[x]:
            if y not in seen: seen.add(y); stack.append(y)
    if len(comp) > len(best): best = comp
keep = set(best)
idx = {n: i for i, n in enumerate(sorted(keep))}
r5 = lambda x: round(x, 5)
nodes = [[r5(pt[n][0]), r5(pt[n][1])] for n in sorted(keep)]
edges = []
for (u, v), (mins, kind, mid) in raw.items():
    if u in keep:
        flat = [c for n in mid for c in (r5(pt[n][0]), r5(pt[n][1]))]
        edges.append([idx[u], idx[v], max(1, round(mins * 10)), kind, flat])
json.dump({"nodes": nodes, "edges": edges}, open(out, "w"), separators=(",", ":"))
print(f"{len(nodes)} nodes, {len(edges)} edges")
