"""Reproducible regional arterial graph, joined to the existing Downtown detail."""
import json
from pathlib import Path
import requests
import networkx as nx
import osmnx as ox

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "output/catalog/los-angeles-regional-osm.json"
OUTPUT = ROOT / "data/processed/los_angeles_regional_graph.graphml"
ENDPOINT = "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
BBOX = (-118.56, 33.70, -117.84, 34.25)


def build():
    if not RAW.exists():
        RAW.parent.mkdir(parents=True, exist_ok=True)
        query = '[out:json][timeout:90];way["highway"~"^(motorway|trunk|primary|secondary)(_link)?$"]["access"!~"private"](33.70,-118.56,34.25,-117.84);out geom;'
        response = requests.get(ENDPOINT, params={"data": query}, timeout=120,
            headers={"User-Agent": "FlowSenseOpenCV/0.1 (https://github.com/Dmgar/project_Flowsense; regional mobility prototype)"})
        response.raise_for_status()
        RAW.write_bytes(response.content)
    data = json.loads(RAW.read_text(encoding="utf-8"))
    if data.get("remark") or not data.get("elements"):
        raise ValueError("Incomplete Overpass extract; graph was not replaced.")
    graph = nx.MultiDiGraph(crs="epsg:4326", flowsense_region="Greater Los Angeles",
        flowsense_network_scope="regional arterials + Downtown local roads",
        flowsense_is_synthetic=False, flowsense_source=ENDPOINT)
    west, south, east, north = BBOX
    for way in data["elements"]:
        if way.get("type") != "way" or not way.get("geometry"):
            continue
        tags = way.get("tags", {})
        nodes = way.get("nodes", [])
        geometry = way["geometry"]
        forward = str(tags.get("oneway", "")).lower()
        one_way = forward in {"yes", "1", "true", "-1", "reverse"} or tags.get("junction") == "roundabout"
        for (u, a), (v, b) in zip(zip(nodes, geometry), zip(nodes[1:], geometry[1:])):
            if u == v or not all(west <= p["lon"] <= east and south <= p["lat"] <= north for p in [a, b]):
                continue
            graph.add_node(u, x=a["lon"], y=a["lat"])
            graph.add_node(v, x=b["lon"], y=b["lat"])
            attrs = {"osmid": way["id"], "highway": tags.get("highway", "primary"),
                     "name": tags.get("name", "Unknown"), "oneway": one_way}
            if forward in {"-1", "reverse"}:
                graph.add_edge(v, u, **attrs)
            else:
                graph.add_edge(u, v, **attrs)
                if not one_way:
                    graph.add_edge(v, u, **attrs)
    print(f"Raw arterial graph: {len(graph)} nodes", flush=True)
    graph = ox.distance.add_edge_lengths(graph)
    graph = ox.simplification.simplify_graph(graph)
    local_path = ROOT / "data/processed/los_angeles_graph.graphml"
    if local_path.exists():
        local = nx.read_graphml(local_path, node_type=int, force_multigraph=True)
        graph = nx.compose(local, graph)
    graph = graph.subgraph(max(nx.weakly_connected_components(graph), key=len)).copy()
    for _, _, _, attrs in graph.edges(keys=True, data=True):
        length = float(attrs.get("length", 100))
        attrs.update(length=length, congestion_factor=0.0, vehicle_count=0, average_speed_kmh=45.0,
            incident_multiplier=1.0, corridor_multiplier=1.0, emergency_weight=round(length, 3))
        for key, value in list(attrs.items()):
            if isinstance(value, (list, tuple, set)):
                attrs[key] = ",".join(str(item) for item in value)
            elif not isinstance(value, (str, int, float, bool)):
                attrs[key] = str(value)
    for _, attrs in graph.nodes(data=True):
        for key, value in list(attrs.items()):
            if not isinstance(value, (str, int, float, bool)):
                attrs[key] = str(value)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_suffix(".pending.graphml")
    nx.write_graphml(graph, temporary)
    temporary.replace(OUTPUT)
    print(json.dumps({"nodes": len(graph), "edges": graph.number_of_edges(), "size_mb": OUTPUT.stat().st_size / 1e6}), flush=True)


if __name__ == "__main__":
    build()
