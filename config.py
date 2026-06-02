# =============================================================================
# config.py
# Business-rule constants for the catering logistics app.
#
# This file contains ONLY values — no logic, no imports, no functions.
# Centralising constants here gives us a single place to update business
# rules without touching the modules that enforce them.
# =============================================================================


# --- Frescos / minifletes ---
# Thresholds (number of guests) above which a second miniflete is required
# to transport the raw ingredients (frescos) to the event venue.
SECOND_MINIFLETE_CONDITIONS = {
    "asado_tradicional_threshold": 60,
    "asado_finger_food_threshold": 70,
    "bebidas_threshold": 20,
}

# --- Keywords to match against Excel 'prestaciones' sheet ---
# Comparison is always done after .lower().strip() (+ accent removal in code).
# Keeping the Spanish strings here — they are data that must match the
# client's Excel vocabulary, not variable names.
MENU_KEYWORDS = {
    "asado_tradicional": "asado tradicional",
    "asado_finger_food": "asado finger food",
    "bebidas": "acompañamiento bebidas",
    "estacion_fuegos": "estacion de fuegos",
    # "picada" is a starter spread served before the main course.
    # When contracted AND guest count is high, extra prep time is needed
    # for both the CP departure and the PE/PEA departure.
    "picada": "picada",
}

# --- Vehicle capacity ---
# Maximum number of passengers that can ride in a single car or Uber.
# When total passengers exceed CHARTER_THRESHOLD, a charter bus is considered.
# Passengers only — excludes the driver.
# Total vehicle capacity = MAX_PASSENGERS_PER_CAR + 1 (driver included).
MAX_PASSENGERS_PER_CAR = 4

# Passengers only — excludes the Uber driver (external).
# Total capacity is also 5 but the driver is never from our staff.
MAX_PASSENGERS_UBER = 4
CHARTER_THRESHOLD = 8
CHARTER_MAX_PICKUPS = 2    # maximum pickup stops allowed for charter bus routing

# --- Time parameters (minutes) ---
# DEPARTURE_BUFFER_MINUTES: extra margin added before the calculated
#   departure time to account for last-minute delays.
# LOADING_TIME_MINUTES: time required to load equipment / frescos into
#   the vehicle before departing.
# EVENT_PREP_HOURS: how many hours before the event start the team must
#   arrive at the venue to set up (standard case).
# EVENT_PREP_HOURS_WITH_PICADA: reduced setup time when a picada (starter
#   spread) is included, because the team can begin service earlier.
# PICADA_THRESHOLD_GUESTS: guest count above which a picada is considered
#   mandatory and the shorter prep window applies.
DEPARTURE_BUFFER_MINUTES = 10
LOADING_TIME_MINUTES = 50  # Default suggested loading time at the CP (minutes).
                            # Shown as editable in the confirmation modal — the manager
                            # confirms or adjusts before final output is calculated.
EVENT_PREP_HOURS = 4
EVENT_PREP_HOURS_WITH_PICADA = 2
PICADA_THRESHOLD_GUESTS = 100

# --- Alternative Meeting Point (PEA) parameters ---
#
# These constants inform the UI — they do not gate the flow.
# All PEA candidates are evaluated and the top 3 are returned regardless of
# whether any threshold is crossed.  The values below control how warning
# flags and informational counts are computed so the manager has the context
# to make the final call.  The system does not decide for them.
PEA_MAX_TRANSIT_MINUTES = 25       # threshold used to populate the per-employee
                                    # "exceeds_max_transit" warning flag in staff_metrics;
                                    # flagged employees may find the PEA inconvenient,
                                    # but the candidate is still returned for the manager to assess
PEA_EXCLUSIVE_DIFF_MINUTES = 22    # difference (in minutes) between transit time to PE and
                                    # transit time to PEA at which an employee is counted as
                                    # "exclusively preferring" the PEA; populates the informational
                                    # exclusively_prefer_count field shown to the manager
PEA_MIN_EXCLUSIVE_PREFERENCE = 2   # reference value shown alongside exclusively_prefer_count
                                    # in the UI so the manager can gauge whether enough staff
                                    # benefit from the PEA to make it worthwhile; does not
                                    # filter or suppress any candidate
PEA_RADIUS_KM = 10                 # straight-line km from each PEA candidate to the original PE;
                                    # ≤ this → candidate flagged "optimal" (no remuneration review);
                                    # > this → candidate flagged "consult_remuneration";
                                    # computed per candidate — all candidates are returned regardless
PEA_ROUTE_PROXIMITY_KM = 5        # max straight-line distance (km) from an employee's home to the
                                    # nearest polyline vertex of the driver's direct route for that
                                    # employee to be considered "near the route" and eligible for PEA
                                    # evaluation.  Employees farther than this are excluded — a PEA
                                    # along the route would not save them meaningful transit time.
                                    # If no employee qualifies, evaluate_pea_candidates() returns
                                    # immediately with zero Places API calls.
CLUSTER_RADIUS_KM = 8              # radius (km) used by evaluate_pea_candidates() to group employees
                                    # into geographic clusters before PEA evaluation.  Employees whose
                                    # home is within this radius of a cluster's seed point are placed
                                    # in the same cluster so each PEA candidate is evaluated against a
                                    # geographically coherent group, not a global compromise across
                                    # employees who live in opposite parts of Buenos Aires.
MIN_CLUSTER_SIZE = 2               # minimum number of employees in a geographic cluster for it to
                                    # be eligible for PEA evaluation.  A cluster of 1 means the PEA
                                    # would only benefit a single person — not worth the detour.
                                    # Increase if PEA should only be proposed for larger groups.

# --- Pickup point parameters (Step 7) ---
#
# These constants inform the UI — they do not gate the flow.
# find_pickup_candidate() always returns a result when it is technically
# possible (i.e. the Distance Matrix can route the employee).  The values
# below control how warning flags are computed so the manager has the
# context to decide whether the pickup makes sense for this specific event
# and employee.  The system does not suppress results on their behalf.
PICKUP_MIN_TIME_SAVING_MINUTES = 20 # threshold used to populate the "time_saving_warning" flag
                                    # in the pickup result; if the employee saves fewer minutes
                                    # than this by going to the cross-point instead of the PE,
                                    # the flag is True so the manager can weigh the trade-off
PICKUP_MAX_DETOUR_METERS = 500      # Places API search radius (m) around the cross-point AND
                                    # max straight-line distance (m) from a place to any polyline
                                    # point to count as "on the route" (not on a side street)
PICKUP_MAX_TRANSIT_MINUTES = 30     # threshold used to populate the "transit_warning" flag
                                    # in the pickup result; if the employee's transit time to
                                    # the cross-point exceeds this, the flag is True so the
                                    # manager can consider whether the trip is practical
PICKUP_TOP_CANDIDATES = 3           # number of top place options returned per pickup candidate,
                                    # ordered by distance to cross-point ascending

# Place types searched by the first pickup Places API call (searchNearby).
# Gas stations are included unconditionally — they are open 24hs by nature.
PICKUP_PLACE_TYPES = ["gas_station"]

# Keyword for the second pickup Places API call (searchText).
# McDonald's locations open 24hs are included; non-24hr branches are filtered
# by checking currentOpeningHours.weekdayDescriptions for "24 hours".
PICKUP_KEYWORD = "McDonald's"

# --- Production Center (CP — Centro de Producción) ---
# Physical address where frescos and equipment are loaded before each event.
# Coordinates obtained from Google Maps — update if the CP address changes.
CP_ADDRESS = "Gral. Conesa 640, Ramos Mejía, Buenos Aires"
CP_LAT = -34.65289155977212
CP_LNG = -58.56475066030458

# --- Departure time formula parameters ---
# All time values are in minutes unless the variable name says _HOURS.
# Formula: departure = event_time - PREP_HOURS - travel_time - BUFFER - LOADING
# If event duration >= LONG_EVENT_DURATION_THRESHOLD hours
# OR picada guests >= PICADA_GUEST_THRESHOLD: subtract LONG_EVENT_EXTRA_HOURS too.
DEPARTURE_PREP_HOURS = 4
DEPARTURE_BUFFER_MINUTES = 10
LOADING_TIME_MINUTES = 50  # Default suggested loading time at the CP (minutes).
                            # Shown as editable in the confirmation modal — the manager
                            # confirms or adjusts before final output is calculated.
LONG_EVENT_EXTRA_HOURS = 2
LONG_EVENT_DURATION_THRESHOLD = 8   # event duration in hours that triggers extra prep
PICADA_GUEST_THRESHOLD = 100        # guest count that triggers extra prep

# --- Night warning threshold ---
# Hour (24h format) at or after which a calculated return time triggers a
# safety warning in the CABA panel ("Evaluar seguridad de la zona").
NIGHT_WARNING_HOUR = 23

# --- Event duration ---
# When no explicit duration indicator is found in the Excel, this default
# is used for the departure-time formula and the CABA return-time estimate.
DEFAULT_EVENT_DURATION_HOURS = 4   # standard event without a duration tag
LONG_SERVICE_DURATION_HOURS  = 8   # duration when "(8hs)" appears in Menu or Detalle
PREP_HOURS_BEFORE_EVENT      = 4   # hours staff must arrive before event start for setup

# --- CABA (Ciudad Autónoma de Buenos Aires) neighborhood and common names ---
# Used by is_event_in_caba() to decide whether staff can self-commute.
# Comparison is done after strip().lower().rstrip(".") on the ciudad_evento field.
CABA_NAMES = {
    "caba", "capital federal", "c.a.b.a.", "ciudad de buenos aires",
    "ciudad autonoma de buenos aires", "ciudad autónoma de buenos aires",
    "palermo", "belgrano", "nuñez", "núñez", "recoleta", "retiro",
    "san telmo", "san nicolás", "san nicolas", "monserrat", "montserrat",
    "puerto madero", "la boca", "barracas", "constitución", "constitucion",
    "san cristóbal", "san cristobal", "balvanera", "almagro", "boedo",
    "caballito", "flores", "floresta", "vélez sársfield", "velez sarsfield",
    "liniers", "mataderos", "parque avellaneda", "villa lugano",
    "villa soldati", "villa riachuelo", "nueva pompeya", "parque patricios",
    "parque chacabuco", "villa del parque", "villa devoto", "villa pueyrredón",
    "villa pueyrredon", "villa urquiza", "saavedra", "coghlan", "colegiales",
    "chacarita", "villa crespo", "paternal", "villa ortúzar", "villa ortuzar",
    "agronomía", "agronomia", "parque chas", "villa real", "versalles",
    "villa luro", "monte castro", "villa santa rita", "villa general mitre",
}

# --- Charter service contacts ---
# Shown in CharterPanel when the remaining staff pool exceeds CHARTER_THRESHOLD.
# Each entry has a display name and a phone number.
CHARTER_PHONE_LIST = [
    {"name": "Transfer Express",    "phone": "(011) 4555-0100"},
    {"name": "Buenos Aires Bus",    "phone": "(011) 4314-5555"},
    {"name": "Chevallier Integral", "phone": "(011) 4000-5255"},
]
