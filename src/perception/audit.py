"""Helpers for interpreting live detection audit evidence."""


def direction_audit_counts(detections):
    """Separate unconfirmed motion from a confirmed wrong-way track.

    A track marked ``checking`` has not yet accumulated enough motion to assign
    a direction. It must remain visible to the operator, but it is not evidence
    of a wrong-way classification.
    """
    counts = {"approaching": 0, "checking": 0, "wrong_direction": 0}
    for detection in detections:
        direction = detection.get("direction")
        status = detection.get("direction_status")
        if direction == "checking" or status == "checking":
            counts["checking"] += 1
        elif direction == "approaching" and status in {None, "confirmed"}:
            counts["approaching"] += 1
        else:
            counts["wrong_direction"] += 1
    return counts
