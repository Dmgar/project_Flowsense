import math
import json
import logging
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Optional, Tuple, Dict, Any, List
import networkx as nx

from src.core.config import settings
from src.models.schemas import GraphStatus

logger = logging.getLogger("flowsense.graph")

class GraphService:
    """
    Manages the urban street network graph for FlowSense.
    Supports OSMnx real-world extracts, local GraphML caching, and synthetic Manhattan grid fallback.
    """
    def __init__(self):
        self.graph: Optional[nx.MultiDiGraph] = None
        self.is_synthetic: bool = False
        self.active_incidents: Dict[str, Dict[str, Any]] = {}
        self._ensure_cache_dir()

    def _ensure_cache_dir(self):
        settings.DATA_PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    def initialize(self):
        """Initializes the graph from cache, OSMnx, or synthetic Manhattan grid."""
        cache_path = settings.GRAPH_CACHE_FILE
        if cache_path.exists() and cache_path.stat().st_size > 0:
            try:
                logger.info(f"Loading graph from local cache: {cache_path}")
                try:
                    self.graph = nx.read_graphml(str(cache_path), node_type=int, force_multigraph=True)
                except Exception:
                    self.graph = nx.read_graphml(str(cache_path), force_multigraph=True)
                # Ensure node coordinates and numeric edge attributes are float, and node keys are int
                graph_marker = self.graph.graph.get("flowsense_is_synthetic")
                self.is_synthetic = str(graph_marker).lower() == "true" or (
                    graph_marker is None and self.graph.number_of_nodes() < 200
                )
                self._normalize_graph_attributes()
                if self.is_synthetic and self._load_cached_osm_graph():
                    self._normalize_graph_attributes()
                    self._save_cache()
                    logger.info("Replaced the synthetic graph with real streets from the local OSM cache.")
                    return
                logger.info(f"Graph loaded successfully with {self.graph.number_of_nodes()} nodes and {self.graph.number_of_edges()} edges.")
                return
            except Exception as e:
                logger.warning(f"Could not load graphml cache ({e}). Regenerating graph...")

        # Attempt to load from OSMnx
        loaded_osmnx = self._try_load_osmnx()
        if not loaded_osmnx:
            loaded_osmnx = self._load_cached_osm_graph()
        if not loaded_osmnx:
            logger.warning("No local OSM road graph is available; generating a limited demo grid.")
            self.graph = self._build_synthetic_manhattan_grid()
            self.is_synthetic = True

        self._normalize_graph_attributes()
        self._save_cache()

    def _load_cached_osm_graph(self) -> bool:
        """Build a drivable graph from a cached Overpass JSON response, if available."""
        try:
            import osmnx as ox  # type: ignore
        except ImportError:
            return False

        cache_dir = Path(ox.settings.cache_folder)
        if not cache_dir.is_absolute():
            cache_dir = Path.cwd() / cache_dir
        if not cache_dir.is_dir():
            return False

        drivable = {
            "motorway", "trunk", "primary", "secondary", "tertiary", "unclassified",
            "residential", "living_street", "service", "road", "track",
            "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
        }
        # Prefer cached extracts covering the city center; a whole-island
        # bbox center falls north of many useful Manhattan extracts.
        center_lat = 40.75
        center_lon = -73.985
        candidates = []

        for response_path in cache_dir.glob("*.json"):
            try:
                payload = json.loads(response_path.read_text(encoding="utf-8"))
                elements = payload.get("elements", [])
                nodes = [item for item in elements if item.get("type") == "node" and "lat" in item and "lon" in item]
                ways = [
                    item for item in elements
                    if item.get("type") == "way"
                    and item.get("tags", {}).get("highway") in drivable
                    and all(item.get("tags", {}).get(key) not in {"no", "private"} for key in ("access", "vehicle", "motor_vehicle", "motorcar"))
                ]
                if len(nodes) < 100 or len(ways) < 100:
                    continue
                south = min(float(node["lat"]) for node in nodes)
                north = max(float(node["lat"]) for node in nodes)
                west = min(float(node["lon"]) for node in nodes)
                east = max(float(node["lon"]) for node in nodes)
                covers_center = south <= center_lat <= north and west <= center_lon <= east
                if covers_center:
                    candidates.append((len(ways), response_path, nodes, ways))
            except (OSError, ValueError, TypeError, KeyError):
                continue

        if not candidates:
            return False

        _, source_path, nodes, ways = max(candidates, key=lambda candidate: candidate[0])
        needed_nodes = {int(ref) for way in ways for ref in way.get("nodes", [])}
        root = ET.Element("osm", version="0.6", generator="FlowSense cached OSM roads")
        for item in nodes:
            if int(item["id"]) not in needed_nodes:
                continue
            element = ET.SubElement(root, "node", id=str(item["id"]), lat=str(item["lat"]), lon=str(item["lon"]), version="1")
            for key, value in item.get("tags", {}).items():
                ET.SubElement(element, "tag", k=str(key), v=str(value))
        for item in ways:
            element = ET.SubElement(root, "way", id=str(item["id"]), version="1")
            for ref in item.get("nodes", []):
                ET.SubElement(element, "nd", ref=str(ref))
            for key, value in item.get("tags", {}).items():
                ET.SubElement(element, "tag", k=str(key), v=str(value))

        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                osm_path = Path(temp_dir) / "cached-manhattan.osm"
                ET.ElementTree(root).write(osm_path, encoding="utf-8", xml_declaration=True)
                self.graph = ox.graph_from_xml(osm_path, simplify=True, retain_all=False)
            self.is_synthetic = False
            logger.info(
                "Loaded %d OSM streets and %d junctions from cached response %s.",
                self.graph.number_of_edges(), self.graph.number_of_nodes(), source_path.name,
            )
            return True
        except Exception as error:
            logger.warning("Could not build a road graph from cached OSM response: %s", error)
            self.graph = None
            return False

    def _try_load_osmnx(self) -> bool:
        try:
            import osmnx as ox  # type: ignore
            logger.info(f"Fetching {settings.PILOT_CITY} road network via OSMnx...")
            # Apply tight network timeouts so the dashboard never hangs on an OSM fetch.
            try:
                ox.settings.requests_timeout = 8
                # Manhattan (~59 km2) fits well below the default max query area,
                # but keep a generous cap to avoid sub-query subdivision.
                ox.settings.max_query_area_size = 100_000 * 100_000
            except Exception:  # pragma: no cover
                pass
            # Bounding box for Manhattan: (west, south, east, north) in lon/lat order.
            G = ox.graph_from_bbox(
                bbox=(
                    settings.PILOT_BBOX_WEST,
                    settings.PILOT_BBOX_SOUTH,
                    settings.PILOT_BBOX_EAST,
                    settings.PILOT_BBOX_NORTH
                ),
                network_type="drive"
            )
            self.graph = G
            self.is_synthetic = False
            return True
        except Exception as e:
            logger.warning(f"OSMnx fetch bypassed or unavailable ({e}). Using robust Manhattan grid.")
            return False

    def _build_synthetic_manhattan_grid(self) -> nx.MultiDiGraph:
        """
        Builds a realistic Manhattan-style road network.
        Grid of numbered Avenues (North-South) and numbered Streets (East-West).
        Includes realistic coordinates, lengths, names, and one-way/two-way properties.
        """
        G = nx.MultiDiGraph()
        
        # Latitude range: 40.7480 to 40.7620 (approx 34th St to 54th St)
        # Longitude range: -73.9950 to -73.9750 (approx 9th Ave to Park Ave)
        streets = [f"W {st}th St" for st in range(34, 55, 2)]  # 11 streets
        avenues = ["9th Ave", "8th Ave", "7th Ave", "6th Ave (Ave of the Americas)", "5th Ave", "Madison Ave", "Park Ave"] # 7 avenues

        lat_start, lat_step = 40.7480, 0.0014   # ~155 meters per cross street
        lon_start, lon_step = -73.9950, 0.0033  # ~280 meters between avenues

        node_lookup: Dict[Tuple[int, int], int] = {}
        node_id_counter = 1000

        # Add Nodes
        for i, street in enumerate(streets):
            lat = lat_start + i * lat_step
            for j, avenue in enumerate(avenues):
                lon = lon_start + j * lon_step
                node_id = node_id_counter
                node_lookup[(i, j)] = node_id
                G.add_node(
                    node_id,
                    x=float(lon),
                    y=float(lat),
                    street=street,
                    avenue=avenue,
                    name=f"{street} & {avenue}"
                )
                node_id_counter += 1

        # Add Edges
        for i, street in enumerate(streets):
            for j, avenue in enumerate(avenues):
                curr_node = node_lookup[(i, j)]

                # East-West connections along Streets
                # Even streets generally eastbound, odd westbound in Manhattan; we add bidirectional with primary lanes
                if j < len(avenues) - 1:
                    east_node = node_lookup[(i, j + 1)]
                    dist_ew = 280.0
                    
                    # Eastbound edge
                    G.add_edge(
                        curr_node, east_node, 0,
                        name=street,
                        length=dist_ew,
                        highway="secondary",
                        lanes=2,
                        maxspeed=40.0,
                        congestion_factor=0.0,
                        vehicle_count=0,
                        average_speed_kmh=40.0,
                        emergency_weight=dist_ew
                    )
                    # Westbound edge
                    G.add_edge(
                        east_node, curr_node, 0,
                        name=street,
                        length=dist_ew,
                        highway="secondary",
                        lanes=2,
                        maxspeed=40.0,
                        congestion_factor=0.0,
                        vehicle_count=0,
                        average_speed_kmh=40.0,
                        emergency_weight=dist_ew
                    )

                # North-South connections along Avenues (Primary arteries)
                if i < len(streets) - 1:
                    north_node = node_lookup[(i + 1, j)]
                    dist_ns = 155.0
                    
                    # Northbound
                    G.add_edge(
                        curr_node, north_node, 0,
                        name=avenue,
                        length=dist_ns,
                        highway="primary",
                        lanes=4,
                        maxspeed=50.0,
                        congestion_factor=0.0,
                        vehicle_count=0,
                        average_speed_kmh=50.0,
                        emergency_weight=dist_ns
                    )
                    # Southbound
                    G.add_edge(
                        north_node, curr_node, 0,
                        name=avenue,
                        length=dist_ns,
                        highway="primary",
                        lanes=4,
                        maxspeed=50.0,
                        congestion_factor=0.0,
                        vehicle_count=0,
                        average_speed_kmh=50.0,
                        emergency_weight=dist_ns
                    )

        # Add a major diagonal artery representing Broadway
        # Crossing from (i=0, j=1) 8th Ave towards (i=10, j=4) 5th Ave
        broadway_nodes = [
            node_lookup[(0, 1)],
            node_lookup[(2, 2)],
            node_lookup[(4, 2)],
            node_lookup[(6, 3)],
            node_lookup[(8, 3)],
            node_lookup[(10, 4)]
        ]
        for b_idx in range(len(broadway_nodes) - 1):
            n1 = broadway_nodes[b_idx]
            n2 = broadway_nodes[b_idx + 1]
            dist_bw = 320.0
            G.add_edge(
                n1, n2, 0,
                name="Broadway",
                length=dist_bw,
                highway="primary",
                lanes=3,
                maxspeed=45.0,
                congestion_factor=0.0,
                vehicle_count=0,
                average_speed_kmh=45.0,
                emergency_weight=dist_bw
            )
            G.add_edge(
                n2, n1, 0,
                name="Broadway",
                length=dist_bw,
                highway="primary",
                lanes=3,
                maxspeed=45.0,
                congestion_factor=0.0,
                vehicle_count=0,
                average_speed_kmh=45.0,
                emergency_weight=dist_bw
            )

        return G

    def _normalize_graph_attributes(self):
        """Ensures all nodes and edges have valid coordinates and numeric weights, and integer node IDs."""
        if not self.graph:
            return

        if not isinstance(self.graph, nx.MultiDiGraph):
            self.graph = nx.MultiDiGraph(self.graph)
        self.graph.graph["flowsense_is_synthetic"] = self.is_synthetic

        # Relabel any string-encoded integer node IDs to int
        relabel_map = {}
        for n in self.graph.nodes():
            if isinstance(n, str) and (n.isdigit() or (n.startswith('-') and n[1:].isdigit())):
                relabel_map[n] = int(n)
        if relabel_map:
            self.graph = nx.relabel_nodes(self.graph, relabel_map)

        for node_id, data in self.graph.nodes(data=True):
            data["x"] = float(data.get("x", -73.9850))
            data["y"] = float(data.get("y", 40.7580))
            # Sanitize node attributes for GraphML serialization
            for k, v in list(data.items()):
                if isinstance(v, (list, tuple, set)):
                    data[k] = ",".join(str(item) for item in v)
                elif not isinstance(v, (str, int, float, bool)):
                    data[k] = str(v)

        for u, v, k, data in self.graph.edges(keys=True, data=True):
            # Ensure length is float
            raw_len = data.get("length", 100.0)
            if isinstance(raw_len, (list, tuple)):
                length = float(raw_len[0])
            else:
                length = float(raw_len)
            data["length"] = length
            
            # Ensure congestion factor
            congestion = float(data.get("congestion_factor", 0.0))
            data["congestion_factor"] = congestion

            # Ensure vehicle count
            data["vehicle_count"] = int(data.get("vehicle_count", 0))
            
            # Calculate emergency weight
            road_type = str(data.get("highway", "secondary"))
            # Primary avenues are wider and easier to clear for emergency vehicles
            road_class_factor = 0.85 if "primary" in road_type or "trunk" in road_type else 1.0
            
            # W_e = length * (1 + alpha * congestion) * road_class_factor
            emergency_weight = length * (1.0 + settings.CONGESTION_ALPHA * congestion) * road_class_factor
            data["emergency_weight"] = emergency_weight

            # Sanitize edge attributes for GraphML serialization
            for ek, ev in list(data.items()):
                if isinstance(ev, (list, tuple, set)):
                    data[ek] = ",".join(str(item) for item in ev)
                elif not isinstance(ev, (str, int, float, bool)):
                    data[ek] = str(ev)

    def _save_cache(self):
        if self.graph:
            try:
                nx.write_graphml(self.graph, str(settings.GRAPH_CACHE_FILE))
                logger.info(f"Graph cached to {settings.GRAPH_CACHE_FILE}")
            except Exception as e:
                logger.warning(f"Could not cache graph to file: {e}")

    def get_graph(self) -> nx.MultiDiGraph:
        if self.graph is None:
            self.initialize()
        return self.graph

    def find_nearest_node(self, lat: float, lon: float, max_distance_m: float | None = None) -> int:
        """Finds the closest node to the specified latitude and longitude."""
        G = self.get_graph()
        best_node = None
        min_dist_m = float("inf")
        cos_lat = math.cos(math.radians(lat))

        for node, data in G.nodes(data=True):
            nx_lat = data.get("y", 0.0)
            nx_lon = data.get("x", 0.0)
            d_lat_m = (nx_lat - lat) * 111139.0
            d_lon_m = (nx_lon - lon) * 111139.0 * cos_lat
            dist_m = math.hypot(d_lat_m, d_lon_m)
            if dist_m < min_dist_m:
                min_dist_m = dist_m
                best_node = node

        if best_node is None:
            raise ValueError("Graph has no nodes to find nearest match.")
        if max_distance_m is not None and min_dist_m > max_distance_m:
            raise ValueError("The selected point is outside the available street network.")
        return int(best_node)

    def find_nodes_in_radius(self, lat: float, lon: float, radius_m: float) -> List[int]:
        """Finds all nodes within a given radius (meters) using Haversine approximation."""
        G = self.get_graph()
        nodes: List[int] = []
        cos_lat = math.cos(math.radians(lat))

        for node, data in G.nodes(data=True):
            nx_lat = data.get("y", 0.0)
            nx_lon = data.get("x", 0.0)
            d_lat_m = (nx_lat - lat) * 111139.0
            d_lon_m = (nx_lon - lon) * 111139.0 * cos_lat
            dist_m = math.hypot(d_lat_m, d_lon_m)
            if dist_m <= radius_m:
                nodes.append(int(node))

        # Fallback to closest node if none inside radius
        if not nodes:
            nodes.append(self.find_nearest_node(lat, lon))
        return nodes

    def report_incident(
        self,
        incident_id: str,
        lat: float,
        lon: float,
        radius_m: float = 180.0,
        block_traffic: bool = True
    ) -> Tuple[List[int], int]:
        """
        Injects a localized accident or blockage on street edges near coordinates.
        Returns (affected_node_ids, count_of_affected_edges).
        """
        G = self.get_graph()
        affected_nodes = self.find_nodes_in_radius(lat, lon, radius_m)
        affected_nodes_set = set(affected_nodes)
        incident_backup: List[Dict[str, Any]] = []

        cg = 1.0 if block_traffic else 0.85
        multiplier = 20.0 if block_traffic else 4.0
        affected_edges_count = 0

        for u, v, k, data in G.edges(keys=True, data=True):
            if u in affected_nodes_set or v in affected_nodes_set:
                incident_backup.append({
                    "u": u, "v": v, "key": k,
                    "congestion_factor": data.get("congestion_factor", 0.0),
                    "vehicle_count": data.get("vehicle_count", 0),
                    "average_speed_kmh": data.get("average_speed_kmh", 50.0),
                    "emergency_weight": data.get("emergency_weight", 100.0)
                })
                length = float(data.get("length", 100.0))
                data["congestion_factor"] = cg
                data["vehicle_count"] = 55 if block_traffic else 35
                data["average_speed_kmh"] = 3.0 if block_traffic else 12.0
                data["emergency_weight"] = length * multiplier
                affected_edges_count += 1

        self.active_incidents[incident_id] = {
            "lat": lat,
            "lon": lon,
            "radius_m": radius_m,
            "affected_nodes": affected_nodes,
            "edges_backup": incident_backup
        }

        return affected_nodes, affected_edges_count

    def clear_incident(self, incident_id: str) -> bool:
        """Restores road edges affected by an incident to their prior state."""
        if incident_id not in self.active_incidents:
            return False

        G = self.get_graph()
        incident_data = self.active_incidents.pop(incident_id)
        for b in incident_data.get("edges_backup", []):
            u, v, k = b["u"], b["v"], b["key"]
            if G.has_edge(u, v, k):
                edge = G[u][v][k]
                edge["congestion_factor"] = b["congestion_factor"]
                edge["vehicle_count"] = b["vehicle_count"]
                edge["average_speed_kmh"] = b["average_speed_kmh"]
                edge["emergency_weight"] = b["emergency_weight"]

        return True

    def update_edge_congestion(
        self,
        u: int,
        v: int,
        key: int = 0,
        congestion_factor: float = 0.0,
        vehicle_count: int = 0,
        average_speed_kmh: float = 30.0
    ) -> bool:
        """
        Updates the congestion metrics of an edge and dynamically recomputes W_e.
        """
        G = self.get_graph()
        # Edge could be int or str node ID depending on graphml serialization
        # Check both int and str representations
        target_u, target_v = u, v
        if not G.has_edge(target_u, target_v, key):
            target_u, target_v = str(u), str(v)
            if not G.has_edge(target_u, target_v, key):
                return False

        edge_data = G[target_u][target_v][key]
        clamped_congestion = max(0.0, min(1.0, float(congestion_factor)))
        edge_data["congestion_factor"] = clamped_congestion
        edge_data["vehicle_count"] = vehicle_count
        edge_data["average_speed_kmh"] = average_speed_kmh

        # Recalculate W_e
        length = float(edge_data.get("length", 100.0))
        road_type = str(edge_data.get("highway", "secondary"))
        road_class_factor = 0.85 if "primary" in road_type or "trunk" in road_type else 1.0

        emergency_weight = length * (1.0 + settings.CONGESTION_ALPHA * clamped_congestion) * road_class_factor
        edge_data["emergency_weight"] = emergency_weight

        return True

    def reset_all_congestion(self) -> int:
        """Resets congestion on every edge to free flow. Returns number of edges reset."""
        G = self.get_graph()
        count = 0
        for _, _, _, data in G.edges(keys=True, data=True):
            data["congestion_factor"] = 0.0
            data["vehicle_count"] = 0
            data["average_speed_kmh"] = settings.DEFAULT_SPEED_KMH
            length = float(data.get("length", 100.0))
            road_class = data.get("highway", "secondary")
            factor = 0.85 if road_class in ("primary", "secondary") else 1.0
            data["emergency_weight"] = length * factor
            count += 1
        return count

    def get_status(self) -> GraphStatus:
        G = self.get_graph()
        congested_count = 0
        total_congestion = 0.0
        edge_count = G.number_of_edges()

        for _, _, _, data in G.edges(keys=True, data=True):
            cg = float(data.get("congestion_factor", 0.0))
            if cg > 0.4:
                congested_count += 1
            total_congestion += cg

        avg_cg = (total_congestion / edge_count) if edge_count > 0 else 0.0

        return GraphStatus(
            city=settings.PILOT_CITY,
            node_count=G.number_of_nodes(),
            edge_count=edge_count,
            congested_edges_count=congested_count,
            avg_congestion_factor=round(avg_cg, 3),
            cache_loaded=settings.GRAPH_CACHE_FILE.exists() and settings.GRAPH_CACHE_FILE.stat().st_size > 0,
            is_synthetic=self.is_synthetic,
        )

    def to_geojson(self) -> Dict[str, Any]:
        """
        Converts the graph edges into a GeoJSON FeatureCollection with traffic styling.
        Ready for Leaflet.js consumption.
        """
        G = self.get_graph()
        features: List[Dict[str, Any]] = []

        for u, v, k, data in G.edges(keys=True, data=True):
            u_data = G.nodes.get(u) or G.nodes.get(str(u), {})
            v_data = G.nodes.get(v) or G.nodes.get(str(v), {})

            coords = [
                [float(u_data.get("x", 0.0)), float(u_data.get("y", 0.0))],
                [float(v_data.get("x", 0.0)), float(v_data.get("y", 0.0))]
            ]

            cg = float(data.get("congestion_factor", 0.0))
            # Determine color: green (free), amber (medium), red (severe)
            if cg < 0.35:
                color = "#10B981"  # Emerald Green
            elif cg < 0.70:
                color = "#F59E0B"  # Amber
            else:
                color = "#EF4444"  # Red

            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": coords
                },
                "properties": {
                    "u": u,
                    "v": v,
                    "key": k,
                    "name": data.get("name", "Unknown"),
                    "highway": data.get("highway", "secondary"),
                    "length": round(float(data.get("length", 0.0)), 1),
                    "length_m": round(float(data.get("length", 0.0)), 1),
                    "congestion_factor": round(cg, 2),
                    "vehicle_count": int(data.get("vehicle_count", 0)),
                    "average_speed_kmh": round(float(data.get("average_speed_kmh", settings.DEFAULT_SPEED_KMH)), 1),
                    "color": color,
                    "emergency_weight": round(float(data.get("emergency_weight", 0.0)), 1)
                }
            })

        return {
            "type": "FeatureCollection",
            "features": features
        }

# Global singleton instance for the service
graph_service = GraphService()
