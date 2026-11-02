"""Read-only charger state contracts from the existing Modbus register map."""

from .registers import Register

AC_STATES = {0: "Initializing", 1: "Not Connected", 2: "Reserving", 3: "Preparing", 4: "EV Ready", 5: "Charging", 6: "Fault", 7: "Error"}
DC_STATES = {0: "Idle", 1: "Occupied", 2: "Preparing Comm", 3: "Charging", 4: "Fault", 5: "Scheduled", 6: "Ended", 7: "Unavailable", 8: "Discharging", 9: "Alarm", 10: "Preparing Insulation"}
CHARGER_REGISTERS = {
    "ac_state": Register(32000), "ac_power": Register(32003, 2, 1000, True),
    "dc_state": Register(31513), "dc_power": Register(31502, 2, 1000, True),
}


def configured_units(data, peers=()):
    """Use explicit units or unambiguous existing configuration for this endpoint.

    No scanning, assumed unit 1, extra connection, or foreign-plant sensor reuse.
    An ambiguous peer configuration requires an explicit unit selection.
    """
    result = {kind: data.get(f"{kind}_charger_unit_id") for kind in ("ac", "dc")}
    endpoint = (str(data.get("host", "")).strip().lower(), data.get("port", 502))
    for kind in result:
        if result[kind] is not None:
            if type(result[kind]) is not int or not 1 <= result[kind] <= 246:
                raise ValueError("Charger unit must be an integer from 1 to 246")
            continue
        candidates = set()
        for peer in peers:
            connection = peer.get("plant_connection", {})
            if (str(connection.get("host", "")).strip().lower(), connection.get("port", 502)) != endpoint:
                continue
            rows = peer.get("ac_charger_connections" if kind == "ac" else "inverter_connections", {})
            for row in rows.values() if isinstance(rows, dict) else ():
                if not isinstance(row, dict) or kind == "dc" and row.get("inverter_has_dccharger") is not True:
                    continue
                if (str(row.get("host", "")).strip().lower(), row.get("port", 502)) == endpoint:
                    unit = row.get("slave_id")
                    if type(unit) is int and 1 <= unit <= 246:
                        candidates.add(unit)
        if len(candidates) == 1:
            result[kind] = candidates.pop()
    return result
