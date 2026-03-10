# =============================================================================
# modules/logistics.py
# Business logic for frescos transport and second miniflete decisions.
#
# "Frescos" are the raw / perishable ingredients (meat, produce, etc.) that
# must be delivered to the event venue by a dedicated vehicle.
# A "miniflete" is a small hired van used when the team does not own a van.
# A "second miniflete" may be needed for large guest counts where a single
# vehicle cannot carry all the frescos in one trip.
# =============================================================================

import math
import statistics
import unicodedata
from datetime import datetime, timedelta

import httpx
import polyline as polyline_lib

# Import all thresholds and keywords from the central constants file.
# Using named constants instead of magic numbers makes the rules self-documenting
# and easy to change in one place without hunting through logic code.
from config import (
    CHARTER_THRESHOLD,
    CLUSTER_RADIUS_KM,
    DEPARTURE_BUFFER_MINUTES,
    DEPARTURE_PREP_HOURS,
    LOADING_TIME_MINUTES,
    LONG_EVENT_DURATION_THRESHOLD,
    LONG_EVENT_EXTRA_HOURS,
    MENU_KEYWORDS,
    PEA_EXCLUSIVE_DIFF_MINUTES,
    PEA_MAX_TRANSIT_MINUTES,
    PEA_RADIUS_KM,
    PEA_ROUTE_PROXIMITY_KM,
    MAX_PASSENGERS_PER_CAR,
    MAX_PASSENGERS_UBER,
    PICADA_GUEST_THRESHOLD,
    PICKUP_MAX_DETOUR_METERS,
    PICKUP_MAX_TRANSIT_MINUTES,
    PICKUP_MIN_TIME_SAVING_MINUTES,
    PICKUP_PLACE_TYPES,
    PICKUP_TOP_CANDIDATES,
    SECOND_MINIFLETE_CONDITIONS,
)

# calculate_distances is used by evaluate_pea_candidates() and find_pickup_candidate()
# to get transit times via the Distance Matrix API.
# GOOGLE_MAPS_API_KEY is imported so find_pickup_candidate() can authenticate the
# Places API call it makes directly (the Places API call is inlined here rather
# than delegated to maps_client to keep the full Step 7 logic in one function).
# Both cross-module imports work because uvicorn adds the project root to sys.path.
from modules.maps_client import (
    calculate_distances,
    GOOGLE_MAPS_API_KEY,
    _PLACES_SEARCH_RADIUS,   # 300 m search radius shared with find_pea_candidates
    _PEA_PLACE_TYPES,        # transit hub type list shared with find_pea_candidates
)
from modules.api_cache import get as cache_get, put as cache_put


# =============================================================================
# Internal helpers
# =============================================================================

def _normalize(text: str) -> str:
    """
    Normalise a string for keyword comparison:
      1. Convert to lowercase.
      2. Strip leading/trailing whitespace.
      3. Remove diacritical marks (accents) so that, e.g.,
         "Estación" matches the keyword "estacion".

    The NFD (Canonical Decomposition) form breaks each accented character
    into its base letter plus a combining mark; we then discard all
    characters whose Unicode category starts with "Mn" (Mark, Nonspacing).

    Parameters:
        text (str): Raw string from an Excel cell or constant.

    Returns:
        str: Normalised string ready for substring matching.
    """
    text = text.lower().strip()
    # Decompose accented characters (e.g. 'é' → 'e' + combining acute)
    text = unicodedata.normalize("NFD", text)
    # Keep only non-combining characters (i.e. drop the accent marks)
    return "".join(c for c in text if unicodedata.category(c) != "Mn")


def _haversine_distance(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """
    Returns the straight-line (great-circle) distance in kilometres between
    two points defined by latitude and longitude, using the Haversine formula.

    Why Haversine here instead of the Distance Matrix API?
    The "optimal" vs "consult_remuneration" flag only needs an approximate
    threshold check (PEA_RADIUS_KM = 10 km).  Haversine gives exact spherical
    geometry at this scale with no quota cost and no network round-trip.

    Parameters:
        lat1, lng1 (float): Coordinates of the first point (degrees).
        lat2, lng2 (float): Coordinates of the second point (degrees).

    Returns:
        float: Distance in kilometres.
    """
    R = 6371.0  # Earth mean radius in kilometres

    # Convert degree differences to radians for the trig functions
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)

    # Haversine formula: a = sin²(Δlat/2) + cos(lat1)·cos(lat2)·sin²(Δlng/2)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlng / 2) ** 2
    )

    # Central angle via atan2 — numerically stable for all distances
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return R * c


# Seniority rank used to pick the highest-seniority employee when multiple
# candidates match a role.  The values are arbitrary ordinals — only their
# relative size matters.  Any Profesion string that contains none of these
# keywords is ranked 0 (lowest priority) rather than raising an error.
_SENIORITY_RANK: dict[str, int] = {
    "senior": 3,
    "medior": 2,
    "junior": 1,
}


def _seniority_rank(profesion: str) -> int:
    """
    Extracts the seniority level embedded in a Profesion string and returns
    its numeric rank so that callers can use max() to find the best match.

    The Profesion column in the 'Equipo' sheet encodes both role and seniority
    in a single string (e.g. "Jefe de Parrilla Senior", "Parrillero Medior").
    There is no separate Senioridad column — seniority is always read from here.

    Parameters:
        profesion (str): Raw Profesion cell value from the staff dict.

    Returns:
        int: 3 for Senior, 2 for Medior, 1 for Junior, 0 if none matched.
    """
    normalised = _normalize(profesion)
    for level, rank in _SENIORITY_RANK.items():
        # level is already lowercase; _normalize() lowercased normalised
        if level in normalised:
            return rank
    return 0  # unrecognised seniority — treated as lowest priority


def _find_manager_senior(staff: list[dict]) -> dict:
    """
    Finds the employee whose Profesion is exactly "Manager Senior" (after
    normalisation for case and accents).

    Exact match is intentional: "Manager Senior" is a specific, unique role
    per event — we do not want a "Manager Medior" to be selected if the
    senior is absent, since that would silently assign the wrong person.

    Parameters:
        staff (list[dict]): Full staff list from read_excel()["staff"].

    Returns:
        dict: The matching employee dict.

    Raises:
        ValueError: If no employee with Profesion "Manager Senior" is found.
    """
    target = _normalize("Manager Senior")  # normalise once, compare many

    for member in staff:
        if _normalize(str(member.get("Profesion", ""))) == target:
            return member

    raise ValueError("No Manager Senior found in staff list")


def _find_highest_parrilla(staff: list[dict]) -> dict:
    """
    Finds the highest-seniority employee whose Profesion contains "parrilla"
    or "parrillero" (after normalisation).

    Why substring match here (vs exact match for Manager Senior)?
    Parrilla roles span several titles in the source data:
    "Jefe de Parrilla Senior", "Parrillero Senior", "Parrillero Medior", etc.
    We need to catch all of them and then pick the most senior, not just one
    specific string.

    Seniority order: Senior (3) > Medior (2) > Junior (1) > unknown (0).
    If multiple employees share the same highest rank, the first one found
    in the staff list wins (order is determined by the Excel sheet).

    Parameters:
        staff (list[dict]): Full staff list from read_excel()["staff"].

    Returns:
        dict: The highest-seniority Parrilla employee dict.

    Raises:
        ValueError: If no employee with a Parrilla role is found.
    """
    # Keywords that identify a parrilla role anywhere in the Profesion string.
    # Both variants appear in real data ("Jefe de Parrilla" vs "Parrillero").
    parrilla_keywords = {"parrilla", "parrillero"}

    candidates = [
        member for member in staff
        if any(
            kw in _normalize(str(member.get("Profesion", "")))
            for kw in parrilla_keywords
        )
    ]

    if not candidates:
        raise ValueError("No Parrilla role found in staff list")

    # max() with a key function selects the employee with the highest rank.
    # If two employees share the same rank, max() returns the last one found
    # (Python's max is not stable for equal elements), which is acceptable
    # because seniority ties within the same role should not occur per event.
    return max(
        candidates,
        key=lambda m: _seniority_rank(str(m.get("Profesion", ""))),
    )


def _row_contains(row: dict, keyword: str) -> bool:
    """
    Returns True if the normalised keyword appears anywhere in the
    'Servicio' OR 'Detalle' columns of a prestaciones row.

    We search both columns because some services (e.g. "Estación de fuegos")
    are named in 'Servicio', while menu descriptions (e.g. "Asado Tradicional")
    tend to live in 'Detalle'.  Searching both avoids fragile assumptions
    about which column the operator will fill in for a given event.

    Parameters:
        row     (dict): One row from the prestaciones list, with at least
                        the keys "Servicio" and "Detalle".
        keyword (str):  Already-normalised keyword string to look for.

    Returns:
        bool: True if the keyword is found in either column.
    """
    servicio = _normalize(str(row.get("Servicio", "")))
    detalle  = _normalize(str(row.get("Detalle", "")))
    return keyword in servicio or keyword in detalle


# =============================================================================
# Public API
# =============================================================================

def determine_frescos_vehicle(has_own_van: bool, staff: list[dict]) -> dict:
    """
    Determines which vehicle will transport the frescos (raw ingredients)
    to the event venue and which specific employees are assigned to ride in it.

    Business rule:
      - If the company owns a van → use it and assign Manager Senior +
        the highest-seniority Parrillero, who are responsible for receiving
        and inventorying the supplies at the venue.
      - If no van is available → hire a miniflete (small hired van) and assign
        only the Manager Senior, who oversees the logistics.
        The Parrillero travels separately because a hired miniflete's payload
        capacity is smaller and loading priority goes to the frescos cargo.

    Employee lookup uses the 'Profesion' column, which embeds both role and
    seniority in a single string (e.g. "Manager Senior", "Jefe de Parrilla Senior").
    See _find_manager_senior() and _find_highest_parrilla() for the rules.

    Parameters:
        has_own_van (bool):    True if the company's own van is available for
                               this event, False if a miniflete must be hired.
        staff (list[dict]):    Full staff list from read_excel()["staff"].
                               Each dict must have a "Profesion" key, plus
                               "Nombre" and "Apellido" for the display name.

    Returns:
        dict: {
            "vehicle":        str,       # "camioneta propia" | "miniflete contratado"
            "assigned_names": list[str], # ["Nombre Apellido", ...] for display
        }

    Raises:
        ValueError: If no Manager Senior is found, or (for own van) no Parrilla
                    role is found in the staff list.
    """
    # Always locate the Manager Senior — they ride in either vehicle type.
    # _find_manager_senior() raises ValueError if none is found, propagating
    # cleanly to the endpoint's exception handler as a 422 detail.
    manager = _find_manager_senior(staff)
    manager_name = (
        f"{manager.get('Nombre', '')} {manager.get('Apellido', '')}".strip()
    )

    if has_own_van:
        # The company van has ample cargo space; both the Manager Senior and
        # the highest-seniority Parrillero travel with the frescos to handle
        # receiving, cold-chain verification, and on-arrival setup.
        parrilla = _find_highest_parrilla(staff)
        parrilla_name = (
            f"{parrilla.get('Nombre', '')} {parrilla.get('Apellido', '')}".strip()
        )
        return {
            "vehicle":        "camioneta propia",
            "assigned_names": [manager_name, parrilla_name],
        }
    else:
        # A hired miniflete has limited guaranteed space; only the Manager
        # Senior accompanies the frescos to oversee delivery and sign off
        # on quantities.  The Parrillero is placed in the remaining pool.
        return {
            "vehicle":        "miniflete contratado",
            "assigned_names": [manager_name],
        }


def determine_second_miniflete(prestaciones: list[dict]) -> dict:
    """
    Evaluates whether the event's prestaciones (contracted services) require
    a second miniflete to transport all the frescos to the venue.

    A second miniflete is warranted when the volume of perishable ingredients
    exceeds what a single vehicle can safely carry in one trip.  The triggers
    are based on guest count (Cantidad) for each menu type, because larger
    guest counts imply proportionally larger ingredient loads.

    Guard clause — estacion de fuegos:
        The second miniflete is only evaluated when "Estación de fuegos" is NOT
        contracted.  If it IS contracted, the live fire station handles frescos
        on-site and no extra vehicle is needed.  We check this first so the
        volume evaluation only runs when it is actually relevant.

    Trigger conditions (OR logic — any single condition is sufficient):
        1. "Asado tradicional" menu AND Cantidad > 60 guests
        2. "Asado finger food" menu   AND Cantidad > 70 guests
        3. "Acompañamiento bebidas"   AND Cantidad > 20 units

    All string comparisons are normalised with _normalize() (lowercase +
    accent removal) to avoid mismatches due to capitalisation or typos.

    Parameters:
        prestaciones (list[dict]): List of service rows from the Excel
            'prestaciones' sheet, as returned by read_excel()["services"].
            Each dict has at least the keys "Servicio", "Detalle", "Cantidad".

    Returns:
        dict: {
            "needs_second_miniflete": bool,
            "reason":                 str,   # human-readable explanation
        }
    """
    # Pre-normalise the keywords once so we don't repeat the call in the loop
    kw_asado_trad  = _normalize(MENU_KEYWORDS["asado_tradicional"])
    kw_asado_ff    = _normalize(MENU_KEYWORDS["asado_finger_food"])
    kw_bebidas     = _normalize(MENU_KEYWORDS["bebidas"])
    kw_fuegos      = _normalize(MENU_KEYWORDS["estacion_fuegos"])

    # -------------------------------------------------------------------------
    # Guard clause: check for "estacion de fuegos" in any row first.
    # If found, the live fire station handles the frescos on-site — no second
    # miniflete is ever needed in that scenario.
    # -------------------------------------------------------------------------
    for row in prestaciones:
        if _row_contains(row, kw_fuegos):
            return {
                "needs_second_miniflete": False,
                "reason": (
                    "Estacion de fuegos is contracted — frescos are managed "
                    "on-site by the parrilla team; second miniflete not required."
                ),
            }

    # -------------------------------------------------------------------------
    # Main evaluation: iterate once through the rows and check each trigger.
    # We read 'Cantidad' as an integer; if the cell is empty or non-numeric
    # we default to 0 so comparisons remain safe without crashing.
    # -------------------------------------------------------------------------
    for row in prestaciones:
        try:
            cantidad = int(row.get("Cantidad") or 0)
        except (ValueError, TypeError):
            # Non-numeric Cantidad (e.g. a typo or blank) — treat as 0
            cantidad = 0

        trad_threshold = SECOND_MINIFLETE_CONDITIONS["asado_tradicional_threshold"]
        ff_threshold   = SECOND_MINIFLETE_CONDITIONS["asado_finger_food_threshold"]
        beb_threshold  = SECOND_MINIFLETE_CONDITIONS["bebidas_threshold"]

        if _row_contains(row, kw_asado_trad) and cantidad > trad_threshold:
            return {
                "needs_second_miniflete": True,
                "reason": (
                    f"Asado tradicional with {cantidad} guests exceeds the "
                    f"threshold of {trad_threshold}."
                ),
            }

        if _row_contains(row, kw_asado_ff) and cantidad > ff_threshold:
            return {
                "needs_second_miniflete": True,
                "reason": (
                    f"Asado finger food with {cantidad} guests exceeds the "
                    f"threshold of {ff_threshold}."
                ),
            }

        if _row_contains(row, kw_bebidas) and cantidad > beb_threshold:
            return {
                "needs_second_miniflete": True,
                "reason": (
                    f"Acompañamiento bebidas with {cantidad} units exceeds the "
                    f"threshold of {beb_threshold}."
                ),
            }

    # No trigger condition was met
    return {
        "needs_second_miniflete": False,
        "reason": "No trigger conditions met for the contracted prestaciones.",
    }


def calculate_departure_time(
    event_time_str: str,
    travel_seconds: int,
    event_duration_hours: float,
    picada_guests: int,
) -> dict:
    """
    Calculates the departure time from the CP (Centro de Producción) for the
    frescos vehicle — and the second miniflete if one is used, since both
    depart from the CP at the same time.

    The formula works backwards from the event start time, subtracting every
    fixed block of time the team needs before service can begin:

        departure = event_time
                    − DEPARTURE_PREP_HOURS      (setup time at venue)
                    − travel_minutes            (CP → event, rounded up)
                    − DEPARTURE_BUFFER_MINUTES  (last-minute margin)
                    − LOADING_TIME_MINUTES      (loading frescos at CP)
                    [ − LONG_EVENT_EXTRA_HOURS  (if event is long or has picada) ]

    The extra prep block is applied when EITHER of these is true (OR logic):
      - event_duration_hours >= LONG_EVENT_DURATION_THRESHOLD  (≥ 8 h event)
      - picada_guests >= PICADA_GUEST_THRESHOLD                (≥ 100 picada guests)

    If both conditions are met simultaneously, the extra hours are still added
    only once; both reasons are reported in the returned list.

    Parameters:
        event_time_str      (str):   Event start time as "HH:MM", read from
                                     the 'hora_inicio' field of the Excel.
        travel_seconds      (int):   Driving time in seconds from the CP to
                                     the event venue, as returned by the
                                     Distance Matrix API.
        event_duration_hours (float): Total planned duration of the event in
                                     hours (used to trigger extra prep time).
        picada_guests       (int):   Number of guests for the picada service;
                                     pass 0 if no picada is contracted.

    Returns:
        dict: {
            "departure_time":            str,        # "HH:MM" — time to leave the CP
            "extra_prep_applied":        bool,       # whether extra hours were added
            "extra_prep_reason":         list[str],  # reasons that triggered extra prep;
                                                     # may contain "long event", "picada", or both;
                                                     # empty list if extra prep was not applied
            "total_minutes_before_event": int,       # total lead time in minutes
        }
    """
    # Parse the event start time string into a datetime object.
    # We use today's date as a placeholder — we only care about the time component.
    event_time = datetime.strptime(event_time_str, "%H:%M")

    # Convert travel seconds to minutes, rounding UP.
    # math.ceil ensures we never underestimate the drive — arriving early is
    # always better than arriving late at an event venue.
    travel_minutes = math.ceil(travel_seconds / 60)

    # Sum all fixed deductions that always apply
    total_minutes = (
        DEPARTURE_PREP_HOURS * 60   # hours → minutes
        + travel_minutes
        + DEPARTURE_BUFFER_MINUTES
        + LOADING_TIME_MINUTES
    )

    # -------------------------------------------------------------------------
    # Check whether the extra prep block is needed (OR logic).
    # Both conditions are evaluated independently so that if both are true,
    # both reasons appear in the returned list.  The extra hours are still
    # added only once — they represent a single additional block of setup time,
    # not a multiplier.
    # -------------------------------------------------------------------------
    extra_prep_reason = []

    if event_duration_hours >= LONG_EVENT_DURATION_THRESHOLD:
        extra_prep_reason.append("long event")

    if picada_guests >= PICADA_GUEST_THRESHOLD:
        extra_prep_reason.append("picada")

    extra_prep_applied = len(extra_prep_reason) > 0

    if extra_prep_applied:
        total_minutes += LONG_EVENT_EXTRA_HOURS * 60   # hours → minutes

    # Subtract the total lead time from the event start to get the departure time.
    # timedelta handles midnight roll-overs correctly (e.g. a 01:00 event with
    # a 6-hour lead time will produce 19:00 the previous day — only the HH:MM
    # part is returned, so callers should be aware this is a wall-clock time).
    departure_time = event_time - timedelta(minutes=total_minutes)

    return {
        "departure_time":             departure_time.strftime("%H:%M"),
        "extra_prep_applied":         extra_prep_applied,
        "extra_prep_reason":          extra_prep_reason,
        "total_minutes_before_event": total_minutes,
    }


def get_remaining_pool(staff: list[dict], assigned_roles: list[str]) -> dict:
    """
    Builds the remaining staff pool after the frescos and second-miniflete
    assignments have been committed.

    Each employee in the full staff list is checked against assigned_roles
    by matching their "Profesion" column value.  Matched employees are
    separated out as already assigned; the rest form the pool that still
    needs to be placed into a vehicle for the event.

    After building the pool, two edge-case checks run immediately because
    they block all further routing logic:
      - pool == 1  → only one person left; no standard vehicle can carry
                     a single passenger economically.  The user must find
                     an alternative (moto, baúl de camioneta, etc.).
      - pool > CHARTER_THRESHOLD (8) → too many people for individual cars
                     or Ubers; a charter bus must be arranged instead.

    If neither edge case is triggered (status "proceed"), the caller can
    continue to Step 4b: personal car assignment and Uber allocation.

    Parameters:
        staff          (list[dict]): Full staff list from read_excel()["staff"].
                                     Each dict must have at least a "Profesion" key.
        assigned_roles (list[str]):  Role strings already committed to the
                                     frescos vehicle or second miniflete
                                     (e.g. ["Manager Senior", "Jefe de Parrilla Senior"]).

    Returns:
        dict: {
            "remaining_pool":      list[dict], # staff not yet assigned to any vehicle
            "remaining_count":     int,
            "assigned_to_frescos": list[dict], # staff removed from pool (matched roles)
            "charter_required":    bool,        # True if remaining_count > CHARTER_THRESHOLD
            "alternative_required": bool,       # True if remaining_count == 1
            "status":              str,         # "charter" | "alternative" | "proceed"
        }
    """
    assigned_to_frescos = []
    remaining_pool      = []

    for member in staff:
        # Strip whitespace before comparing to guard against accidental spaces
        # in the Excel "Profesion" cell — exact match is intentional here
        # because role strings are controlled vocabulary, not free text.
        profesion = str(member.get("Profesion", "")).strip()

        if profesion in assigned_roles:
            assigned_to_frescos.append(member)
        else:
            remaining_pool.append(member)

    remaining_count = len(remaining_pool)

    # -------------------------------------------------------------------------
    # Edge-case checks: both conditions halt further routing because no
    # standard vehicle-assignment logic applies in either scenario.
    # We derive a single "status" string so the frontend can branch cleanly
    # without inspecting two separate boolean flags.
    # -------------------------------------------------------------------------
    charter_required     = remaining_count > CHARTER_THRESHOLD
    alternative_required = remaining_count == 1

    if charter_required:
        # Too many people for cars/Ubers — a hired bus is the only viable option.
        status = "charter"
    elif alternative_required:
        # Exactly one person left — no standard vehicle makes sense for one rider.
        # The user must decide: send them on a moto, fit them in the van's boot, etc.
        status = "alternative"
    else:
        # Normal case: 2–8 people remaining, proceed to car and Uber assignment.
        status = "proceed"

    return {
        "remaining_pool":       remaining_pool,
        "remaining_count":      remaining_count,
        "assigned_to_frescos":  assigned_to_frescos,
        "charter_required":     charter_required,
        "alternative_required": alternative_required,
        "status":               status,
    }


def detect_personal_vehicle(staff: list[dict]) -> dict:
    """
    Scans the full staff list for any employee who has a personal vehicle
    available for the event, indicated by a non-empty "Auto" column in the
    Excel 'equipo' sheet.

    Business rule: there is never more than one personal vehicle per event.
    This is a data-entry guarantee from the operator, not something we can
    enforce in code — but we guard against it anyway.  If multiple employees
    have a car listed, the first one found is used and a warning is returned
    so the caller (and ultimately the user) is made aware of the inconsistency.

    Why scan the full staff list rather than the remaining pool?
    Personal vehicle detection is done before pool filtering so that the result
    can be passed to the vehicle-assignment step regardless of which pool the
    driver ends up in.  If the driver was already assigned to a frescos vehicle,
    the car is not available for the remaining pool — but that collision is
    resolved by the caller, not here.

    Parameters:
        staff (list[dict]): Full staff list from read_excel()["staff"].
                            Each dict is expected to have an "Auto" key whose
                            value is the car make/model string, or an empty
                            string / missing key if the employee has no car.

    Returns:
        dict: {
            "has_personal_vehicle": bool,
            "driver":               dict | None,  # full employee dict, or None
            "vehicle_description":  str | None,   # "Auto" column value (make/model)
            "warning":              str | None,   # set if more than one car was found
        }
    """
    cars_found = []

    for member in staff:
        # Treat missing key and empty string equally — both mean "no car".
        # strip() removes accidental whitespace that would make a blank cell
        # look non-empty.
        auto = str(member.get("Auto", "")).strip()
        if auto:
            cars_found.append((member, auto))

    # -------------------------------------------------------------------------
    # Normal case: zero or one car found.
    # -------------------------------------------------------------------------
    if not cars_found:
        return {
            "has_personal_vehicle": False,
            "driver":               None,
            "vehicle_description":  None,
            "warning":              None,
        }

    # -------------------------------------------------------------------------
    # Take the first car found as the designated personal vehicle.
    # If more than one was found, build a descriptive warning so the operator
    # knows the data needs to be corrected before the event.
    # -------------------------------------------------------------------------
    driver, vehicle_description = cars_found[0]

    warning = None
    if len(cars_found) > 1:
        # List the names of all employees with a car so the operator can
        # identify and fix the data entry error quickly.
        extra_names = [
            f"{m.get('Nombre', '')} {m.get('Apellido', '')}".strip()
            for m, _ in cars_found[1:]
        ]
        warning = (
            f"More than one personal vehicle found. "
            f"Using first driver: "
            f"{driver.get('Nombre', '')} {driver.get('Apellido', '')}. "
            f"Extra vehicles ignored: {', '.join(extra_names)}. "
            f"Please correct the Excel data."
        )

    return {
        "has_personal_vehicle": True,
        "driver":               driver,
        "vehicle_description":  vehicle_description,
        "warning":              warning,
    }


def _filter_employees_near_route(
    geocoded_members: list[dict],
    route_polyline:   str,
    max_distance_km:  float,
) -> list[dict]:
    """
    Returns only employees whose home address falls within max_distance_km
    of the nearest vertex on the decoded route polyline.  Pure geometry —
    no API calls made.

    Why filter by route proximity?
        A PEA is only meaningful if the employee lives near the driver's
        route.  An employee 10 km away from the nearest polyline point
        cannot reach any transit hub on that route conveniently — there is
        no PEA along it that would save them transit time over going
        directly to the original PE.  Excluding them before the Places API
        search and Distance Matrix calls avoids wasted quota and prevents
        irrelevant employees from diluting the scoring.

    Parameters:
        geocoded_members (list[dict]): Staff with "coordinates" ({lat, lng}).
        route_polyline   (str):        Encoded polyline string.
        max_distance_km  (float):      Inclusion threshold in kilometres.

    Returns:
        list[dict]: Subset of geocoded_members within max_distance_km of
                    the route.  May be empty.
    """
    decoded = polyline_lib.decode(route_polyline)
    if not decoded:
        return []

    near = []
    for emp in geocoded_members:
        c = emp["coordinates"]
        min_dist = min(
            _haversine_distance(c["lat"], c["lng"], lat, lng)
            for lat, lng in decoded
        )
        if min_dist <= max_distance_km:
            near.append(emp)

    return near


def _cluster_by_proximity(geocoded_members: list[dict]) -> list[list[dict]]:
    """
    Groups employees into geographic clusters using a greedy radius-based algorithm.

    Why geographic clustering before transit evaluation?
        A PEA optimised on the global median across all employees can land on a
        compromise point that serves nobody particularly well — especially when the
        team lives in opposite parts of Buenos Aires.  An employee in the north and
        an employee in the south may both have "mediocre" transit times to a central
        PEA when each would have had "excellent" transit times to a PEA near their
        own neighbourhood.  Clustering first lets the algorithm find a candidate
        that genuinely serves each geographic group rather than averaging two groups
        into a location neither of them would have chosen.

    Why simple radius clustering instead of k-means?
        k-means requires specifying k (the number of clusters) upfront.  For this
        problem we do not know in advance how many geographic groups the staff form
        — that depends on the specific event roster, which changes every event.
        Radius-based clustering discovers k naturally: a new cluster is created only
        when an employee lives farther than CLUSTER_RADIUS_KM from all existing
        cluster seeds.  The clusters also carry real geographic meaning ("employees
        within 8 km of each other") rather than the abstract Voronoi partitioning
        that k-means produces, which makes them easier to explain to the manager.

    Algorithm — greedy first-fit:
        For each employee (in order of appearance in the remaining pool):
            - Compute Haversine distance to the seed (first member) of every
              existing cluster.
            - If any cluster seed is within CLUSTER_RADIUS_KM → append to that
              cluster.  Stop at the first match (first-fit).
            - If no cluster is close enough → create a new singleton cluster
              with this employee as its seed.
        An employee belongs to at most one cluster.

    Parameters:
        geocoded_members (list[dict]): Staff with a valid "coordinates" key
                                       ({\"lat\": float, \"lng\": float}).

    Returns:
        list[list[dict]]: One inner list per cluster; each inner list contains
                          the employee dicts that belong to that cluster.
                          Guaranteed non-empty (at least one singleton cluster).
    """
    clusters: list[list[dict]] = []

    for emp in geocoded_members:
        coords = emp["coordinates"]
        placed = False

        for cluster in clusters:
            seed = cluster[0]["coordinates"]
            if (
                _haversine_distance(
                    coords["lat"], coords["lng"],
                    seed["lat"],   seed["lng"],
                )
                <= CLUSTER_RADIUS_KM
            ):
                cluster.append(emp)
                placed = True
                break  # first-fit: stop at the first matching cluster

        if not placed:
            clusters.append([emp])

    return clusters


def _best_candidate_for_cluster(
    candidates:     list[dict],
    cluster:        list[dict],
    mp_destination: dict,
    meeting_point:  dict,
) -> dict | None:
    """
    Evaluates all PEA candidates against one geographic cluster of employees
    and returns the candidate with the highest top-4 savings sum for that
    group, or None if no candidate has a valid transit route for all members.

    One Distance Matrix call per candidate:
        Origins:      cluster members (cluster_size rows)
        Destinations: [candidate, original_PE]  (2 columns)
        Mode:         "transit"
    The all-or-nothing validity rule is preserved from the original function:
    if ANY cluster member has a non-OK status for either destination, the
    entire candidate is skipped — a partial picture would mislead the manager.

    Parameters:
        candidates      (list[dict]): PEA candidate places (transit hubs).
        cluster         (list[dict]): Employee dicts with "coordinates" set.
        mp_destination  (dict):       {\"lat\": …, \"lng\": …} of the original PE.
        meeting_point   (dict):       Full meeting-point dict (name + coords).

    Returns:
        dict | None: Best candidate dict with top4_savings_minutes, top4_employees,
                     cluster_members, and staff_metrics, or None if every candidate
                     is unreachable for ≥ 1 member.
    """
    staff_coords = [m["coordinates"] for m in cluster]
    staff_names  = [
        f"{m.get('Nombre', '')} {m.get('Apellido', '')}".strip()
        for m in cluster
    ]

    valid_candidates: list[dict] = []

    for candidate in candidates:
        candidate_destination = {"lat": candidate["lat"], "lng": candidate["lng"]}

        matrix = calculate_distances(
            origins=staff_coords,
            destinations=[candidate_destination, mp_destination],
            mode="transit",
        )

        rows          = matrix.get("rows", [])
        staff_metrics: list[dict] = []
        skip_candidate = False

        for i, row in enumerate(rows):
            elements = row.get("elements", [])

            # Fewer than 2 elements means the API response is malformed.
            if len(elements) < 2:
                skip_candidate = True
                break

            elem_to_candidate = elements[0]
            elem_to_meeting   = elements[1]

            # Non-OK status = no transit route for this member → skip candidate.
            if elem_to_candidate["status"] != "OK" or elem_to_meeting["status"] != "OK":
                skip_candidate = True
                break

            transit_to_candidate_min = elem_to_candidate["duration"]["value"] / 60
            transit_to_pe_min        = elem_to_meeting["duration"]["value"]   / 60
            time_saved_min           = transit_to_pe_min - transit_to_candidate_min

            staff_metrics.append({
                "employee_name":            staff_names[i],
                "transit_to_candidate_min": transit_to_candidate_min,
                "transit_to_pe_min":        transit_to_pe_min,
                "time_saved_min":           time_saved_min,
                # Warning badge — not a disqualifier.
                "exceeds_max_transit":      transit_to_candidate_min > PEA_MAX_TRANSIT_MINUTES,
            })

        if skip_candidate:
            continue

        # Top-4 employees by shortest transit time to this candidate.
        # Uses MAX_PASSENGERS_PER_CAR because these are exactly the employees
        # who would ride in the personal car via this PEA — the scoring
        # reflects the group the manager is deciding for, not a diluted
        # average across employees who may never use this route.
        sorted_by_transit   = sorted(staff_metrics, key=lambda m: m["transit_to_candidate_min"])
        top4                = sorted_by_transit[:MAX_PASSENGERS_PER_CAR]
        top4_savings_minutes = sum(m["time_saved_min"] for m in top4)
        top4_employees      = [
            {
                "employee_name":            m["employee_name"],
                "transit_to_candidate_min": m["transit_to_candidate_min"],
                "time_saved_min":           m["time_saved_min"],
            }
            for m in top4
        ]

        exclusively_prefer_count = sum(
            1 for m in staff_metrics
            if m["time_saved_min"] >= PEA_EXCLUSIVE_DIFF_MINUTES
        )

        distance_km       = _haversine_distance(
            candidate["lat"], candidate["lng"],
            meeting_point["lat"], meeting_point["lng"],
        )
        pea_near_original = distance_km <= PEA_RADIUS_KM

        remuneration_note = (
            None if pea_near_original
            else (
                f"This PEA is more than {PEA_RADIUS_KM} km from the original "
                f"meeting point ({meeting_point['name']}). "
                f"Driver pay start point should be reviewed with remuneration."
            )
        )

        # cluster_members is a lightweight summary of who this candidate serves
        # and how quickly each member reaches it.  The frontend uses it to label
        # each marker so the manager can see at a glance which geographic group
        # benefits from choosing this specific PEA.
        cluster_members = [
            {
                "employee_name":            m["employee_name"],
                "transit_to_candidate_min": m["transit_to_candidate_min"],
            }
            for m in staff_metrics
        ]

        valid_candidates.append({
            "name":                     candidate["name"],
            "address":                  candidate["address"],
            "lat":                      candidate["lat"],
            "lng":                      candidate["lng"],
            "top4_savings_minutes":     top4_savings_minutes,
            "top4_employees":           top4_employees,
            "exclusively_prefer_count": exclusively_prefer_count,
            "pea_near_original":        pea_near_original,
            "remuneration_note":        remuneration_note,
            "cluster_members":          cluster_members,
            "staff_metrics":            staff_metrics,
        })

    if not valid_candidates:
        return None

    # Best candidate for this cluster = highest combined savings for the top-4
    # closest employees.  Descending sort means valid_candidates[0] is the winner.
    valid_candidates.sort(key=lambda c: c["top4_savings_minutes"], reverse=True)
    return valid_candidates[0]


def _search_pea_near_point(lat: float, lng: float) -> list[dict]:
    """
    Makes a single Places API (New) searchNearby call around (lat, lng)
    and returns all transit hub candidates found within _PLACES_SEARCH_RADIUS
    metres.

    Why in logistics.py rather than maps_client.py?
        find_pickup_candidate() already makes a direct Places API call in
        this module, using the same httpx + api_cache pattern.  Putting this
        function here keeps all PEA evaluation logic together and avoids a
        circular import between maps_client and logistics.

    Uses the "pea_places" cache namespace (same as the deprecated
    find_pea_candidates()) so prior cache entries from the old pipeline can
    still be reused on a cache hit when the centre point happens to match.

    Parameters:
        lat (float): Latitude of the search centre point.
        lng (float): Longitude of the search centre point.

    Returns:
        list[dict]: Transit hub candidates with name, address, lat, lng, types.
                    Empty list if the API returns no results.
    """
    _ck = (lat, lng, _PLACES_SEARCH_RADIUS, tuple(_PEA_PLACE_TYPES))
    cached = cache_get("pea_places", *_ck)
    if cached is not None:
        raw_response = cached["data"]
    else:
        body = {
            "includedTypes": _PEA_PLACE_TYPES,
            "locationRestriction": {
                "circle": {
                    "center": {"latitude": lat, "longitude": lng},
                    "radius": _PLACES_SEARCH_RADIUS,
                }
            },
        }
        headers = {
            "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
            # Request only the four fields we use — Places API (New) charges per
            # field category, so omitting unused fields reduces cost.
            "X-Goog-FieldMask": (
                "places.displayName,"
                "places.location,"
                "places.types,"
                "places.formattedAddress"
            ),
        }
        response = httpx.post(
            "https://places.googleapis.com/v1/places:searchNearby",
            json=body,
            headers=headers,
        )
        response.raise_for_status()
        raw_response = response.json()
        cache_put("pea_places", raw_response, *_ck)

    candidates = []
    for place in raw_response.get("places", []):
        address  = place.get("formattedAddress", "")
        location = place.get("location", {})
        candidates.append({
            "name":    place.get("displayName", {}).get("text", ""),
            "address": address,
            "lat":     location.get("latitude",  0.0),
            "lng":     location.get("longitude", 0.0),
            "types":   place.get("types", []),
        })

    return candidates


def evaluate_pea_candidates(
    remaining_pool: list[dict],
    meeting_point:  dict,
    route_polyline: str,
) -> dict:
    """
    Evaluates PEA (Punto de Encuentro Alternativo) candidates using an
    employee-centric, route-aware pipeline.

    Employee-centric — why filter by route proximity first?
        The old approach sampled the full polyline and made ~40 Places API
        calls regardless of whether any employee lives near the route.  The
        new approach inverts the question: "which employees live near the
        driver's direct route?"  Only those employees can meaningfully benefit
        from a transit hub along it.  If none qualify, we return immediately
        with zero API calls and zero quota cost.

    Why route proximity matters:
        A PEA only helps if the employee can reach a transit hub on the
        driver's route and arrive at the meeting point sooner than they would
        by going directly to the original PE.  An employee whose home is
        PEA_ROUTE_PROXIMITY_KM+ km from the nearest polyline vertex has no
        useful transit hub along that route — no PEA can help them.

    Four-phase approach (Phase 0 is new):
        Phase 0 — filter:
            _filter_employees_near_route() keeps only employees whose home
            is within PEA_ROUTE_PROXIMITY_KM of the nearest polyline vertex.
            Zero matches → early return with no API calls.

        Phase 1 — cluster:
            _cluster_by_proximity() groups the filtered employees who live
            within CLUSTER_RADIUS_KM of each other (greedy first-fit).
            Employees without coordinates are excluded.

        Phase 2 — search + evaluate per cluster:
            For each cluster, the search point is the polyline vertex closest
            to the cluster's centroid — this anchors the Places search ON the
            route near where those employees actually live.  One Places API
            call (_search_pea_near_point()) replaces the old ~40 calls per
            full polyline.  The returned candidates are passed to
            _best_candidate_for_cluster() unchanged.

        Phase 3 — assemble:
            Collect one winner per cluster, deduplicate by address (two
            clusters may independently select the same transit hub), sort by
            top4_savings_minutes descending, and cap the total at 3.

    Why cap at 3?
        UI constraint.  More than 3 map markers for the same type of point is
        visually overwhelming and paradoxically makes the decision harder by
        increasing cognitive load.  Three options naturally span "clearly best",
        "alternative", and "edge case" without cluttering the map.

    Parameters:
        remaining_pool (list[dict]): Staff who still need a vehicle.
                                     Each must have a "coordinates" key from
                                     geocode_staff().
        meeting_point  (dict):       The original PE from nearest_meeting_point().
                                     Must have "lat", "lng", and "name" keys.
        route_polyline (str):        Encoded polyline string of the driver's
                                     direct route (home → event, no stopover).
                                     Used to filter employees and anchor the
                                     per-cluster Places search.

    Returns:
        dict: {
            "candidates": [
                {
                    "name":                     str,
                    "address":                  str,
                    "lat":                      float,
                    "lng":                      float,
                    "top4_savings_minutes":     float,
                    "top4_employees": [
                        {
                            "employee_name":            str,
                            "transit_to_candidate_min": float,
                            "time_saved_min":           float,
                        },
                        ...  # up to MAX_PASSENGERS_PER_CAR entries
                    ],
                    "exclusively_prefer_count": int,
                    "pea_near_original":        bool,
                    "remuneration_note":        str | None,
                    "cluster_members":          [...],
                    "staff_metrics":            [...]
                },
                ...  # up to 3 candidates
            ],
            "has_candidates": bool
        }
    """
    _empty = {"candidates": [], "has_candidates": False}

    if not remaining_pool:
        return _empty

    # Employees without coordinates cannot participate in Distance Matrix calls.
    geocoded_members = [
        m for m in remaining_pool if m.get("coordinates") is not None
    ]
    if not geocoded_members:
        return _empty

    # ── Phase 0: filter employees near the driver's route ─────────────────────
    # Only employees within PEA_ROUTE_PROXIMITY_KM of the route polyline are
    # eligible.  Employees farther away cannot benefit from any transit hub
    # along the route — including them would waste quota and distort scoring.
    near_route = _filter_employees_near_route(
        geocoded_members, route_polyline, PEA_ROUTE_PROXIMITY_KM
    )
    if not near_route:
        # No employee lives near the route — no PEA can help anyone.
        return _empty

    # ── Phase 1: cluster employees by geographic proximity ────────────────────
    clusters = _cluster_by_proximity(near_route)

    # ── Phase 2: search + evaluate per cluster ────────────────────────────────
    # Decode the polyline once and reuse across all cluster searches.
    decoded_route = polyline_lib.decode(route_polyline)

    mp_destination  = {"lat": meeting_point["lat"], "lng": meeting_point["lng"]}
    cluster_winners: list[dict] = []

    for cluster in clusters:
        # Search point = polyline vertex closest to the cluster centroid.
        # This anchors the Places search ON the route near where the cluster's
        # employees live — not at a fixed sampled offset on the full polyline.
        centroid_lat = sum(m["coordinates"]["lat"] for m in cluster) / len(cluster)
        centroid_lng = sum(m["coordinates"]["lng"] for m in cluster) / len(cluster)
        closest = min(
            decoded_route,
            key=lambda pt: _haversine_distance(centroid_lat, centroid_lng, pt[0], pt[1]),
        )
        search_lat, search_lng = closest

        # One Places API call per cluster (vs ~40 for the full polyline).
        candidates = _search_pea_near_point(search_lat, search_lng)
        if not candidates:
            continue

        winner = _best_candidate_for_cluster(
            candidates, cluster, mp_destination, meeting_point
        )
        if winner is not None:
            cluster_winners.append(winner)

    # ── Phase 3: assemble the final candidate list ────────────────────────────
    # Sort all winners by top4_savings_minutes descending so the candidate
    # that saves the most combined travel time for the 4 closest employees
    # appears first regardless of which cluster produced it.
    # Deduplicate by address: two clusters might independently select the same
    # transit hub.  After sorting, the first occurrence has the highest savings,
    # so we keep it and discard subsequent duplicates.
    seen_addresses: set[str] = set()
    deduped: list[dict] = []

    for c in sorted(cluster_winners, key=lambda x: x["top4_savings_minutes"], reverse=True):
        if c["address"] not in seen_addresses:
            seen_addresses.add(c["address"])
            deduped.append(c)

    # Cap at 3 — UI constraint, see docstring.
    top_candidates = deduped[:3]

    return {
        "candidates":     top_candidates,
        "has_candidates": len(top_candidates) > 0,
    }


def get_pickup_highlight(
    remaining_pool: list[dict],
    route_polyline: str,
    meeting_point:  dict,
) -> dict:
    """
    Identifies the employee most likely to benefit from a pickup and the
    point on the driver's route where the car passes closest to their home.
    Pure geometry — no API calls made.

    This is called when the map first loads to give the user a visual hint
    before they run the full `find_pickup_candidate()` pipeline (which makes
    Distance Matrix and Places API calls).  The highlight is a cheap,
    instant approximation: it narrows attention to the right person and the
    right stretch of road without committing to any route deviation.

    ── Why the farthest-from-PE employee? ──────────────────────────────────
    The remaining pool will be split later: the majority walk or take transit
    to the meeting point, and one employee may be picked up along the way.
    The most useful pickup is the one that saves the most transit time.
    Transit time correlates strongly with distance to the meeting point, so
    the employee who lives farthest from the PE is the one for whom a pickup
    detour pays off the most — they are the highest-value candidate.

    ── Why Haversine instead of the Distance Matrix API? ───────────────────
    Haversine gives exact great-circle (straight-line) distances with no
    network latency, no quota cost, and no failure mode.  For the purpose of
    ranking employees by proximity and finding the closest polyline point, the
    difference between straight-line and road distance is negligible: we are
    not computing a route here, only selecting a reference point on the
    polyline to centre the map highlight on.  The Distance Matrix API is
    reserved for the later step where precise transit times are needed.

    ── What is the cross-point? ────────────────────────────────────────────
    The encoded polyline is a compressed sequence of lat/lng samples along
    the driver's road path.  Decoding it yields those sample points.  The
    cross-point is the sample closest (by Haversine) to the employee's home.
    Geometrically it is the polyline vertex nearest to the candidate — the
    spot on the road where the driver "crosses" closest to that employee.
    It is not necessarily on the shortest path to the employee's home; it is
    the point that minimises the straight-line detour the driver would have
    to make.  The frontend places a pin here so the manager can immediately
    see whether the crossing feels reasonable before triggering the full
    Places API search.

    Parameters:
        remaining_pool (list[dict]): Staff not yet assigned to a vehicle.
                                     Each employee must have a "coordinates"
                                     key ({lat, lng}) added by geocode_staff().
        route_polyline (str):        Encoded polyline of the chosen route
                                     (base route for PE, direct route for PEA).
        meeting_point  (dict):       The chosen PE or PEA; must have "lat" / "lng".

    Returns:
        dict: {
            "highlight_candidate": {
                "employee":    dict,                        # full employee dict
                "cross_point": {"lat": float, "lng": float}
            },
            "reason": None
        }
        — or, when no candidate can be identified —
        {
            "highlight_candidate": None,
            "reason": str   # explains why
        }
    """
    # ── Guard: pool must be non-empty ────────────────────────────────────
    if not remaining_pool:
        return {
            "highlight_candidate": None,
            "reason": "Remaining pool is empty — no employees to evaluate.",
        }

    # ── Guard: polyline must decode to at least one point ────────────────
    all_points = polyline_lib.decode(route_polyline) if route_polyline else []
    if not all_points:
        return {
            "highlight_candidate": None,
            "reason": "Route polyline is empty — cannot determine cross-point.",
        }

    mp_lat = meeting_point["lat"]
    mp_lng = meeting_point["lng"]

    # ── Step 1: sort pool by Haversine distance to meeting_point ─────────
    # Employees without coordinates are pushed to the end with inf distance
    # so they do not accidentally become the selected candidate.
    def _dist_to_mp(member: dict) -> float:
        coords = member.get("coordinates")
        if not coords:
            return float("inf")
        return _haversine_distance(
            coords["lat"], coords["lng"], mp_lat, mp_lng
        )

    sorted_pool = sorted(remaining_pool, key=_dist_to_mp)

    # The farthest employee is the last after ascending sort.
    candidate = sorted_pool[-1]
    candidate_coords = candidate.get("coordinates")

    if not candidate_coords:
        return {
            "highlight_candidate": None,
            "reason": (
                "The farthest employee from the meeting point has no geocoded "
                "coordinates — cannot compute a cross-point."
            ),
        }

    cand_lat = candidate_coords["lat"]
    cand_lng = candidate_coords["lng"]

    # ── Step 2: find the polyline point closest to the candidate's home ──
    # We iterate every decoded point and track the minimum Haversine distance.
    # This is an O(n) scan — polylines can have hundreds of points but the
    # operation is microseconds per point with no I/O, so no sampling needed.
    best_dist  = float("inf")
    cross_lat  = all_points[0][0]
    cross_lng  = all_points[0][1]

    for lat, lng in all_points:
        dist = _haversine_distance(lat, lng, cand_lat, cand_lng)
        if dist < best_dist:
            best_dist = dist
            cross_lat = lat
            cross_lng = lng

    return {
        "highlight_candidate": {
            "employee":    candidate,
            "cross_point": {"lat": cross_lat, "lng": cross_lng},
        },
        "reason": None,
    }


def find_pickup_candidate(
    route_polyline: str,
    employee:       dict,
    meeting_point:  dict,
) -> dict:
    """
    Searches for pickup venue options along the driver's route for a specific
    employee the user has selected on the map, then returns the transit-time
    data and candidate places so the manager can decide whether to confirm
    the pickup.

    ── Relationship to get_pickup_highlight() ──────────────────────────────
    get_pickup_highlight() is a cheap, geometry-only pre-flight that runs when
    the map loads: it identifies who the likely pickup candidate is and pins
    the cross-point so the manager sees an immediate visual cue.

    This function is called ON DEMAND — only when the user explicitly opens
    the map context menu and selects "Find pickup on route" for a specific
    employee.  It makes real API calls (Distance Matrix + Places API) and is
    therefore intentionally deferred until the user asks for it.

    ── Overview of the four-step algorithm ─────────────────────────────────
        Step 1 — Cross-point (geometry only).
                 Decode the route polyline; find the vertex closest to the
                 employee's home via Haversine.  This is where the driver
                 passes nearest to that employee.

        Step 2 — Transit-time check (Distance Matrix API).
                 One call, 1 origin × 2 destinations: employee home →
                 cross-point AND employee home → meeting point.  Returns
                 the time saved by going to the cross-point instead of the PE.

        Step 3 — Places API search.
                 Search for pickup-suitable venues within PICKUP_MAX_DETOUR_METERS
                 of the cross-point.

        Step 4 — On-route filter.
                 Keep only venues whose minimum distance to any polyline point
                 is within PICKUP_MAX_DETOUR_METERS.  Sort by distance to
                 cross-point; return top PICKUP_TOP_CANDIDATES.

    ── Why the threshold gates were removed ────────────────────────────────
    The old version returned None when transit_to_cross exceeded
    PICKUP_MAX_TRANSIT_MINUTES or when time_saved was below
    PICKUP_MIN_TIME_SAVING_MINUTES.  Those were threshold judgments — opinions
    about whether the pickup is "worth it".  That judgment now belongs to the
    manager who is actively looking at the map.  The thresholds are still
    computed and surfaced as boolean warning flags so the manager has the
    relevant information, but they no longer suppress the result.

    In contrast, the remaining early returns (no coordinates, empty polyline,
    non-OK Distance Matrix status) are kept because they indicate genuine
    impossibility: there is literally nothing to show the user.  Returning
    a result with no data would be misleading; returning None with a reason
    lets the frontend display an actionable error message instead.

    Parameters:
        route_polyline (str):  Encoded polyline of the driver's route.
                               Base route (home → PE → event) for the PE
                               scenario; direct route (home → event) for the
                               PEA scenario.
        employee (dict):       Full employee dict for the specific person the
                               user selected.  Must have a "coordinates" key
                               ({"lat": float, "lng": float}) already set by
                               geocode_staff().
        meeting_point (dict):  The chosen PE or PEA.  Must have "lat" / "lng".

    Returns:
        dict: One of two shapes.

        When a candidate result is available (even with empty place_options):
        {
            "pickup_candidate": {
                "employee":                        dict,
                "cross_point":                     {"lat": float, "lng": float},
                "transit_time_to_pickup_minutes":  int,
                "transit_time_to_pe_minutes":      int,
                "time_saved_minutes":              int,
                "transit_warning":                 bool,  # True if transit to cross-point
                                                          # exceeds PICKUP_MAX_TRANSIT_MINUTES
                "time_saving_warning":             bool,  # True if time saved is below
                                                          # PICKUP_MIN_TIME_SAVING_MINUTES
                "place_options":                   list[dict]  # may be empty
            },
            "reason": None
        }

        When no result is possible (genuine impossibility):
        {
            "pickup_candidate": None,
            "reason": str
        }
    """
    # ── Step 1: cross-point via Haversine scan ────────────────────────────
    #
    # Decode the route polyline into (lat, lng) tuples.  We do this first so
    # the empty-polyline guard can fire before we attempt anything else.
    all_points = polyline_lib.decode(route_polyline)

    # Genuinely impossible — nothing to show without a polyline.
    # This should not happen with a valid Routes API response, but the guard
    # prevents an obscure IndexError if something upstream went wrong.
    if not all_points:
        return {
            "pickup_candidate": None,
            "reason": "Route polyline has no decoded points.",
        }

    candidate_coords = employee.get("coordinates")

    # Genuinely impossible — we cannot place an employee on the route without
    # knowing where they live.  The caller is expected to pass only geocoded
    # employees, but we guard defensively to avoid a silent KeyError.
    if candidate_coords is None:
        return {
            "pickup_candidate": None,
            "reason": "Employee has no geocoded coordinates.",
        }

    # Walk every decoded polyline vertex and find the one closest to the
    # employee's home address.  This is the cross-point: the spot on the road
    # where the driver is geometrically nearest to the employee.
    # Haversine is used (not the Distance Matrix) because this is a geometric
    # "nearest vertex" search, not a routing problem — no API cost, no latency.
    best_dist      = float("inf")
    cross_lat      = all_points[0][0]
    cross_lng      = all_points[0][1]

    for pt_lat, pt_lng in all_points:
        d = _haversine_distance(candidate_coords["lat"], candidate_coords["lng"], pt_lat, pt_lng)
        if d < best_dist:
            best_dist = d
            cross_lat = pt_lat
            cross_lng = pt_lng

    cross_point = {"lat": cross_lat, "lng": cross_lng}

    # ── Step 2: transit-time check via Distance Matrix ────────────────────
    #
    # One call with 1 origin and 2 destinations avoids a second API round-trip.
    # Destination 0 → cross-point:    time the employee needs to reach the pickup
    # Destination 1 → meeting point:  time they would need without the pickup
    # The difference is the time saved by offering the pickup.
    origin = [{"lat": candidate_coords["lat"], "lng": candidate_coords["lng"]}]

    matrix = calculate_distances(
        origins=origin,
        destinations=[
            cross_point,
            {"lat": meeting_point["lat"], "lng": meeting_point["lng"]},
        ],
        mode="transit",
    )

    elem_to_cross = matrix["rows"][0]["elements"][0]
    elem_to_mp    = matrix["rows"][0]["elements"][1]

    # Genuinely impossible — ZERO_RESULTS means public transit cannot reach
    # the cross-point or the meeting point from this employee's home.
    # There is no data to display; return None so the frontend can show a
    # clear error rather than an empty panel.
    if elem_to_cross["status"] != "OK":
        return {
            "pickup_candidate": None,
            "reason": (
                f"No transit route found from employee home to pickup point "
                f"(Distance Matrix status: {elem_to_cross['status']})."
            ),
        }

    if elem_to_mp["status"] != "OK":
        return {
            "pickup_candidate": None,
            "reason": (
                f"No transit route found from employee home to meeting point "
                f"(Distance Matrix status: {elem_to_mp['status']})."
            ),
        }

    # Float minutes retained for threshold comparisons; int() applied only in
    # the final return value, consistent with how the API returns whole seconds.
    transit_to_cross_min = elem_to_cross["duration"]["value"] / 60
    transit_to_mp_min    = elem_to_mp["duration"]["value"]   / 60
    time_saved_min       = transit_to_mp_min - transit_to_cross_min

    # Threshold judgments — surfaced as informational warnings, not gates.
    # The manager sees these badges on the map and decides whether the pickup
    # makes sense given the full context (employee circumstances, event timing,
    # etc.).  Suppressing the result here would remove the manager's agency.
    transit_warning      = transit_to_cross_min > PICKUP_MAX_TRANSIT_MINUTES
    time_saving_warning  = time_saved_min       < PICKUP_MIN_TIME_SAVING_MINUTES

    # ── Step 3: Places API search around the cross-point ─────────────────
    #
    # We look for pickup-suitable venues within PICKUP_MAX_DETOUR_METERS metres
    # of the cross-point.  The radius is tight so that any found venue is
    # reachable from the road without a significant turn-off by the driver.

    # --- Cache check ---
    _ck = (cross_point["lat"], cross_point["lng"],
           PICKUP_MAX_DETOUR_METERS, tuple(PICKUP_PLACE_TYPES))
    cached_places = cache_get("pickup_places", *_ck)
    if cached_places is not None:
        raw_places = cached_places["data"]
    else:
        places_body = {
            "includedTypes": PICKUP_PLACE_TYPES,
            "locationRestriction": {
                "circle": {
                    "center": {
                        "latitude":  cross_point["lat"],
                        "longitude": cross_point["lng"],
                    },
                    # The API expects a float; cast in case PICKUP_MAX_DETOUR_METERS
                    # is defined as an int in config.py (float() is a no-op on float).
                    "radius": float(PICKUP_MAX_DETOUR_METERS),
                }
            },
        }
        places_headers = {
            "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
            # Request only the four fields we use — Places API (New) charges per
            # field category, so omitting unused fields reduces cost.
            "X-Goog-FieldMask": (
                "places.displayName,"
                "places.location,"
                "places.types,"
                "places.formattedAddress"
            ),
        }

        places_response = httpx.post(
            "https://places.googleapis.com/v1/places:searchNearby",
            json=places_body,
            headers=places_headers,
        )
        places_response.raise_for_status()
        raw_places = places_response.json().get("places", [])
        cache_put("pickup_places", raw_places, *_ck)

    # ── Step 4: on-route filter ───────────────────────────────────────────
    #
    # The circular Places API search may return venues on adjacent side streets
    # that would require the driver to turn off the main road.  We keep only
    # venues whose minimum straight-line distance to any polyline vertex is
    # within PICKUP_MAX_DETOUR_METERS — a proxy for "on the road the driver
    # is already taking".  Venues are sorted by distance to the cross-point
    # so the most convenient option is offered first.
    #
    # If no venues pass the filter, place_options is an empty list.  We still
    # return the candidate with the transit-time data: the manager may want to
    # see the numbers even if no specific venue was found, and they can choose
    # a spot manually on the map.
    on_route_places: list[tuple[float, dict, float, float]] = []

    for place in raw_places:
        location  = place.get("location", {})
        place_lat = location.get("latitude",  0.0)
        place_lng = location.get("longitude", 0.0)

        # Minimum distance from this venue to any polyline vertex, in metres
        min_dist_to_route_m = min(
            _haversine_distance(place_lat, place_lng, pt_lat, pt_lng)
            for pt_lat, pt_lng in all_points
        ) * 1000

        if min_dist_to_route_m > PICKUP_MAX_DETOUR_METERS:
            continue  # off-route: would require driver to detour

        dist_to_cross_m = (
            _haversine_distance(place_lat, place_lng, cross_point["lat"], cross_point["lng"])
            * 1000
        )
        on_route_places.append((dist_to_cross_m, place, place_lat, place_lng))

    on_route_places.sort(key=lambda x: x[0])

    place_options = [
        {
            "place_name":    p.get("displayName", {}).get("text", ""),
            "place_address": p.get("formattedAddress", ""),
            "lat":           p_lat,
            "lng":           p_lng,
            "place_types":   p.get("types", []),
        }
        for _, p, p_lat, p_lng in on_route_places[:PICKUP_TOP_CANDIDATES]
    ]

    return {
        "pickup_candidate": {
            "employee":                       employee,
            "cross_point":                    cross_point,
            "transit_time_to_pickup_minutes": int(transit_to_cross_min),
            "transit_time_to_pe_minutes":     int(transit_to_mp_min),
            "time_saved_minutes":             int(time_saved_min),
            # Warning flags: threshold judgments surfaced for the manager,
            # not gates that suppress the result.  True = manager should
            # review; False = within the recommended operating range.
            "transit_warning":                transit_warning,
            "time_saving_warning":            time_saving_warning,
            "place_options":                  place_options,
        },
        "reason": None,
    }


def assign_vehicle_passengers(
    remaining_pool:       list[dict],
    driver:               dict,
    chosen_meeting_point: dict,
) -> dict:
    """
    Assigns every employee in the remaining staff pool to a specific vehicle
    after the user has confirmed the final meeting point (PE or PEA).

    This is the core of Step 4b.  By the time this function is called:
      - The frescos vehicle has already taken its crew (Manager Senior and
        optionally the Jefe de Parrilla Senior); they are not in remaining_pool.
      - The personal car driver has been identified by detect_personal_vehicle().
      - The user has chosen between the original PE and the PEA.

    Three vehicles are assigned:
      1. Personal car  — the driver plus up to MAX_PASSENGERS_PER_CAR passengers.
         Passengers are chosen by proximity to the meeting point (closest first)
         because they can reach the meeting point easily and board the car there.
      2. Uber(s)       — everyone else, in batches of up to MAX_PASSENGERS_UBER.
         Each batch represents one Uber booking.  Uber passengers go directly
         to the chosen meeting point; no individual routing is computed.

    Parameters:
        remaining_pool       (list[dict]): Staff not yet assigned to any vehicle,
                                           as returned by
                                           get_remaining_pool()["remaining_pool"].
                                           Each employee must have a "coordinates"
                                           key added by geocode_staff().
        driver               (dict):       The employee who owns the personal car,
                                           as returned by
                                           detect_personal_vehicle()["driver"].
        chosen_meeting_point (dict):       The meeting point the user confirmed
                                           (PE or PEA).  Must have "name", "lat",
                                           and "lng" keys.

    Returns:
        dict: {
            "personal_vehicle": {
                "driver":          dict,        # the driver employee dict
                "passengers":      list[dict],  # up to MAX_PASSENGERS_PER_CAR
                "total_occupants": int          # 1 (driver) + len(passengers)
            },
            "uber_groups": [
                {
                    "group_number": int,
                    "passengers":   list[dict],  # up to MAX_PASSENGERS_UBER each
                    "meeting_point": dict         # the chosen_meeting_point
                },
                ...
            ],
            "single_employee_warning": str | None  # set when exactly 1 Uber passenger
        }
    """
    # -------------------------------------------------------------------------
    # Step 1: remove the driver from the pool.
    # The driver is already committed to the personal vehicle — they travel in
    # it as the driver, not as a passenger.  We identify them by full name
    # ("Nombre" + "Apellido") because both the driver dict and every pool entry
    # originate from the same Excel rows, making the name a reliable key.
    # If the driver was already excluded from the pool (e.g. they held one of
    # the frescos roles), the list comprehension simply returns the pool unchanged.
    # -------------------------------------------------------------------------
    driver_full_name = (
        f"{str(driver.get('Nombre', '')).strip()} "
        f"{str(driver.get('Apellido', '')).strip()}"
    ).strip()

    pool_without_driver = [
        member for member in remaining_pool
        if (
            f"{str(member.get('Nombre', '')).strip()} "
            f"{str(member.get('Apellido', '')).strip()}"
        ).strip() != driver_full_name
    ]

    # -------------------------------------------------------------------------
    # Step 2: assign personal vehicle passengers.
    # Employees are sorted by their straight-line distance to the chosen meeting
    # point.  The MAX_PASSENGERS_PER_CAR closest employees go in the personal
    # car — they can reach the meeting point easily on their own and then board
    # the car together.  Employees without geocoded coordinates are sorted to
    # the end (inf distance) so they don't accidentally take a car seat over
    # someone with a valid address.
    # -------------------------------------------------------------------------
    def _dist_to_mp(member: dict) -> float:
        coords = member.get("coordinates")
        if coords is None:
            return float("inf")
        return _haversine_distance(
            coords["lat"], coords["lng"],
            chosen_meeting_point["lat"], chosen_meeting_point["lng"],
        )

    sorted_by_mp_dist = sorted(pool_without_driver, key=_dist_to_mp)

    # The closest fill the personal car; the rest go to Uber
    car_passengers  = sorted_by_mp_dist[:MAX_PASSENGERS_PER_CAR]
    uber_passengers = sorted_by_mp_dist[MAX_PASSENGERS_PER_CAR:]

    # -------------------------------------------------------------------------
    # Step 3: group Uber passengers into batches.
    # Python slice notation [i : i + MAX_PASSENGERS_UBER] naturally handles
    # the last batch being smaller than MAX_PASSENGERS_UBER without any special
    # casing — the slice simply returns whatever elements remain.
    # All Uber vehicles go to the chosen meeting point; no per-passenger routing.
    # -------------------------------------------------------------------------
    uber_groups = []
    for i in range(0, len(uber_passengers), MAX_PASSENGERS_UBER):
        batch = uber_passengers[i : i + MAX_PASSENGERS_UBER]
        uber_groups.append({
            "group_number":  len(uber_groups) + 1,
            "passengers":    batch,
            # Every Uber group shares the same destination — the meeting point
            # chosen by the user at the end of the PEA evaluation step.
            "meeting_point": chosen_meeting_point,
        })

    # -------------------------------------------------------------------------
    # Step 4: edge-case — single leftover employee.
    # If exactly one employee is left after filling the personal car, they would
    # form a one-person Uber group.  That is logistically unusual and may fall
    # outside standard remuneration policy for solo bookings.
    # TODO: consult manager — single remaining employee, alternative transport needed
    # -------------------------------------------------------------------------
    single_employee_warning = None
    if len(uber_passengers) == 1:
        lone      = uber_passengers[0]
        lone_name = (
            f"{str(lone.get('Nombre', '')).strip()} "
            f"{str(lone.get('Apellido', '')).strip()}"
        ).strip()
        single_employee_warning = (
            f"{lone_name} is the only employee remaining after personal vehicle "
            f"assignment. A single-passenger Uber is unusual — consult the manager "
            f"about alternative transport arrangements."
        )

    return {
        "personal_vehicle": {
            "driver":          driver,
            "passengers":      car_passengers,
            # total_occupants counts the driver as 1 seat; passengers fill the rest
            "total_occupants": 1 + len(car_passengers),
        },
        "uber_groups":             uber_groups,
        "single_employee_warning": single_employee_warning,
    }


# =============================================================================
# Step 8 helpers — validation and summary assembly
# =============================================================================

def validate_assignments(remaining_pool: list[dict], assignments: dict) -> dict:
    """
    Validates that every employee in remaining_pool has been assigned to exactly
    one vehicle or pickup slot.  Called before allowing the user to proceed to
    the final confirmation modal.

    The function compares two sets:
      - pool_names:     every employee who SHOULD be assigned (from remaining_pool)
      - assigned_names: every employee who HAS been assigned (from assignments)

    Any name in pool_names but not in assigned_names is "unassigned" — the user
    forgot to place that employee.  Any name in assigned_names but not in
    pool_names is "unknown" — it was typed in the frontend but does not match a
    real employee in the pool (data error, likely a typo or stale state).

    Both discrepancy types must be empty for the result to be valid.

    Parameters:
        remaining_pool (list[dict]): Staff not assigned to the frescos vehicle,
                                     as returned by
                                     get_remaining_pool()["remaining_pool"].
                                     Each dict must have "Nombre" and "Apellido".
        assignments    (dict):       User-submitted groupings with keys:
                                       "driver"          (str)
                                       "car_passengers"  (list[str])
                                       "uber_groups"     (list[list[str]])
                                       "pickup_employee" (str | None)
                                     All name strings use "Nombre Apellido" format.

    Returns:
        dict: {
            "valid":                bool,
            "unassigned_employees": list[str],  # in pool but not assigned
            "unknown_assignments":  list[str],  # assigned but not in pool
            "message":              str         # human-readable summary
        }
    """
    # -------------------------------------------------------------------------
    # Step 1: build a set of all names present in remaining_pool.
    # Names are normalised to "Nombre Apellido" format — the same format the
    # frontend sends inside the assignments dict — so comparisons are consistent
    # regardless of extra whitespace from the Excel source.
    # -------------------------------------------------------------------------
    pool_names: set[str] = {
        (
            f"{str(member.get('Nombre', '')).strip()} "
            f"{str(member.get('Apellido', '')).strip()}"
        ).strip()
        for member in remaining_pool
    }

    # -------------------------------------------------------------------------
    # Step 2: collect every name that appears in the assignments dict.
    # We gather names from all four slots: driver, car passengers, each Uber
    # group (a list of lists), and the optional pickup employee.
    # Using a set automatically deduplicates — a name appearing in two slots
    # would still only count once here (it would still be a logical error, but
    # that is a separate concern from the coverage check we are performing).
    # -------------------------------------------------------------------------
    assigned_names: set[str] = set()

    # The driver is always a single "Nombre Apellido" string
    driver_name = assignments.get("driver", "")
    if driver_name:
        assigned_names.add(driver_name.strip())

    # car_passengers is a flat list of name strings
    for name in assignments.get("car_passengers", []):
        if name:
            assigned_names.add(name.strip())

    # uber_groups is a list of lists — flatten both levels
    for group in assignments.get("uber_groups", []):
        for name in group:
            if name:
                assigned_names.add(name.strip())

    # pickup_employee is optional; only add when present
    pickup_name = assignments.get("pickup_employee")
    if pickup_name:
        assigned_names.add(pickup_name.strip())

    # -------------------------------------------------------------------------
    # Step 3: compute discrepancies via set difference.
    # Set difference is O(n) and produces exactly the names in one set but not
    # the other — no looping or conditional chains required.
    # Results are sorted for stable, human-readable output.
    # -------------------------------------------------------------------------
    unassigned = sorted(pool_names - assigned_names)   # missed by the user
    unknown    = sorted(assigned_names - pool_names)   # not from this pool

    valid = not unassigned and not unknown

    # -------------------------------------------------------------------------
    # Step 4: build a human-readable summary message.
    # Each discrepancy type gets its own sentence so the user knows exactly
    # what needs to be fixed before they can confirm.
    # -------------------------------------------------------------------------
    if valid:
        message = "All employees are correctly assigned."
    else:
        parts = []
        if unassigned:
            parts.append(
                f"{len(unassigned)} employee(s) not yet assigned: "
                f"{', '.join(unassigned)}."
            )
        if unknown:
            parts.append(
                f"{len(unknown)} unknown assignment(s) — name(s) not found in "
                f"the remaining pool (possible data error): {', '.join(unknown)}."
            )
        message = " ".join(parts)

    return {
        "valid":                valid,
        "unassigned_employees": unassigned,
        "unknown_assignments":  unknown,
        "message":              message,
    }


def calculate_pe_departure_time(
    event_time_str:       str,
    travel_seconds:       int,
    event_duration_hours: float,
    prestaciones:         list[dict],
    comensales:           int,
) -> dict:
    """
    Calculates departure time from the meeting point (PE or PEA) for all
    staff vehicles — the personal car and every Uber group.

    The formula mirrors the CP departure formula (calculate_departure_time())
    with one key difference: there is NO loading time component.  Loading the
    frescos at the CP is a CP-specific task; staff leaving from the meeting
    point only need travel time, prep time, and a buffer margin.

    Formula:
        departure = event_time
                    − DEPARTURE_PREP_HOURS      (setup time at venue)
                    − travel_minutes            (PE/PEA → event, rounded up)
                    − DEPARTURE_BUFFER_MINUTES  (last-minute margin)
                    [ − LONG_EVENT_EXTRA_HOURS  (if event is long OR picada triggered) ]

    The extra prep block is applied when EITHER condition is true (OR logic):
      - event_duration_hours >= LONG_EVENT_DURATION_THRESHOLD  (≥ 8 h event)
      - picada is contracted AND comensales >= PICADA_GUEST_THRESHOLD

    Picada is detected by searching every prestaciones row using _row_contains()
    with the "picada" keyword from MENU_KEYWORDS.  This keeps the picada check
    inside this function rather than requiring the caller to pre-compute a
    picada_guests integer — the function is self-contained.

    Parameters:
        event_time_str       (str):        Event start time as "HH:MM".
        travel_seconds       (int):        Driving time in seconds from the
                                           meeting point to the event venue,
                                           as returned by the Distance Matrix API.
        event_duration_hours (float):      Total planned duration of the event
                                           in hours.
        prestaciones         (list[dict]): Rows from the 'prestaciones' sheet,
                                           each with "Servicio", "Detalle",
                                           "Cantidad" keys.
        comensales           (int):        Total guest count for the event,
                                           read from the 'evento' sheet.

    Returns:
        dict: {
            "departure_time": str,   # "HH:MM"
            "breakdown": {
                "event_time":                 str,       # "HH:MM" (same as event_time_str)
                "prep_hours":                 int,       # DEPARTURE_PREP_HOURS constant
                "travel_minutes":             int,       # travel_seconds ÷ 60, rounded up
                "buffer_minutes":             int,       # DEPARTURE_BUFFER_MINUTES constant
                "extra_prep_hours":           int,       # LONG_EVENT_EXTRA_HOURS or 0
                "extra_prep_reason":          list[str] | None,
                                                         # ["long event"], ["picada"],
                                                         # ["long event", "picada"], or None
                "total_minutes_before_event": int        # sum of all deductions in minutes
            }
        }
    """
    # Parse the event start time into a datetime so timedelta arithmetic works.
    # We use today's date as a throwaway placeholder — only HH:MM matters.
    event_time = datetime.strptime(event_time_str, "%H:%M")

    # Convert travel seconds to minutes, rounding UP.
    # Ceiling ensures we never cut arrival margin short — one extra minute of
    # buffer is far cheaper than arriving late at an event venue.
    travel_minutes = math.ceil(travel_seconds / 60)

    # Fixed deductions that always apply for the PE departure.
    # Note: LOADING_TIME_MINUTES is intentionally absent here — loading the
    # frescos is only relevant at the CP, not at the meeting point.
    total_minutes = (
        DEPARTURE_PREP_HOURS * 60   # hours → minutes for timedelta arithmetic
        + travel_minutes
        + DEPARTURE_BUFFER_MINUTES
    )

    # -------------------------------------------------------------------------
    # Picada detection from the prestaciones sheet.
    # Normalise the keyword once so _row_contains() can do a plain substring
    # match without worrying about accents or casing.
    # The threshold check (comensales >= PICADA_GUEST_THRESHOLD) guards against
    # small private events where a "picada" is listed but the volume is too low
    # to require the extra setup block.
    # -------------------------------------------------------------------------
    kw_picada  = _normalize(MENU_KEYWORDS["picada"])
    has_picada = any(_row_contains(row, kw_picada) for row in prestaciones)
    picada_triggers_extra = has_picada and comensales >= PICADA_GUEST_THRESHOLD

    # -------------------------------------------------------------------------
    # Extra prep block — OR logic, added only once even when both fire.
    # Each fired condition is recorded independently in extra_prep_reason so the
    # frontend can explain exactly why the departure was moved earlier.
    # -------------------------------------------------------------------------
    extra_prep_reasons: list[str] = []

    if event_duration_hours >= LONG_EVENT_DURATION_THRESHOLD:
        extra_prep_reasons.append("long event")

    if picada_triggers_extra:
        extra_prep_reasons.append("picada")

    if extra_prep_reasons:
        total_minutes += LONG_EVENT_EXTRA_HOURS * 60   # hours → minutes

    # Subtract total lead time from event start to get the wall-clock departure.
    departure_time = event_time - timedelta(minutes=total_minutes)

    return {
        "departure_time": departure_time.strftime("%H:%M"),
        "breakdown": {
            "event_time":   event_time_str,
            "prep_hours":   DEPARTURE_PREP_HOURS,
            "travel_minutes": travel_minutes,
            "buffer_minutes": DEPARTURE_BUFFER_MINUTES,
            # extra_prep_hours is 0 when no extra prep is needed; the frontend
            # can check this field to decide whether to show the extra block.
            "extra_prep_hours": LONG_EVENT_EXTRA_HOURS if extra_prep_reasons else 0,
            # None (not an empty list) signals "no extra prep" — distinguishes
            # "not triggered" from "triggered with an empty list" which would
            # be an impossible state given the logic above.
            "extra_prep_reason": extra_prep_reasons if extra_prep_reasons else None,
            "total_minutes_before_event": total_minutes,
        },
    }


def build_final_output(
    confirmed_summary: dict,
    pe_departure:      dict,
    cp_departure:      dict,
) -> dict:
    """
    Assembles the complete final output displayed in the two draggable blocks
    on the map after the user clicks Confirm.

    Block 1 — Frescos block:  departure from the CP for the frescos vehicle
              and the second miniflete (if any).
    Block 2 — Transport block: departure from the meeting point (PE or PEA)
              for the personal vehicle and all Uber groups.

    This is a pure data-assembly function — it makes no API calls and applies
    no business rules.  All results passed in have already been computed and
    validated by the calling endpoint before this function is called.

    Parameters:
        confirmed_summary (dict): Output of build_assignment_summary() — contains
                                  meeting_point, personal_vehicle, uber_groups,
                                  frescos_vehicle, and second_miniflete.
        pe_departure      (dict): Output of calculate_pe_departure_time() —
                                  contains departure_time and a full breakdown dict.
        cp_departure      (dict): Output of calculate_departure_time() —
                                  contains departure_time, extra_prep_applied,
                                  extra_prep_reason, and total_minutes_before_event.

    Returns:
        dict: {
            "frescos_block": {
                "vehicle":            str,
                "assigned_names":     list[str],
                "departure_from_cp":  str,        # "HH:MM"
                "departure_breakdown": dict,       # full cp_departure result
                "second_miniflete":   dict | None
            },
            "transport_block": {
                "meeting_point":       dict,
                "departure_from_pe":   str,        # "HH:MM"
                "departure_breakdown": dict,       # full pe_departure result
                "personal_vehicle":    dict,       # driver + passengers + pickup
                "uber_groups":         list[dict]
            }
        }
    """
    # -------------------------------------------------------------------------
    # Frescos block — everything the dispatcher needs to brief the frescos crew.
    # The full cp_departure dict is included as departure_breakdown so the
    # frontend can render a tooltip or expandable row showing every component
    # of the formula (prep, travel, buffer, loading, extra if any).
    # -------------------------------------------------------------------------
    frescos_vehicle = confirmed_summary.get("frescos_vehicle", {})

    frescos_block = {
        "vehicle":             frescos_vehicle.get("vehicle"),
        # Carry the actual employee names from build_assignment_summary()
        # into the draggable output block so the dispatcher sees real names,
        # not abstract role strings.
        "assigned_names":      frescos_vehicle.get("assigned_names", []),
        "departure_from_cp":   cp_departure["departure_time"],
        # The full breakdown lets the frontend explain every subtracted minute,
        # making it easy for the manager to verify the formula at a glance.
        "departure_breakdown": cp_departure,
        "second_miniflete":    confirmed_summary.get("second_miniflete"),
    }

    # -------------------------------------------------------------------------
    # Transport block — everything the coordinator needs to brief the staff
    # travelling by personal car and Uber to the meeting point.
    # The full pe_departure dict (including its nested breakdown sub-dict) is
    # included so the frontend can show the same component-level detail as the
    # frescos block, just without the loading time row.
    # -------------------------------------------------------------------------
    transport_block = {
        "meeting_point":       confirmed_summary.get("meeting_point"),
        "departure_from_pe":   pe_departure["departure_time"],
        # pe_departure already contains a "breakdown" sub-dict with every
        # formula component; passing the full result keeps the transport block
        # consistent in shape with the frescos block.
        "departure_breakdown": pe_departure,
        "personal_vehicle":    confirmed_summary.get("personal_vehicle"),
        "uber_groups":         confirmed_summary.get("uber_groups", []),
    }

    return {
        "frescos_block":   frescos_block,
        "transport_block": transport_block,
    }


def build_assignment_summary(
    assignments:             dict,
    chosen_meeting_point:    dict | None,
    frescos_result:          dict,
    second_miniflete_result: dict | None,
    departure_time_result:   dict | None,
) -> dict:
    """
    Assembles the full summary object displayed in the confirmation modal.

    This is a pure data-assembly function — it makes no API calls and applies
    no business rules.  All decisions (vehicle type, passenger groupings,
    departure times) have already been computed by the time this is called;
    this function simply reshapes those results into the structure the
    frontend needs to render the confirmation modal and the final output blocks.

    Parameters:
        assignments             (dict):       User-confirmed assignments with keys
                                              "driver", "car_passengers",
                                              "uber_groups", "pickup_employee".
        chosen_meeting_point    (dict | None): The PE or PEA the user selected,
                                              with "name", "lat", "lng" keys.
                                              None when called from the validate
                                              step before the user has confirmed.
        frescos_result          (dict):       Output of determine_frescos_vehicle(),
                                              with "vehicle" and "assigned_names".
        second_miniflete_result (dict | None): Output of determine_second_miniflete()
                                              when needs_second_miniflete is True,
                                              or None if not triggered.
        departure_time_result   (dict | None): Output of calculate_departure_time(),
                                              or None when called from the validate
                                              step before departure is computed.

    Returns:
        dict: {
            "meeting_point":    dict | None,
            "personal_vehicle": {
                "driver":          str,
                "passengers":      list[str],
                "pickup_employee": str | None,
                "pickup_place":    str | None   # TODO: pass from confirmed pickup
            },
            "uber_groups": [
                { "group_number": int, "passengers": list[str] },
                ...
            ],
            "frescos_vehicle": {
                "vehicle":        str,
                "assigned_names": list[str],
                "departure_time": str | None    # "HH:MM"; None before confirm
            },
            "second_miniflete": dict | None,
            "departure_from_cp": str | None,    # "HH:MM"; None before confirm
            "departure_from_pe": str | None     # always None — calculated in
                                                # confirm step via Routes API
                                                # TODO: wire once confirm is complete
        }
    """
    # -------------------------------------------------------------------------
    # Personal vehicle section.
    # pickup_place is a TODO: the pickup candidate venue name comes from the
    # map interaction (user confirms a place from find_pickup_candidate()),
    # but build_assignment_summary does not yet receive that result as a
    # parameter.  Both pickup fields pass through from assignments as-is;
    # pickup_place is explicitly None until the frontend wires it through.
    # -------------------------------------------------------------------------
    personal_vehicle = {
        "driver":          assignments.get("driver"),
        "passengers":      assignments.get("car_passengers", []),
        "pickup_employee": assignments.get("pickup_employee"),
        # TODO: add pickup_place parameter once frontend sends confirmed venue name
        "pickup_place":    None,
    }

    # -------------------------------------------------------------------------
    # Uber groups — convert from list[list[str]] to list[dict] with group numbers.
    # The frontend needs group_number to label each separate Uber booking.
    # enumerate starts at 0, so we add 1 to get 1-based group numbers.
    # -------------------------------------------------------------------------
    uber_groups = [
        {"group_number": i + 1, "passengers": group}
        for i, group in enumerate(assignments.get("uber_groups", []))
    ]

    # -------------------------------------------------------------------------
    # Departure from CP — only available once calculate_departure_time() has
    # been called (i.e. from the confirm endpoint, not the validate endpoint).
    # We read it from departure_time_result["departure_time"] which is "HH:MM".
    # Both the frescos_vehicle block and the top-level departure_from_cp field
    # share the same value — they depart together.
    # -------------------------------------------------------------------------
    departure_from_cp = (
        departure_time_result["departure_time"]
        if departure_time_result
        else None
    )

    frescos_vehicle = {
        "vehicle":        frescos_result.get("vehicle"),
        # assigned_names carries the actual "Nombre Apellido" strings of the
        # employees riding the frescos vehicle — used for display in the modal.
        "assigned_names": frescos_result.get("assigned_names", []),
        # Mirrors departure_from_cp: present at confirm time, None at validate time
        "departure_time": departure_from_cp,
    }

    return {
        "meeting_point":    chosen_meeting_point,
        "personal_vehicle": personal_vehicle,
        "uber_groups":      uber_groups,
        "frescos_vehicle":  frescos_vehicle,
        "second_miniflete": second_miniflete_result,
        "departure_from_cp": departure_from_cp,
        # departure_from_pe is the time the personal car and Uber vehicles depart
        # from the chosen meeting point toward the event venue.  Computing it
        # requires a Routes API call (meeting point → event) which is deferred
        # to the confirm step once the full endpoint chain is wired.
        # TODO: compute via Routes API in /confirm-assignments and pass in here.
        "departure_from_pe": None,
    }
