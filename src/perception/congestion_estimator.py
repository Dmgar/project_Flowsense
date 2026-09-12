"""
Congestion Estimator for the FlowSense Perception Engine.

Converts raw tracked-vehicle data (count + speed) into a normalised
``CongestionMetrics`` payload ready for injection into the
``camera_service.ingest_telemetry()`` endpoint.

The congestion factor formula follows the README specification:

    CF = clamp( (density / max_density) * (1 − v_avg / v_freeflow) , 0, 1 )

This combines *occupancy pressure* (how many vehicles relative to capacity)
with *speed degradation* (how much slower traffic moves compared to
free-flow conditions).  The two factors are multiplied so that a sparse
but slow-moving segment (e.g. a red light) still registers medium
congestion, while a dense but fast-moving highway stays low.
"""
import logging
from typing import List

from src.perception.models import CongestionMetrics, TrackedVehicle

logger = logging.getLogger("flowsense.perception.congestion")


class CongestionEstimator:
    """
    Estimates per-segment congestion from tracked vehicle data.

    Parameters
    ----------
    max_density : int
        Vehicle count at which the segment is considered fully saturated.
    free_flow_speed : float
        Expected speed (km/h) under zero-congestion conditions.
    """

    def __init__(self, max_density: int = 50, free_flow_speed: float = 45.0):
        if max_density <= 0:
            raise ValueError("max_density must be positive")
        if free_flow_speed <= 0:
            raise ValueError("free_flow_speed must be positive")

        self.max_density = max_density
        self.free_flow_speed = free_flow_speed

    def estimate(
        self,
        tracked_vehicles: List[TrackedVehicle],
        roi_area_m2: float = 10_000.0,
        avg_speed_override: float | None = None,
    ) -> CongestionMetrics:
        """
        Compute congestion metrics from the current set of tracked vehicles.

        Parameters
        ----------
        tracked_vehicles : List[TrackedVehicle]
            Active tracked vehicles in the camera's region of interest.
        roi_area_m2 : float
            Approximate area (m²) of the camera's visible road segment.
            Used for density-per-km² calculation.  Defaults to a typical
            single-intersection view (~100 m × 100 m).
        avg_speed_override : float | None
            If provided, overrides the per-vehicle speed average (useful
            when optical flow provides a better aggregate estimate).

        Returns
        -------
        CongestionMetrics
            Ready to be serialised into a ``CameraTelemetryReport``.
        """
        vehicle_count = len(tracked_vehicles)

        # Average speed across active tracks
        if avg_speed_override is not None:
            avg_speed = avg_speed_override
        elif vehicle_count > 0:
            speeds = [
                v.estimated_speed_kmh
                for v in tracked_vehicles
                if v.frames_since_seen == 0
            ]
            avg_speed = sum(speeds) / len(speeds) if speeds else 0.0
        else:
            avg_speed = self.free_flow_speed  # no vehicles ⇒ free-flow

        # Density ratio  (capped at 1.0)
        density_ratio = min(vehicle_count / self.max_density, 1.0)

        # Speed degradation ratio
        speed_ratio = max(0.0, 1.0 - (avg_speed / self.free_flow_speed))

        # Congestion factor: combined occupancy × slowness
        congestion_factor = max(0.0, min(1.0, density_ratio * speed_ratio))

        # Vehicles per km²
        density_per_km2 = (vehicle_count / roi_area_m2) * 1_000_000 if roi_area_m2 > 0 else 0.0

        return CongestionMetrics(
            vehicle_count=vehicle_count,
            average_speed_kmh=round(avg_speed, 1),
            congestion_factor=round(congestion_factor, 3),
            density_vehicles_per_km2=round(density_per_km2, 1),
        )
