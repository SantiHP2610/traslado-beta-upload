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
LOADING_TIME_MINUTES = 50
EVENT_PREP_HOURS = 4
EVENT_PREP_HOURS_WITH_PICADA = 2
PICADA_THRESHOLD_GUESTS = 100

# --- Alternative Meeting Point (PEA) parameters ---
PEA_MAX_TRANSIT_MINUTES = 25       # max travel time by public transit to PEA to be "convenient"
PEA_EXCLUSIVE_DIFF_MINUTES = 20    # min difference (in minutes) between transit time to PE
                                    # and transit time to PEA to count as "exclusively prefers PEA"
PEA_MIN_EXCLUSIVE_PREFERENCE = 2   # min number of staff who must exclusively prefer PEA
                                    # for it to be proposed to the user
PEA_RADIUS_KM = 10                 # straight-line km from PEA candidate to original PE;
                                    # ≤ this → flagged "optimal"; > this → "consult_remuneration"

# --- Pickup point parameters (Step 7) ---
PICKUP_MIN_TIME_SAVING_MINUTES = 20 # min minutes saved vs going to PE to assign a pickup point
PICKUP_MAX_DETOUR_METERS = 300      # Places API search radius (m) around the cross-point AND
                                    # max straight-line distance (m) from a place to any polyline
                                    # point to count as "on the route" (not on a side street)
PICKUP_MAX_TRANSIT_MINUTES = 30     # max transit time (min) from employee home to pickup point
PICKUP_TOP_CANDIDATES = 3           # number of top place options returned per pickup candidate,
                                    # ordered by distance to cross-point ascending

# Place types searched by Places API for pickup point candidates.
# "gas_station" targets 24hs service stations on main roads.
# "restaurant" is used as a proxy for McDonald's 24hs — Places API has no
# specific type for fast food chains. Refine post-deployment if needed.
PICKUP_PLACE_TYPES = ["gas_station", "restaurant"]

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
LOADING_TIME_MINUTES = 50
LONG_EVENT_EXTRA_HOURS = 2
LONG_EVENT_DURATION_THRESHOLD = 8   # event duration in hours that triggers extra prep
PICADA_GUEST_THRESHOLD = 100        # guest count that triggers extra prep
