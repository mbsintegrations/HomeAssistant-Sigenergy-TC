"""Plant-bound startup observations; never restore permissions or control state."""

from datetime import datetime
from hashlib import sha256

from .energy import DAILY_COUNTERS, energy_number


def plant_identity(options):
    cloud = options.get("cloud", {})
    station = cloud.get("station_id")
    region = cloud.get("region")
    return sha256(f"{region}:{station}".encode()).hexdigest() if station and region else None


def fresh(stamp, now):
    try:
        clock = datetime.fromisoformat(stamp)
        return clock.tzinfo is not None and -5 <= (now - clock).total_seconds() <= 1800
    except (ValueError, TypeError):
        return False


def daily_observations(daily, now):
    if not isinstance(daily, dict) or not isinstance(daily.get("values", {}), dict):
        return {}
    stamp = daily.get("observed_at")
    if not fresh(stamp, now) or datetime.fromisoformat(stamp).astimezone(now.tzinfo).date() != now.date():
        return {}
    values = {key: value for key, value in daily.get("values", {}).items()
              if (key in DAILY_COUNTERS or key == "home_today") and energy_number(value)}
    return {"values": values, "observed_at": stamp} if values else {}


def cache_payload(identity, cloud, daily, now):
    if not identity:
        return {}
    inventory = []
    rows = cloud.get("device_inventory", [])
    for row in (rows if isinstance(rows, list) else [])[:128]:
        if not isinstance(row, dict) or not isinstance(row.get("installed"), bool):
            continue
        item = {"installed": row["installed"]}
        for key in ("id", "serial", "model", "type"):
            if isinstance(row.get(key), str) and 0 < len(row[key]) <= 120:
                item[key] = row[key]
        if item.get("type"):
            inventory.append(item)
    result = {"plant_identity": identity, "device_inventory": inventory}
    mode, stamp = cloud.get("mode"), cloud.get("mode_observed_at", cloud.get("updated_at"))
    if isinstance(mode, str) and 0 < len(mode) <= 120 and fresh(stamp, now):
        result.update(mode=mode, mode_observed_at=stamp)
    result["daily"] = daily_observations(daily, now)
    return result


def restore_cache(saved, identity, now):
    if not identity or not isinstance(saved, dict) or saved.get("plant_identity") != identity:
        return {}, {}
    cleaned = cache_payload(identity, saved, saved.get("daily", {}), now)
    cloud = {key: cleaned[key] for key in ("device_inventory", "mode", "mode_observed_at") if key in cleaned}
    return cloud, cleaned.get("daily", {})
