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
import unicodedata
from datetime import datetime, timedelta

import httpx
import polyline as polyline_lib

# Import all thresholds and keywords from the central constants file.
# Using named constants instead of magic numbers makes the rules self-documenting
# and easy to change in one place without hunting through logic code.
from config import (
    CHARTER_THRESHOLD,
    DEPARTURE_BUFFER_MINUTES,
    DEPARTURE_PREP_HOURS,
    LOADING_TIME_MINUTES,
    LONG_EVENT_DURATION_THRESHOLD,
    LONG_EVENT_EXTRA_HOURS,
    MENU_KEYWORDS,
    PEA_EXCLUSIVE_DIFF_MINUTES,
    PEA_MAX_TRANSIT_MINUTES,
    PEA_MIN_EXCLUSIVE_PREFERENCE,
    PEA_RADIUS_KM,
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
from modules.maps_client import calculate_distances, GOOGLE_MAPS_API_KEY


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

def determine_frescos_vehicle(has_own_van: bool) -> dict:
    """
    Determines which vehicle will transport the frescos (raw ingredients)
    to the event venue and which staff roles are assigned to ride in it.

    Business rule:
      - If the company owns a van → use it and assign Manager Senior +
        the highest-seniority Parrillero, who are responsible for receiving
        and managing supplies at the venue.
      - If no van is available → hire a miniflete (small hired van) and assign
        only the Manager Senior, who oversees the logistics.
        The Parrillero travels separately in this case because the miniflete's
        capacity is often smaller and loading priority goes to the frescos.

    Parameters:
        has_own_van (bool): True if the company's own van is available for
                            this event, False if a miniflete must be hired.

    Returns:
        dict: {
            "vehicle":        str,        # name of the vehicle
            "assigned_roles": list[str],  # staff roles assigned to this vehicle
        }
    """
    if has_own_van:
        # The company van has ample space; Manager Senior and the highest-seniority
        # Parrillero ride with the frescos to handle and inventory the cargo on arrival.
        # TODO: Once the Excel structure is finalised, replace hardcoded role strings
        # with a lookup that finds the actual employee matching each role.
        # Logic needed: find "Manager Senior" by name from staff list,
        # and find the highest-seniority "Parrillero" as "Jefe de Parrilla".
        return {
            "vehicle": "camioneta propia",
            "assigned_roles": ["Manager Senior", "Jefe de Parrilla Senior"],
        }
    else:
        # A hired miniflete has less guaranteed space; only the Manager Senior
        # accompanies the frescos to oversee delivery and sign off on quantities.
        # TODO: Once the Excel structure is finalised, replace hardcoded role strings
        # with a lookup that finds the actual employee matching each role.
        # Logic needed: find "Manager Senior" by name from staff list,
        # and find the highest-seniority "Parrillero" as "Jefe de Parrilla".
        return {
            "vehicle": "miniflete contratado",
            "assigned_roles": ["Manager Senior"],
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


def evaluate_pea_candidates(
    candidates: list[dict],
    remaining_pool: list[dict],
    meeting_point: dict,
) -> dict:
    """
    Evaluates PEA (Punto de Encuentro Alternativo) candidates against the
    remaining staff pool and the original meeting point, and selects the
    best candidate to propose to the user — if one qualifies.

    PEA proposal rules (ALL must hold for a candidate to qualify):
      1. ALL staff in remaining_pool can reach the candidate in
         ≤ PEA_MAX_TRANSIT_MINUTES (25 min) by public transit.
      2. AT LEAST PEA_MIN_EXCLUSIVE_PREFERENCE (2) staff "exclusively prefer"
         the candidate, defined as:
             transit_time_to_original_PE − transit_time_to_candidate
             ≥ PEA_EXCLUSIVE_DIFF_MINUTES (20 min)

    Evaluation strategy — one Distance Matrix call per candidate:
        Origins:      each employee in remaining_pool who has coordinates (N rows)
        Destinations: [candidate, meeting_point]  (2 columns)
        Mode:         "transit"
        → Returns an N×2 matrix.
          Column 0 = each employee's transit time to the candidate PEA.
          Column 1 = each employee's transit time to the original meeting point.
        Batching both destinations into one call avoids N×2 separate requests
        per candidate, keeping API usage proportional to len(candidates).

    Best-candidate selection:
        Among all qualifying candidates, the one with the highest
        exclusively_prefer_count is selected.  Ties are broken by order of
        appearance in the candidates list (i.e. first qualifying candidate
        encountered with that count wins).

    Proximity flag (pea_near_original):
        Straight-line distance from the selected PEA to the original meeting
        point, computed via _haversine_distance() — no extra API call needed.
        ≤ PEA_RADIUS_KM (10 km) → "optimal"      (driver pay reference unchanged)
        > PEA_RADIUS_KM          → "consult_remuneration" (pay start point unclear)

    Parameters:
        candidates     (list[dict]): Transit hub candidates from find_pea_candidates().
                                     Each must have "lat", "lng", "name", "address".
        remaining_pool (list[dict]): Staff who still need a vehicle, from
                                     get_remaining_pool()["remaining_pool"].
                                     Each must have a "coordinates" key added by
                                     geocode_staff() ({"lat": ..., "lng": ...}).
        meeting_point  (dict):       The original PE from nearest_meeting_point().
                                     Must have "lat", "lng", and "name" keys.

    Returns:
        dict: {
            "pea_proposed":             bool,        # True if a qualifying PEA was found
            "best_candidate":           dict | None, # the winning candidate dict, or None
            "exclusively_prefer_count": int,         # how many staff exclusively prefer the PEA;
                                                     # 0 when pea_proposed is False
            "pea_near_original":        bool,        # True if PEA is within PEA_RADIUS_KM of PE
            "remuneration_note":        str | None,  # user-facing note when PEA is far from PE
        }
    """
    # -------------------------------------------------------------------------
    # Early exits: nothing to evaluate if there are no candidates or no staff.
    # -------------------------------------------------------------------------
    _empty_result = {
        "pea_proposed":             False,
        "best_candidate":           None,
        "exclusively_prefer_count": 0,
        "pea_near_original":        False,
        "remuneration_note":        None,
    }

    if not candidates or not remaining_pool:
        return _empty_result

    # Extract each employee's coordinates for the Distance Matrix origins.
    # Employees whose address failed to geocode are skipped — this guard
    # prevents a KeyError from breaking the whole evaluation if one address
    # was unresolvable.
    staff_coords = [
        member["coordinates"]
        for member in remaining_pool
        if member.get("coordinates") is not None
    ]

    if not staff_coords:
        return _empty_result

    # The original meeting point is always the second destination (column 1) in
    # every matrix call, so we build it once and reuse it for all candidates.
    mp_destination = {"lat": meeting_point["lat"], "lng": meeting_point["lng"]}

    # -------------------------------------------------------------------------
    # Evaluate each candidate.
    # We keep track of the best qualifying candidate seen so far and its score.
    # -------------------------------------------------------------------------
    best_candidate              = None
    best_exclusively_prefer_count = 0

    for candidate in candidates:
        candidate_destination = {"lat": candidate["lat"], "lng": candidate["lng"]}

        # One Distance Matrix call: N staff × 2 destinations (candidate + original PE).
        # "transit" mode returns public-transport travel times — the metric that
        # matters for staff who travel to meeting points independently of the car.
        matrix = calculate_distances(
            origins=staff_coords,
            destinations=[candidate_destination, mp_destination],
            mode="transit",
        )

        rows = matrix.get("rows", [])

        # -------------------------------------------------------------------------
        # Per-employee analysis.
        # all_can_reach:            True until we find one employee who can't make it.
        # exclusively_prefer_count: incremented for each employee who saves enough
        #                           time by going to the candidate instead of the PE.
        # -------------------------------------------------------------------------
        all_can_reach            = True
        exclusively_prefer_count = 0

        for row in rows:
            elements = row.get("elements", [])

            # Column 0: employee → candidate PEA
            # Column 1: employee → original meeting point
            # If the API returns fewer than 2 elements, the data is incomplete —
            # treat the candidate as unreachable to avoid incorrect conclusions.
            if len(elements) < 2:
                all_can_reach = False
                break

            elem_to_candidate = elements[0]
            elem_to_meeting   = elements[1]

            # Both legs must be OK; ZERO_RESULTS means no transit route was found.
            if elem_to_candidate["status"] != "OK" or elem_to_meeting["status"] != "OK":
                all_can_reach = False
                break

            # Convert seconds → minutes for comparison against config thresholds.
            # Integer division would lose precision; float division is safe here
            # because the thresholds are whole-minute boundaries.
            minutes_to_candidate = elem_to_candidate["duration"]["value"] / 60
            minutes_to_meeting   = elem_to_meeting["duration"]["value"]   / 60

            # Rule 1: every employee must be able to reach the candidate in time
            if minutes_to_candidate > PEA_MAX_TRANSIT_MINUTES:
                all_can_reach = False
                break

            # Rule 2: count employees who strongly prefer the candidate.
            # "Exclusively prefers" means the savings are large enough that
            # going to the original PE would be a significant burden for them.
            time_saved = minutes_to_meeting - minutes_to_candidate
            if time_saved >= PEA_EXCLUSIVE_DIFF_MINUTES:
                exclusively_prefer_count += 1

        # A candidate is disqualified if any employee cannot reach it, or if
        # fewer staff than the threshold exclusively prefer it over the original PE.
        if not all_can_reach:
            continue

        if exclusively_prefer_count < PEA_MIN_EXCLUSIVE_PREFERENCE:
            continue

        # This candidate qualifies — update the best if it has a higher score.
        # Ties are resolved by order in candidates list (first wins).
        if exclusively_prefer_count > best_exclusively_prefer_count:
            best_exclusively_prefer_count = exclusively_prefer_count
            best_candidate                = candidate

    # -------------------------------------------------------------------------
    # Proximity check for the winning candidate.
    # Haversine gives us a cost-free straight-line distance from the PEA to
    # the original PE — accurate enough for the 10 km threshold.
    # -------------------------------------------------------------------------
    pea_proposed = best_candidate is not None

    if pea_proposed:
        distance_km   = _haversine_distance(
            best_candidate["lat"], best_candidate["lng"],
            meeting_point["lat"],  meeting_point["lng"],
        )
        pea_near_original = distance_km <= PEA_RADIUS_KM
    else:
        pea_near_original = False

    # -------------------------------------------------------------------------
    # Remuneration note: only relevant when a far PEA is proposed, because
    # the driver's paid kilometres typically start from the original meeting
    # point.  A distant PEA could change that reference point.
    # -------------------------------------------------------------------------
    if pea_proposed and not pea_near_original:
        remuneration_note = (
            f"The selected PEA is more than {PEA_RADIUS_KM} km from the "
            f"original meeting point ({meeting_point['name']}). "
            f"Driver pay start point should be reviewed with remuneration."
        )
    else:
        remuneration_note = None

    return {
        "pea_proposed":             pea_proposed,
        "best_candidate":           best_candidate,
        "exclusively_prefer_count": best_exclusively_prefer_count,
        "pea_near_original":        pea_near_original,
        "remuneration_note":        remuneration_note,
    }


def find_pickup_candidate(
    route_polyline:  str,
    remaining_pool:  list[dict],
    meeting_point:   dict,
) -> dict:
    """
    Searches for a single valid pickup point along the driver's route for the
    employee most likely to benefit from one — reducing their commute to the
    event without adding a detour for the driver.

    Why only one pickup per trip?
        The driver's route is fixed; adding multiple stops creates scheduling
        complexity and risks delays at the event.  One carefully chosen pickup
        is the ceiling of what this system proposes.

    Overview of the five-step algorithm:

        Step 1 — Assign the 3 employees closest to the meeting point directly to
                 the PE.  A pickup is only valuable if the employee's home is far
                 from the PE but happens to lie near the driver's route.  The
                 3-closest employees already have a short commute to the PE.

        Step 2 — Among the remaining employees, find the one whose home is
                 closest (by straight-line distance) to any decoded polyline
                 point.  That point on the polyline is the cross-point: the
                 location where the driver naturally passes closest to the
                 employee's home.

        Step 3 — Verify that the pickup is actually worthwhile for the employee
                 by comparing their public-transit times to the cross-point vs
                 to the original meeting point.  Both a maximum transit time and
                 a minimum time-saving threshold must be met.

        Step 4 — Search the Places API (New) for gas stations and restaurants
                 within PICKUP_MAX_DETOUR_METERS of the cross-point.  These are
                 the candidate venues for the physical pickup location.

        Step 5 — Filter the Places API results to keep only venues that lie
                 within PICKUP_MAX_DETOUR_METERS of at least one decoded polyline
                 point.  This removes venues on side streets that would force the
                 driver off the main route.

    Parameters:
        route_polyline (str):      Encoded polyline of the driver's route
                                   (base route for PE scenario; direct route for
                                   PEA scenario).  The polyline is decoded and
                                   used as the geometric reference for all
                                   distance calculations.
        remaining_pool (list[dict]): Staff not yet assigned to a vehicle.
                                   Each employee must have a "coordinates" key
                                   ({"lat": ..., "lng": ...}) added by
                                   geocode_staff().
        meeting_point (dict):      The PE (or PEA) that will be the staging
                                   area.  Must have "lat" and "lng" keys.

    Returns:
        dict: One of two shapes:

        When a valid pickup candidate is found:
        {
            "pickup_candidate": {
                "employee":                        dict,   # full employee dict
                "cross_point":                     {"lat": float, "lng": float},
                "transit_time_to_pickup_minutes":  int,    # from employee home to cross-point
                "transit_time_to_pe_minutes":      int,    # from employee home to meeting point
                "time_saved_minutes":              int,    # pe_time − pickup_time
                "place_options":                   [       # up to PICKUP_TOP_CANDIDATES places
                    {
                        "place_name":    str,
                        "place_address": str,
                        "lat":           float,
                        "lng":           float,
                        "place_types":   list[str],
                    },
                    ...
                ],
            },
            "employees_to_meeting_point": list[dict],  # the 3 closest to PE
            "reason": None,
        }

        When no valid candidate is found:
        {
            "pickup_candidate":           None,
            "employees_to_meeting_point": list[dict],
            "reason":                     str,  # explains why no pickup was assigned
        }
    """
    # -------------------------------------------------------------------------
    # Decode the encoded polyline into a list of (lat, lng) tuples.
    # The polyline library implements the Google Encoded Polyline Algorithm —
    # the same encoding used by Routes API responses.
    # We decode once and reuse the list across all subsequent distance checks.
    # -------------------------------------------------------------------------
    all_points = polyline_lib.decode(route_polyline)  # list of (lat, lng) tuples

    # -------------------------------------------------------------------------
    # Step 1: assign the 3 employees closest to the meeting point to the PE.
    # These employees have a short public-transit commute to the meeting point,
    # so a pickup on the route would save them little time.
    # Employees without geocoded coordinates are sorted to the end (inf distance).
    # -------------------------------------------------------------------------
    def _dist_to_mp(member: dict) -> float:
        coords = member.get("coordinates")
        if coords is None:
            return float("inf")
        return _haversine_distance(
            coords["lat"], coords["lng"],
            meeting_point["lat"], meeting_point["lng"],
        )

    sorted_by_mp_dist = sorted(remaining_pool, key=_dist_to_mp)

    # The 3 shortest-distance employees go directly to the meeting point
    employees_to_meeting_point = sorted_by_mp_dist[:3]

    # If the pool is small enough that everyone is in the top-3, there is no
    # remaining employee to evaluate for a pickup — return immediately.
    if len(remaining_pool) <= 3:
        return {
            "pickup_candidate":           None,
            "employees_to_meeting_point": employees_to_meeting_point,
            "reason":                     "all employees assigned to meeting point",
        }

    # The employees beyond the top-3 are candidates for a pickup assignment
    pickup_pool = sorted_by_mp_dist[3:]

    # -------------------------------------------------------------------------
    # Step 2: find the single pickup candidate — the employee whose home is
    # closest (by Haversine) to any decoded polyline point.
    # For each candidate employee, we find their nearest polyline point and
    # record the minimum distance.  The employee with the global minimum wins.
    # -------------------------------------------------------------------------
    best_employee         = None
    best_cross_point_tuple = None          # (lat, lng) of the nearest polyline point
    best_dist_to_route    = float("inf")   # km to the nearest polyline point

    for member in pickup_pool:
        coords = member.get("coordinates")
        if coords is None:
            continue  # skip employees whose address could not be geocoded

        # Walk every decoded polyline point and find the one closest to this employee
        min_dist    = float("inf")
        nearest_pt  = None

        for pt_lat, pt_lng in all_points:
            d = _haversine_distance(coords["lat"], coords["lng"], pt_lat, pt_lng)
            if d < min_dist:
                min_dist   = d
                nearest_pt = (pt_lat, pt_lng)

        # Update the global best if this employee lives closer to the route
        if min_dist < best_dist_to_route:
            best_dist_to_route     = min_dist
            best_employee          = member
            best_cross_point_tuple = nearest_pt

    # Guard: no valid candidate could be found (all employees lacked coordinates)
    if best_employee is None or best_cross_point_tuple is None:
        return {
            "pickup_candidate":           None,
            "employees_to_meeting_point": employees_to_meeting_point,
            "reason":                     "no eligible employee found beyond meeting-point group",
        }

    cross_point = {"lat": best_cross_point_tuple[0], "lng": best_cross_point_tuple[1]}

    # -------------------------------------------------------------------------
    # Step 3: verify the employee's eligibility via public-transit times.
    # One Distance Matrix call with 1 origin and 2 destinations is more efficient
    # than two separate calls — the API returns both legs in a single response.
    #
    # Origin:       employee's home coordinates
    # Destination 0: cross-point (the pickup location on the route)
    # Destination 1: meeting point (the original PE or PEA)
    # -------------------------------------------------------------------------
    employee_coords = best_employee["coordinates"]
    origin = [{"lat": employee_coords["lat"], "lng": employee_coords["lng"]}]

    matrix = calculate_distances(
        origins=origin,
        destinations=[cross_point, {"lat": meeting_point["lat"], "lng": meeting_point["lng"]}],
        mode="transit",
    )

    elem_to_cross = matrix["rows"][0]["elements"][0]
    elem_to_mp    = matrix["rows"][0]["elements"][1]

    # If either leg has no transit route, the pickup is not viable
    if elem_to_cross["status"] != "OK":
        return {
            "pickup_candidate":           None,
            "employees_to_meeting_point": employees_to_meeting_point,
            "reason": (
                f"No transit route found from employee home to pickup point "
                f"(Distance Matrix status: {elem_to_cross['status']})."
            ),
        }

    if elem_to_mp["status"] != "OK":
        return {
            "pickup_candidate":           None,
            "employees_to_meeting_point": employees_to_meeting_point,
            "reason": (
                f"No transit route found from employee home to meeting point "
                f"(Distance Matrix status: {elem_to_mp['status']})."
            ),
        }

    # Convert seconds → minutes (float precision retained for comparison;
    # int conversion happens only in the final return value)
    transit_to_cross_min = elem_to_cross["duration"]["value"] / 60
    transit_to_mp_min    = elem_to_mp["duration"]["value"]   / 60
    time_saved_min       = transit_to_mp_min - transit_to_cross_min

    # Condition 1: the employee must be able to reach the pickup point in time
    if transit_to_cross_min > PICKUP_MAX_TRANSIT_MINUTES:
        return {
            "pickup_candidate":           None,
            "employees_to_meeting_point": employees_to_meeting_point,
            "reason": (
                f"Transit time to pickup point ({transit_to_cross_min:.0f} min) "
                f"exceeds the limit of {PICKUP_MAX_TRANSIT_MINUTES} min."
            ),
        }

    # Condition 2: the pickup must save a meaningful amount of time vs the PE
    if time_saved_min < PICKUP_MIN_TIME_SAVING_MINUTES:
        return {
            "pickup_candidate":           None,
            "employees_to_meeting_point": employees_to_meeting_point,
            "reason": (
                f"Time saved by pickup ({time_saved_min:.0f} min) is below the "
                f"minimum of {PICKUP_MIN_TIME_SAVING_MINUTES} min."
            ),
        }

    # -------------------------------------------------------------------------
    # Step 4: search the Places API (New) for pickup venues around the cross-point.
    # We look within PICKUP_MAX_DETOUR_METERS metres — a radius tight enough to
    # ensure the venue is reachable from the road without a significant turn-off.
    # -------------------------------------------------------------------------
    places_body = {
        "includedTypes": PICKUP_PLACE_TYPES,
        "locationRestriction": {
            "circle": {
                "center": {
                    "latitude":  cross_point["lat"],
                    "longitude": cross_point["lng"],
                },
                # The API expects a float; cast in case PICKUP_MAX_DETOUR_METERS
                # is defined as an int in config.py (Python float() is harmless
                # on a float, so this is always safe).
                "radius": float(PICKUP_MAX_DETOUR_METERS),
            }
        },
    }
    places_headers = {
        "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
        # Request only the four fields we need — Places API (New) charges
        # per field category; requesting fewer fields reduces cost.
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

    # -------------------------------------------------------------------------
    # Step 5: filter places to keep only those that are genuinely ON the route.
    # The Places API search uses a circular radius around the cross-point, so it
    # may return venues on adjacent side streets.  We check the minimum distance
    # from each venue to any decoded polyline point: if it exceeds
    # PICKUP_MAX_DETOUR_METERS, the venue is off-route and is discarded.
    #
    # Accepted venues are sorted by their distance to the cross-point (ascending)
    # so that the nearest, most convenient location is offered first.
    # -------------------------------------------------------------------------
    on_route_places: list[tuple[float, dict]] = []  # (dist_to_cross_m, place_dict)

    for place in raw_places:
        location  = place.get("location", {})
        place_lat = location.get("latitude",  0.0)
        place_lng = location.get("longitude", 0.0)

        # Find the minimum Haversine distance (km) from this place to any
        # decoded polyline point, then convert to metres for the threshold check.
        min_dist_to_route_km = min(
            _haversine_distance(place_lat, place_lng, pt_lat, pt_lng)
            for pt_lat, pt_lng in all_points
        )
        min_dist_to_route_m = min_dist_to_route_km * 1000

        # Discard venues that are farther than PICKUP_MAX_DETOUR_METERS from the
        # route — they would require the driver to make a turn off the main road.
        if min_dist_to_route_m > PICKUP_MAX_DETOUR_METERS:
            continue

        # Compute the distance from this venue to the cross-point for ordering
        dist_to_cross_m = (
            _haversine_distance(place_lat, place_lng, cross_point["lat"], cross_point["lng"])
            * 1000
        )
        on_route_places.append((dist_to_cross_m, place, place_lat, place_lng))

    # Sort ascending by distance to cross-point so the most convenient venue leads
    on_route_places.sort(key=lambda x: x[0])

    # Build the final list limited to PICKUP_TOP_CANDIDATES entries
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
            "employee":                       best_employee,
            "cross_point":                    cross_point,
            # int() truncates the float — consistent with the spec and with how
            # the Distance Matrix API works (durations are whole seconds).
            "transit_time_to_pickup_minutes": int(transit_to_cross_min),
            "transit_time_to_pe_minutes":     int(transit_to_mp_min),
            "time_saved_minutes":             int(time_saved_min),
            "place_options":                  place_options,
        },
        "employees_to_meeting_point": employees_to_meeting_point,
        "reason":                     None,
    }
