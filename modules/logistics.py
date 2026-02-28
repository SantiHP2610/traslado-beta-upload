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

import unicodedata

# Import all thresholds and keywords from the central constants file.
# Using named constants instead of magic numbers makes the rules self-documenting
# and easy to change in one place without hunting through logic code.
from config import MENU_KEYWORDS, SECOND_MINIFLETE_CONDITIONS


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
