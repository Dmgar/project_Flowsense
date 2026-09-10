import math
import logging
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
        self._ensure_cache_dir()

    def _ensure_cache_dir(self):
        settings.DATA_PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    def initialize(self):
        """Initializes the graph from cache, OSMnx, or synthetic Manhattan grid."""
        cache_path = settings.GRAPH_CACHE_FILE
        if cache_path.exists():
            try:
                logger.info(f"Loading graph from local cache: {cache_path}")
                self.graph = nx.read_graphml(str(cache_path))
                # Ensure node coordinates and numeric edge attributes are float
                self._normalize_graph_attributes()
                logger.info(f"Graph loaded successfully with {self.graph.number_of_nodes()} nodes and {self.graph.number_of_edges()} edges.")
                return
            except Exception as e:
                logger.warning(f"Could not load graphml cache ({e}). Regenerating graph...")

        # Attempt to load from OSMnx
        loaded_osmnx = self._try_load_osmnx()
        if not loaded_osmnx:
            logger.info("Generating synthetic Manhattan street grid...")
            self.graph = self._build_synthetic_manhattan_grid()
            self.is_synthetic = True

        self._normalize_graph_attributes()
        self._save_cache()

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
        """Ensures all nodes and edges have valid coordinates and numeric weights."""
        if not self.graph:
            return

        for node_id, data in self.graph.nodes(data=True):
            data["x"] = float(data.get("x", -73.9850))
            data["y"] = float(data.get("y", 40.7580))

        for u, v, k, data in self.graph.edges(keys=True, data=True):
            # Ensure length is float
            length = float(data.get("length", 100.0))
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

    def find_nearest_node(self, lat: float, lon: float) -> int:
        """Finds the closest node to the specified latitude and longitude."""
        G = self.get_graph()
        best_node = None
        min_dist_sq = float("inf")

        for node, data in G.nodes(data=True):
            nx_lat = data.get("y", 0.0)
            nx_lon = data.get("x", 0.0)
            dist_sq = (nx_lat - lat) ** 2 + (nx_lon - lon) ** 2
            if dist_sq < min_dist_sq:
                min_dist_sq = dist_sq
                best_node = node

        if best_node is None:
            raise ValueError("Graph has no nodes to find nearest match.")
        return int(best_node)

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
            cache_loaded=settings.GRAPH_CACHE_FILE.exists()
        )

    def to_geojson(self) -> Dict[str, Any]:
        """
        Converts the graph edges into a GeoJSON FeatureCollection with traffic styling.
        Ready for Leaflet.js consumption.
        """
        G = self.get_graph()
        features: List[Dict[str, Any]] = []

        for u, v, k, data in G.edges(keys=True, data=True):
            u_data = G.nodes[u]
            v_data = G.nodes[v]

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
