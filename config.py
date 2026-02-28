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

# --- Meeting point parameters ---
# PEA_MAX_TRANSIT_MINUTES: maximum acceptable transit time (in minutes)
#   from a staff member's home to a meeting point.  Beyond this, the
#   meeting point is considered too far for that employee.
# PEA_RADIUS_KM: maximum km difference between (PEA → event) distance and
#   (original meeting point → event) distance.  If within this threshold,
#   the PEA is flagged "optimal"; beyond it, flagged "consult_remuneration"
#   (affects where driver pay starts).
# PEA_MIN_EXCLUSIVE_PREFERENCE: minimum number of staff members who must
#   exclusively prefer the PEA for it to be proposed.  "Exclusively prefer"
#   means the original meeting point takes them >PEA_MAX_TRANSIT_MINUTES but
#   the PEA takes them ≤PEA_MAX_TRANSIT_MINUTES.  Full condition: ALL staff
#   must prefer the PEA AND at least this many must exclusively prefer it.
# PICKUP_MIN_TIME_SAVING_MINUTES: minimum time (minutes) a direct pickup
#   must save compared to the meeting-point route to justify the detour.
PEA_MAX_TRANSIT_MINUTES = 25
PEA_RADIUS_KM = 10
PEA_MIN_EXCLUSIVE_PREFERENCE = 2
PICKUP_MIN_TIME_SAVING_MINUTES = 20
