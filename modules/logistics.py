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
    PICADA_GUEST_THRESHOLD,
    SECOND_MINIFLETE_CONDITIONS,
)


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
