#!/usr/bin/env python3
"""
FlowSense OpenStreetMap Graph Downloader & Cache Generator.
Extracts real driving networks via OSMnx and caches them as GraphML for zero-latency backend boot.

Usage:
    python scripts/download_city_graph.py --place "Manhattan, New York, USA" --output data/processed/manhattan_graph.graphml
    python scripts/download_city_graph.py --bbox 40.7700 40.7300 -73.9700 -74.0100
"""

import argparse
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

def download_graph(place: str = None, bbox: list = None, output_path: str = "data/processed/manhattan_graph.graphml"):
    target_file = Path(output_path)
    target_file.parent.mkdir(parents=True, exist_ok=True)

    print("==========================================================")
    print(" FlowSense — OpenStreetMap Real Urban Graph Downloader    ")
    print("==========================================================")

    try:
        import osmnx as ox
        import networkx as nx
    except ImportError as e:
        print(f"[ERROR] OSMnx is required to download real road networks: {e}")
        print("Install it with: pip install osmnx")
        sys.exit(1)

    print(f"[INFO] Initializing download using OSMnx...")

    if bbox:
        north, south, east, west = bbox
        print(f"[INFO] Downloading bounding box: North={north}, South={south}, East={east}, West={west}")
        G = ox.graph_from_bbox(bbox=(north, south, east, west), network_type="drive")
    elif place:
        print(f"[INFO] Downloading place: '{place}' (drive network)...")
        G = ox.graph_from_place(place, network_type="drive")
    else:
        # Default Manhattan Pilot bounding box
        north, south, east, west = 40.7700, 40.7300, -73.9700, -74.0100
        print(f"[INFO] Using default Manhattan BBox: [{north}, {south}, {east}, {west}]")
        G = ox.graph_from_bbox(bbox=(north, south, east, west), network_type="drive")

    node_count = G.number_of_nodes()
    edge_count = G.number_of_edges()
    print(f"[SUCCESS] Downloaded road network with {node_count} nodes and {edge_count} edges.")

    # Normalize weights and attributes for FlowSense routing engine
    print("[INFO] Normalizing edge impedances and emergency weights...")
    for u, v, k, data in G.edges(keys=True, data=True):
        raw_len = data.get("length", 100.0)
        length = float(raw_len[0]) if isinstance(raw_len, (list, tuple)) else float(raw_len)
        data["length"] = length
        data["congestion_factor"] = 0.0
        data["vehicle_count"] = 0
        data["average_speed_kmh"] = 45.0
        road_type = str(data.get("highway", "secondary"))
        factor = 0.85 if ("primary" in road_type or "trunk" in road_type) else 1.0
        data["emergency_weight"] = length * factor
        for ek, ev in list(data.items()):
            if isinstance(ev, (list, tuple, set)):
                data[ek] = ",".join(str(item) for item in ev)
            elif not isinstance(ev, (str, int, float, bool)):
                data[ek] = str(ev)

    for node_id, data in G.nodes(data=True):
        for nk, nv in list(data.items()):
            if isinstance(nv, (list, tuple, set)):
                data[nk] = ",".join(str(item) for item in nv)
            elif not isinstance(nv, (str, int, float, bool)):
                data[nk] = str(nv)

    print(f"[INFO] Saving GraphML cache to: {target_file}...")
    nx.write_graphml(G, str(target_file))
    print(f"[SUCCESS] Graph cached successfully! ({target_file.stat().st_size / 1024:.1f} KB)")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Download and cache urban road graphs for FlowSense.")
    parser.add_argument("--place", type=str, default=None, help="City or district name (e.g. 'Manhattan, New York, USA')")
    parser.add_argument("--bbox", nargs=4, type=float, metavar=('NORTH', 'SOUTH', 'EAST', 'WEST'), help="Bounding box coordinates")
    parser.add_argument("--output", type=str, default="data/processed/manhattan_graph.graphml", help="Output GraphML path")

    args = parser.parse_args()
    download_graph(place=args.place, bbox=args.bbox, output_path=args.output)
