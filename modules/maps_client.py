# =============================================================================
# maps_client.py
# Client module for Google Maps APIs.
# Provides geocoding, distance matrix, meeting-point, and route utilities.
#
# All functions in this module require the environment variable
# GOOGLE_MAPS_API_KEY to be set in .env at the project root.
#
# APIs used:
#   - Geocoding API:        https://developers.google.com/maps/documentation/geocoding
#   - Distance Matrix API:  https://developers.google.com/maps/documentation/distance-matrix
#   - Routes API:           https://developers.google.com/maps/documentation/routes
# =============================================================================

import os
import math

import httpx
import polyline as polyline_lib
from dotenv import load_dotenv

from config import CP_LAT, CP_LNG  # noqa: F401 — available for route calculations from the CP
from modules.api_cache    import get as cache_get, put as cache_put
from modules              import employee_cache

# Load the variables defined in .env into the process environment.
# This call is safe to repeat — if load_dotenv() was already called by
# main.py, the values are already in os.environ and this is a no-op.
load_dotenv()

# Read the Google Maps API key once at module load time.
# All functions in this module share this single key.
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "")

# -----------------------------------------------------------------------------
# Fixed meeting-point constants.
# These are predefined staging areas in Buenos Aires (CABA) used as
# potential gathering points for staff before travelling to the event venue.
# nearest_meeting_point() picks the one closest (by driving time) to the event.
# -----------------------------------------------------------------------------
MEETING_POINTS = [
    {
        "name": "North - Puente Saavedra",
        "address": "Av. General Paz y Av. Cabildo, Saavedra, Buenos Aires",
        "lat": -34.5441,
        "lng": -58.4901,
    },
    {
        "name": "South - Caballito",
        "address": "Av. Rivadavia y Av. Emilio Mitre, Caballito, Buenos Aires",
        "lat": -34.6193,
        "lng": -58.4380,
    },
    {
        "name": "West - Ramos Mejia",
        "address": "McDonald's Ramos Mejía, Av. de Mayo 1200, Ramos Mejía, Buenos Aires",
        "lat": -34.6441,
        "lng": -58.5631,
    },
]

# Base URLs for the Google Maps APIs we call.
# Keeping them as module-level constants makes them easy to update or mock.
_GEOCODING_URL      = "https://maps.googleapis.com/maps/api/geocode/json"
_DISTANCE_MATRIX_URL = "https://maps.googleapis.com/maps/api/distancematrix/json"
# The Routes API uses a different base domain and accepts POST with a JSON body,
# unlike the older APIs above which use GET with query parameters.
_ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"
# Routes API v2 route matrix — supports arrivalTime for driving mode.
# Used instead of the Distance Matrix API for driving calls that need
# historical-traffic accuracy.  See compute_route_matrix().
_ROUTE_MATRIX_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix"
# The Places API (New) nearby search also uses POST with a JSON body.
# "New" refers to the updated Places API launched in 2023 — it has a different
# endpoint structure and field-mask pattern from the legacy Places API.
_PLACES_NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby"

# How many points to skip between sampled points on the decoded polyline.
# Sampling every 5th point balances coverage against the number of Places API
# calls made: too few samples may miss stations; too many waste quota.
_POLYLINE_SAMPLE_STEP = 5

# Search radius in metres around each sampled polyline point.
# 300 m is roughly a 4-minute walk — tight enough to stay on-route,
# wide enough to catch stations slightly off the road centreline.
_PLACES_SEARCH_RADIUS = 300.0

# Place types we accept as PEA candidates.
# These map to Google Places type identifiers for public transport hubs.
_PEA_PLACE_TYPES = [
    "transit_station",
    "subway_station",
    "train_station",
    "bus_station",
]


# =============================================================================
# Public API
# =============================================================================

def geocode(address: str) -> dict | None:
    """
    Converts a free-text address into geographic coordinates using the
    Google Geocoding API.

    The API receives the address string and returns a list of matching
    places. We take the first (most relevant) result and extract latitude,
    longitude, and the normalized address string that Google resolved.

    Parameters:
        address (str): Free-text address to geocode
                       (e.g. "Av. Corrientes 3421, 1193, CABA").

    Returns:
        dict: { "lat": float, "lng": float, "formatted_address": str }
              if the address was found and resolved.
        None: if the API returns no results or an error status.
    """
    # --- Cache check ---
    cached = cache_get("geocode", address)
    if cached is not None:
        return cached["data"]

    # Build the query parameters for the HTTP GET request
    params = {
        "address": address,
        "key": GOOGLE_MAPS_API_KEY,
    }

    # httpx.get() performs a synchronous HTTP GET request.
    # raise_for_status() raises an httpx.HTTPStatusError for 4xx/5xx responses.
    response = httpx.get(_GEOCODING_URL, params=params)
    response.raise_for_status()

    # The Geocoding API always returns HTTP 200; success or failure is
    # indicated by the "status" field inside the JSON body.
    data = response.json()

    # Common non-OK statuses: "ZERO_RESULTS" (address not found),
    # "INVALID_REQUEST", "REQUEST_DENIED" (bad API key), etc.
    if data["status"] != "OK":
        cache_put("geocode", None, address)
        return None

    # The results list is ordered by relevance; the first entry is the best match
    first_result = data["results"][0]

    # The lat/lng values are nested inside geometry → location
    location = first_result["geometry"]["location"]

    result = {
        "lat": location["lat"],
        "lng": location["lng"],
        # "formatted_address" is the canonical address string Google resolved to
        "formatted_address": first_result["formatted_address"],
    }
    cache_put("geocode", result, address)
    return result


def geocode_staff(staff: list[dict]) -> list[dict]:
    """
    Geocodes every employee in the staff list returned by read_excel().

    For each employee the full address is built by concatenating three
    columns from the Excel 'equipo' sheet:
        Direccion (street address)  +  CP (postal code)  +  Ciudad (city)

    The resulting coordinates dict (or None on failure) is stored in a new
    "coordinates" key on the employee dict.  The original list is modified
    in-place and also returned, so callers can chain or ignore the return value.

    ── Employee cache ────────────────────────────────────────────────────────
    Before calling the Geocoding API, each employee is checked against
    employees.json via employee_cache.lookup().  Three outcomes:

      dict    — cache hit with valid coords → use directly, skip API call.
      None    — cache hit recording a prior geocoding failure → skip API call,
                leave coordinates as None so the map skips this marker.
      MISSING — not yet geocoded → call the API and persist the result.

    This means the Geocoding API is called at most once per unique
    (name, address) combination across all events.

    Parameters:
        staff (list[dict]): List of employee dicts as returned by read_excel().
                            Expected keys per employee: "Nombre", "Apellido",
                            "Direccion", "CP", "Ciudad".

    Returns:
        list[dict]: Same list with a "coordinates" key added to each employee.
                    Value is { "lat": ..., "lng": ..., "formatted_address": ... }
                    or None if geocoding failed for that employee.
    """
    for employee in staff:
        nombre   = str(employee.get("Nombre",   "")).strip()
        apellido = str(employee.get("Apellido", "")).strip()

        # Build the full address string from the three address columns.
        # strip() guards against accidental leading/trailing whitespace.
        street   = str(employee.get("Direccion", "")).strip()
        zip_code = str(employee.get("CP",        "")).strip()
        city     = str(employee.get("Ciudad",    "")).strip()

        # ── Employee cache check ─────────────────────────────────────────────
        # lookup() returns MISSING when the address has never been geocoded,
        # None when geocoding previously failed, or a coords dict on success.
        cached = employee_cache.lookup(nombre, apellido, street, zip_code, city)

        if cached is not employee_cache.MISSING:
            # Cache hit — valid coords (dict) or recorded failure (None).
            # Either way, skip the Geocoding API call.
            employee["coordinates"] = cached
            print(f"[employee_cache] HIT: {nombre} {apellido}")
            continue

        # ── Cache miss — call the Geocoding API and persist the result ───────
        full_address = f"{street}, {zip_code}, {city}"
        coords = geocode(full_address)
        employee["coordinates"] = coords
        employee_cache.save(nombre, apellido, street, zip_code, city, coords)

    return staff


def calculate_distances(
    origins: list[dict],
    destinations: list[dict],
    mode: str = "driving",
) -> dict:
    """
    Calls the Google Distance Matrix API to compute travel times and
    distances between every origin/destination pair in a single request.

    The API accepts N origins and M destinations and returns an N×M matrix
    where element [i][j] is the travel data from origins[i] to destinations[j].

    Parameters:
        origins (list[dict]):      Coordinate dicts {"lat": float, "lng": float}.
        destinations (list[dict]): Coordinate dicts {"lat": float, "lng": float}.
        mode (str):                Travel mode passed to the API.  Common values:
                                   "driving" (default), "transit", "walking",
                                   "bicycling".  PEA evaluation (Step 6) passes
                                   "transit" to compare public-transport times.

    Returns:
        dict: Full JSON response from the Distance Matrix API, which includes:
                - "origin_addresses":      list of resolved origin strings
                - "destination_addresses": list of resolved destination strings
                - "rows": list of row dicts, each with an "elements" list where
                  every element contains:
                    { "distance": {"value": <meters>, "text": "..."},
                      "duration": {"value": <seconds>, "text": "..."},
                      "status":   "OK" | "ZERO_RESULTS" | ... }
    """
    # --- Cache check ---
    # Key includes the pipe-formatted coordinates and mode so identical
    # origin/destination/mode combos return the same cached result.
    cached = cache_get("calculate_distances", origins, destinations, mode)
    if cached is not None:
        return cached["data"]

    # The Distance Matrix API expects coordinates as a pipe-separated string:
    # "lat1,lng1|lat2,lng2|..."
    # This inner helper formats a list of coordinate dicts into that format.
    def coords_to_pipe_string(coords_list: list[dict]) -> str:
        return "|".join(f"{c['lat']},{c['lng']}" for c in coords_list)

    params = {
        "origins":      coords_to_pipe_string(origins),
        "destinations": coords_to_pipe_string(destinations),
        # The mode parameter controls how the API calculates travel times.
        # "driving" uses road network; "transit" uses public transport timetables.
        "mode":         mode,
        "key":          GOOGLE_MAPS_API_KEY,
    }

    response = httpx.get(_DISTANCE_MATRIX_URL, params=params)
    response.raise_for_status()

    # Return the full JSON body; callers decide which fields they need
    result = response.json()
    cache_put("calculate_distances", result, origins, destinations, mode)
    return result


def compute_route_matrix(
    origins: list[dict],
    destinations: list[dict],
    arrival_time: str | None = None,
    mode: str = "DRIVE",
) -> dict:
    """
    Calls the Routes API v2 computeRouteMatrix endpoint to compute travel times
    and distances between every origin/destination pair.

    Unlike the Distance Matrix API (GET + query params), this endpoint uses
    POST + JSON and returns a flat list of RouteMatrixElement objects.
    The response is normalised here into the same rows/elements shape that
    calculate_distances() returns so all callers work without modification.

    Why this endpoint instead of calculate_distances() for driving calls?
        computeRouteMatrix supports arrivalTime — the Routes API works backwards
        from a known deadline and applies historical traffic for that hour and
        day of week.  The legacy Distance Matrix API only accepts departureTime
        for driving, which requires guessing the departure time to get accurate
        traffic predictions: a circular dependency.

    Why calculate_distances() is still used for transit and nearest-meeting-point?
        Transit routing does not support routingPreference or arrivalTime in the
        computeRouteMatrix endpoint.  nearest_meeting_point() is a relative
        comparison between three fixed points; traffic ratios between them are
        stable and arrivalTime would add latency without changing the result.

    Parameters:
        origins      (list[dict]): Coordinate dicts {"lat": float, "lng": float}.
        destinations (list[dict]): Coordinate dicts {"lat": float, "lng": float}.
        arrival_time (str | None): ISO 8601 UTC string for when vehicles must
                                   arrive at the destination, e.g.
                                   "2025-06-15T16:00:00Z".  If None, current
                                   traffic conditions are used.
        mode         (str):        Travel mode — "DRIVE" (default).

    Returns:
        dict: Normalised Distance Matrix shape:
              {
                "rows": [
                  {
                    "elements": [
                      {
                        "status":   "OK" | "NOT_FOUND",
                        "duration": {"value": <seconds int>},
                        "distance": {"value": <meters int>},
                      },
                      ...
                    ]
                  },
                  ...
                ]
              }
    """
    # --- Cache check ---
    cached = cache_get("compute_route_matrix", origins, destinations, arrival_time, mode)
    if cached is not None:
        return cached["data"]

    n_origins = len(origins)
    n_dests   = len(destinations)

    # The computeRouteMatrix API wraps each coordinate in a "waypoint" envelope
    # rather than accepting the pipe-separated "lat,lng" strings of the older API.
    def _waypoint(coords: dict) -> dict:
        return {
            "waypoint": {
                "location": {
                    "latLng": {
                        "latitude":  coords["lat"],
                        "longitude": coords["lng"],
                    }
                }
            }
        }

    body: dict = {
        "origins":           [_waypoint(o) for o in origins],
        "destinations":      [_waypoint(d) for d in destinations],
        "travelMode":        mode,
        # TRAFFIC_AWARE applies historical + real-time traffic data.
        # Only valid for DRIVE; omit for TRANSIT (handled by calculate_distances).
        "routingPreference": "TRAFFIC_AWARE",
    }

    if arrival_time:
        # arrivalTime tells the API the latest time vehicles must be at the
        # destination.  It then picks the departure window that meets this
        # deadline using historical traffic for that time of day and weekday.
        body["arrivalTime"] = arrival_time

    headers = {
        "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
        # Request only the fields we use — unused fields waste bandwidth.
        "X-Goog-FieldMask": (
            "originIndex,destinationIndex,"
            "duration,distanceMeters,"
            "status,condition"
        ),
    }

    response = httpx.post(_ROUTE_MATRIX_URL, json=body, headers=headers)
    response.raise_for_status()

    # The API returns a flat JSON array of RouteMatrixElement objects.
    # Unlike the Distance Matrix's nested rows/elements structure, elements
    # can arrive in any order and are identified by originIndex/destinationIndex.
    elements_flat = response.json()

    # Initialise an N×M grid of NOT_FOUND entries.
    # Elements not overwritten by a real API result stay as NOT_FOUND.
    def _not_found() -> dict:
        return {
            "status":   "NOT_FOUND",
            "duration": {"value": 0},
            "distance": {"value": 0},
        }

    rows = [
        {"elements": [_not_found() for _ in range(n_dests)]}
        for _ in range(n_origins)
    ]

    for elem in elements_flat:
        oi = elem.get("originIndex", 0)
        di = elem.get("destinationIndex", 0)

        # The Routes API uses Google's RPC Status proto:
        # {"code": 0} (or an absent "status" field) means success.
        # Any non-zero code means the route could not be computed.
        # "condition" ROUTE_EXISTS / ROUTE_NOT_FOUND distinguishes a valid route
        # from a status-OK element where no path exists.
        status_obj = elem.get("status") or {}
        condition  = elem.get("condition", "")

        if status_obj.get("code", 0) == 0 and condition == "ROUTE_EXISTS":
            rows[oi]["elements"][di] = {
                "status":   "OK",
                # Duration is returned as e.g. "1234s" — strip the unit suffix.
                "duration": {"value": int(elem["duration"].rstrip("s"))},
                "distance": {"value": elem.get("distanceMeters", 0)},
            }
        # else: leave as NOT_FOUND (already initialised above)

    result = {"rows": rows}
    cache_put("compute_route_matrix", result, origins, destinations, arrival_time, mode)
    return result


def nearest_meeting_point(event_coordinates: dict) -> dict:
    """
    Finds which of the three predefined CABA meeting points is closest
    (by driving time) to the event venue.

    Strategy:
        1. Use the event coordinates as the single origin.
        2. Use all three MEETING_POINTS as destinations.
        3. Call calculate_distances() to get the 1×3 travel-time matrix.
        4. Iterate over the results and pick the point with the lowest
           duration value (in seconds).

    Parameters:
        event_coordinates (dict): { "lat": float, "lng": float }
                                  Coordinates of the event venue,
                                  as returned by geocode().

    Returns:
        dict: The winning MEETING_POINTS entry enriched with travel data:
              {
                "name":             str,   # e.g. "North - Puente Saavedra"
                "address":          str,   # e.g. "Av. General Paz y Av. Cabildo, Saavedra, Buenos Aires"
                "lat":              float,
                "lng":              float,
                "duration_seconds": int,   # driving time in seconds
                "duration_text":    str,   # human-readable, e.g. "9 mins"
                "distance_meters":  int,   # driving distance in meters
                "distance_text":    str,   # human-readable, e.g. "4.2 km"
              }

    Raises:
        ValueError: If the Distance Matrix API returns no valid route for
                    any of the three meeting points.
    """
    # Build the list of destination coordinates from the constant
    destinations = [{"lat": mp["lat"], "lng": mp["lng"]} for mp in MEETING_POINTS]

    # The event venue is the single origin; wrap it in a list as the API
    # always expects a list even when there is only one origin
    origins = [event_coordinates]

    # Request the distance matrix (1 origin × 3 destinations)
    matrix = calculate_distances(origins, destinations)

    # The matrix has exactly one row (one origin).
    # Each element in that row corresponds to one destination (meeting point).
    elements = matrix["rows"][0]["elements"]

    # Walk through all three elements and track the one with the shortest drive.
    # We start best_duration at infinity so the first valid result always wins.
    best_index = None
    best_duration = float("inf")

    for index, element in enumerate(elements):
        # The API marks an element as "OK" only when a driving route was found.
        # Other statuses ("ZERO_RESULTS", "NOT_FOUND") mean no route is available.
        if element["status"] != "OK":
            continue  # skip unreachable meeting points

        duration_seconds = element["duration"]["value"]  # driving time in seconds

        if duration_seconds < best_duration:
            best_duration = duration_seconds
            best_index = index

    # If no valid route was found for any of the three points, raise an error
    # with a descriptive message so callers can surface it to the user.
    if best_index is None:
        raise ValueError(
            "No reachable meeting point found for the given event coordinates."
        )

    # Build the result by merging the meeting point's metadata with the
    # travel data the API returned for that specific origin/destination pair
    winning_point   = MEETING_POINTS[best_index]
    winning_element = elements[best_index]

    return {
        "name":             winning_point["name"],
        "address":          winning_point["address"],
        "lat":              winning_point["lat"],
        "lng":              winning_point["lng"],
        "duration_seconds": winning_element["duration"]["value"],
        "duration_text":    winning_element["duration"]["text"],
        "distance_meters":  winning_element["distance"]["value"],
        "distance_text":    winning_element["distance"]["text"],
    }


# =============================================================================
# Routes API — private helpers
# =============================================================================

def _latLng(coords: dict) -> dict:
    """
    Converts a flat {"lat": float, "lng": float} dict into the nested location
    structure the Routes API expects in origin, destination, and intermediates.

    The Routes API uses a different coordinate format from the older Distance
    Matrix API (which accepts "lat,lng" pipe-separated strings).  Centralising
    this conversion prevents the nesting from being repeated in every request.

    Parameters:
        coords (dict): {"lat": float, "lng": float}

    Returns:
        dict: {"location": {"latLng": {"latitude": float, "longitude": float}}}
    """
    return {
        "location": {
            "latLng": {
                "latitude":  coords["lat"],
                "longitude": coords["lng"],
            }
        }
    }


def _call_routes_api(body: dict) -> dict:
    """
    POSTs a request to the Routes API and returns the parsed JSON response.

    Unlike the older Maps APIs that use GET with query parameters, the Routes
    API uses POST with a JSON body.  Authentication and field selection are
    both handled through request headers rather than query parameters:
      - X-Goog-Api-Key   authenticates the request (replaces the 'key' param).
      - X-Goog-FieldMask controls which response fields are returned, keeping
        the payload small.  Only fields listed here will be populated in the
        response; omitting a field means it won't be returned even if it exists.

    Parameters:
        body (dict): Full Routes API request body (origin, destination,
                     intermediates, travelMode, routingPreference, etc.).

    Returns:
        dict: Parsed JSON response from the Routes API.

    Raises:
        httpx.HTTPStatusError: For 4xx/5xx HTTP responses.
    """
    # --- Cache check ---
    cached = cache_get("routes_api", body)
    if cached is not None:
        return cached["data"]

    headers = {
        "X-Goog-Api-Key":  GOOGLE_MAPS_API_KEY,
        # Request only the fields we actually use — smaller payload, faster response.
        # 'legs' is needed for future pickup-point calculation (Step 7).
        "X-Goog-FieldMask": (
            "routes.duration,"
            "routes.distanceMeters,"
            "routes.polyline.encodedPolyline,"
            "routes.legs"
        ),
    }
    response = httpx.post(_ROUTES_URL, json=body, headers=headers)
    response.raise_for_status()
    result = response.json()
    cache_put("routes_api", result, body)
    return result


def _extract_route(response_json: dict) -> dict:
    """
    Extracts the first route from a Routes API response and normalises its
    fields into the flat structure used throughout this application.

    The Routes API returns duration as a string like "1234s" (an ISO 8601
    duration with only a seconds component).  We strip the trailing "s" and
    convert to int so callers can do arithmetic directly.

    Parameters:
        response_json (dict): Full parsed JSON response from _call_routes_api().

    Returns:
        dict: {
            "duration_seconds": int,
            "distance_meters":  int,
            "encoded_polyline": str,  # for drawing the route on the map
            "legs":             list, # raw leg objects for pickup-point logic
        }
    """
    route = response_json["routes"][0]

    # Duration is returned as e.g. "1234s" — strip the unit suffix before
    # converting to int so callers receive a plain number they can do math on.
    duration_seconds = int(route["duration"].rstrip("s"))

    return {
        "duration_seconds": duration_seconds,
        "distance_meters":  route["distanceMeters"],
        "encoded_polyline": route["polyline"]["encodedPolyline"],
        # Legs contain per-segment steps used later for pickup-point detection.
        # We preserve the raw API structure here so the routing module can
        # iterate over them without needing to know about this module's internals.
        "legs":             route.get("legs", []),
    }


def calculate_driver_route(
    driver_coords:  dict,
    meeting_point:  dict,
    event_coords:   dict,
    arrival_time:   str | None = None,
) -> dict:
    """
    Calculates two driving routes for the personal car driver using the
    Google Routes API:

      Route A — base route (via meeting point):
          driver home → meeting point → event venue
          This is the standard route: the driver picks up the rest of the
          team at the meeting point before heading to the venue.

      Route B — direct route (no stopover):
          driver home → event venue
          This is the alternate route used to evaluate PEA candidates
          (Step 6) and pickup points (Step 7): we look for locations that
          lie ON this direct path and could serve as collection points.

    Both routes use DRIVE mode with TRAFFIC_AWARE routing so that the
    durations reflect realistic conditions, not just geometric distance.

    Two separate API calls are made because the Routes API computes one
    route per request (unlike the Distance Matrix which handles a full matrix).

    Parameters:
        driver_coords (dict):      {"lat": float, "lng": float} — driver's home address.
        meeting_point (dict):      {"lat": float, "lng": float, ...} — the selected PE.
                                   The nearest_meeting_point() return dict is accepted directly.
        event_coords  (dict):      {"lat": float, "lng": float} — event venue.
        arrival_time  (str | None): ISO 8601 UTC string for when the vehicle must
                                   arrive at the event venue (e.g. "2025-06-15T16:00:00Z").
                                   When provided, the Routes API applies historical traffic
                                   for that time window — more accurate than current traffic.
                                   If None, current conditions are used.

    Returns:
        dict: {
            "base_route": {
                "duration_seconds": int,
                "distance_meters":  int,
                "encoded_polyline": str,   # draw Route A on the map
                "legs":             list,  # raw legs for pickup-point calculation
            },
            "direct_route": {
                "duration_seconds": int,
                "distance_meters":  int,
                "encoded_polyline": str,   # draw Route B on the map
                "legs":             list,
            },
        }
    """
    # -------------------------------------------------------------------------
    # Route A: driver home → meeting point (intermediate) → event venue.
    # The "intermediates" field inserts a mandatory waypoint between origin
    # and destination.  The API plans the route to pass through it in order.
    # -------------------------------------------------------------------------
    body_a = {
        "origin":      _latLng(driver_coords),
        "destination": _latLng(event_coords),
        "intermediates": [_latLng(meeting_point)],
        "travelMode":        "DRIVE",
        "routingPreference": "TRAFFIC_AWARE",
    }
    if arrival_time:
        body_a["arrivalTime"] = arrival_time

    # -------------------------------------------------------------------------
    # Route B: driver home → event venue, no intermediates.
    # This is the shortest/fastest direct path — used as the reference for
    # evaluating whether a detour (to a PEA or pickup point) is worthwhile.
    # -------------------------------------------------------------------------
    body_b = {
        "origin":      _latLng(driver_coords),
        "destination": _latLng(event_coords),
        "travelMode":        "DRIVE",
        "routingPreference": "TRAFFIC_AWARE",
    }
    if arrival_time:
        body_b["arrivalTime"] = arrival_time

    response_a = _call_routes_api(body_a)
    response_b = _call_routes_api(body_b)

    return {
        "base_route":   _extract_route(response_a),
        "direct_route": _extract_route(response_b),
    }


def find_pea_candidates(direct_route_polyline: str) -> list[dict]:
    """
    DEPRECATED — no longer called by the /evaluate-pea endpoint.

    Replaced by the employee-centric pipeline in logistics.py:
      _filter_employees_near_route() + _search_pea_near_point()
    which makes one Places API call per employee cluster instead of ~40
    calls across the full polyline.

    Kept here to preserve the import symbol in case of external callers and
    to allow existing "pea_places" cache entries to remain usable.

    Original description:
    Searches for public transport hubs along the driver's direct route
    (home → event, no stopover) that could serve as an alternative meeting
    point (PEA — Punto de Encuentro Alternativo).

    Strategy — why sample the polyline?
        The direct route is encoded as a single polyline string, which when
        decoded yields potentially hundreds of lat/lng points.  Sending a
        Places API request for every point would exhaust quota quickly and
        return many duplicate stations.  Sampling every Nth point (controlled
        by _POLYLINE_SAMPLE_STEP) gives enough geographic coverage without
        excessive calls.  A 300 m search radius around each sample catches
        any station that a staff member could reach from the road.

    Deduplication — why by formattedAddress?
        Adjacent sampled points are close together, so the same station
        frequently appears in the results of two or three consecutive calls.
        formattedAddress is a stable, human-readable identifier that is unique
        per location — more reliable than place ID or display name alone.

    This function is intentionally narrow in scope: it only finds candidates.
    It does not evaluate transit times, compare them to the original meeting
    point, or apply any of the PEA proposal rules from config.py.  That
    evaluation belongs to the routing module (Step 6, not yet built).

    Parameters:
        direct_route_polyline (str): Encoded polyline string from the
            "direct_route" returned by calculate_driver_route().

    Returns:
        list[dict]: Unique candidate stations found along the route, each as:
            {
                "name":    str,        # display name of the place
                "address": str,        # formatted address
                "lat":     float,
                "lng":     float,
                "types":   list[str],  # Google place type identifiers
            }
            Empty list if no candidates are found.
    """
    # -------------------------------------------------------------------------
    # Step 1: decode the polyline into a list of (lat, lng) tuples.
    # The 'polyline' library implements the Google Encoded Polyline Algorithm
    # Format, which compresses a sequence of coordinates into a compact ASCII
    # string.  decode() reverses that compression.
    # -------------------------------------------------------------------------
    all_points = polyline_lib.decode(direct_route_polyline)

    # Sample every Nth point to limit the number of Places API calls.
    # list[::N] is Python slice notation for "take every Nth element".
    sampled_points = all_points[::_POLYLINE_SAMPLE_STEP]

    # -------------------------------------------------------------------------
    # Step 2: query the Places API (New) for each sampled point and collect
    # all results, deduplicating by formatted address as we go.
    # Using a dict keyed on address gives O(1) duplicate checks and preserves
    # the first occurrence of each station (the one found earliest on the route).
    # -------------------------------------------------------------------------
    seen_addresses: dict[str, dict] = {}

    for lat, lng in sampled_points:
        # --- Cache check per sampled point ---
        _ck = (lat, lng, _PLACES_SEARCH_RADIUS, tuple(_PEA_PLACE_TYPES))
        cached = cache_get("pea_places", *_ck)
        if cached is not None:
            data = cached["data"]
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
                # Request only the four fields we need — Places API (New) charges
                # per field category, so requesting fewer fields reduces cost.
                "X-Goog-FieldMask": (
                    "places.displayName,"
                    "places.location,"
                    "places.types,"
                    "places.formattedAddress"
                ),
            }

            response = httpx.post(_PLACES_NEARBY_URL, json=body, headers=headers)
            response.raise_for_status()
            data = response.json()
            cache_put("pea_places", data, *_ck)

        # "places" key may be absent if the API found nothing nearby
        for place in data.get("places", []):
            address = place.get("formattedAddress", "")

            # Skip if we have already recorded this station from a previous
            # sampled point — formattedAddress is our deduplication key.
            if address in seen_addresses:
                continue

            # Extract the nested location coordinates
            location = place.get("location", {})

            seen_addresses[address] = {
                "name":    place.get("displayName", {}).get("text", ""),
                "address": address,
                "lat":     location.get("latitude", 0.0),
                "lng":     location.get("longitude", 0.0),
                "types":   place.get("types", []),
            }

    # Return as a flat list; order reflects first appearance along the route
    return list(seen_addresses.values())


def pickup_place_info(lat: float, lng: float) -> dict:
    """
    Returns display information about a location the user manually clicked on
    the map during manual pickup selection.

    Two API calls are made:
      1. Places API (New) searchNearby — finds the closest named place within
         100m of the click so the InfoWindow can show a meaningful name and type
         instead of raw coordinates.  No type filter is applied — the user
         chose this point deliberately.
      2. Geocoding API reverse geocode — provides a human-readable address
         even when no nearby place is found (the name field falls back to it).

    Results are cached so repeated clicks near the same point don't re-hit
    the quota.

    Parameters:
        lat (float): Latitude of the clicked point.
        lng (float): Longitude of the clicked point.

    Returns:
        dict: {
            "lat":            float,
            "lng":            float,
            "name":           str | None,  # from Places displayName or None
            "address":        str,          # from Geocoding API
            "types":          list[str],    # from Places primaryType/types or []
            "opening_hours":  list[str],    # weekday descriptions or []
        }
    """
    result = {
        "lat":           lat,
        "lng":           lng,
        "name":          None,
        "address":       f"{lat:.6f}, {lng:.6f}",  # fallback if geocoding fails
        "types":         [],
        "opening_hours": [],
    }

    # ── 1. Reverse geocode ──────────────────────────────────────────────────
    cache_key_geo = ("reverse_geocode", round(lat, 5), round(lng, 5))
    geo_cached = cache_get("pickup_places", cache_key_geo)
    if geo_cached is not None:
        geo_data = geo_cached["data"]
    else:
        geo_resp = httpx.get(
            _GEOCODING_URL,
            params={"latlng": f"{lat},{lng}", "key": GOOGLE_MAPS_API_KEY},
        )
        geo_resp.raise_for_status()
        geo_data = geo_resp.json()
        cache_put("pickup_places", geo_data, *cache_key_geo)

    if geo_data.get("status") == "OK" and geo_data.get("results"):
        result["address"] = geo_data["results"][0].get("formatted_address", result["address"])

    # ── 2. Places API searchNearby (300m, no type filter, up to 5 candidates) ─
    # Key uses "v2" suffix to avoid serving stale single-result cache entries
    # from older deployments that used maxResultCount: 1.
    places_body = {
        "locationRestriction": {
            "circle": {
                "center":  {"latitude": lat, "longitude": lng},
                "radius":  300.0,
            }
        },
        "maxResultCount": 5,
    }
    cache_key_places = ("nearby_click_v2", round(lat, 5), round(lng, 5))
    places_cached = cache_get("pickup_places", cache_key_places)
    if places_cached is not None:
        places_data = places_cached["data"]
    else:
        headers = {
            "X-Goog-Api-Key":  GOOGLE_MAPS_API_KEY,
            "X-Goog-FieldMask": (
                "places.displayName,"
                "places.formattedAddress,"
                "places.location,"
                "places.primaryType,"
                "places.currentOpeningHours"
            ),
        }
        places_resp = httpx.post(_PLACES_NEARBY_URL, json=places_body, headers=headers)
        places_resp.raise_for_status()
        places_data = places_resp.json()
        cache_put("pickup_places", places_data, *cache_key_places)

    places = places_data.get("places", [])
    nearby = []
    for p in places:
        display_name = p.get("displayName", {})
        name = display_name.get("text") if isinstance(display_name, dict) else None
        location = p.get("location", {})
        hours = p.get("currentOpeningHours", {})
        nearby.append({
            "name":          name,
            "address":       p.get("formattedAddress"),
            "lat":           location.get("latitude"),
            "lng":           location.get("longitude"),
            "types":         [p["primaryType"]] if p.get("primaryType") else [],
            "opening_hours": hours.get("weekdayDescriptions", []),
        })

    if nearby:
        result["name"]          = nearby[0]["name"]
        result["types"]         = nearby[0]["types"]
        result["opening_hours"] = nearby[0]["opening_hours"]
    result["nearby_places"] = nearby

    return result


def get_place_details(place_id: str) -> dict:
    """
    Fetches full place details from the Places API (New) by place ID.

    Called when the user single-clicks a Google Maps POI (gas station,
    restaurant, etc.) during manual pickup selection.  The place ID comes
    from the map click event; this function retrieves name, address,
    coordinates, and opening hours.

    Parameters:
        place_id (str): A Google Places place ID, e.g. "ChIJ...".

    Returns:
        dict: {
            "name":             str | None,
            "address":          str | None,
            "lat":              float | None,
            "lng":              float | None,
            "types":            list[str],
            "primary_type":     str | None,
            "opening_hours":    list[str],
            "editorial_summary": str | None,
        }
    """
    cache_key = ("place_id", place_id)
    cached = cache_get("place_details", cache_key)
    if cached is not None:
        return cached["data"]

    url     = f"https://places.googleapis.com/v1/places/{place_id}"
    headers = {
        "X-Goog-Api-Key":  GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask": (
            "displayName,"
            "formattedAddress,"
            "location,"
            "types,"
            "primaryType,"
            "currentOpeningHours,"
            "editorialSummary"
        ),
    }
    resp = httpx.get(url, headers=headers)
    resp.raise_for_status()
    data = resp.json()
    cache_put("place_details", data, *cache_key)

    display_name = data.get("displayName", {})
    editorial    = data.get("editorialSummary", {})
    location     = data.get("location", {})
    hours        = data.get("currentOpeningHours", {})

    return {
        "name":              display_name.get("text") if isinstance(display_name, dict) else None,
        "address":           data.get("formattedAddress"),
        "lat":               location.get("latitude"),
        "lng":               location.get("longitude"),
        "types":             data.get("types", []),
        "primary_type":      data.get("primaryType"),
        "opening_hours":     hours.get("weekdayDescriptions", []) if isinstance(hours, dict) else [],
        "editorial_summary": editorial.get("text") if isinstance(editorial, dict) else None,
    }


def pea_place_info(
    lat: float,
    lng: float,
    remaining_pool: list[dict],
    meeting_point: dict,
) -> dict:
    """
    Returns display info and transit metrics for a point the user manually
    clicked on the map during PEA selection mode (step 2).

    Used by POST /pea-place-info.  The backend builds the remaining pool and
    passes it here; this function owns all API calls and metric computation.

    API calls:
      1. Geocoding reverse geocode — human-readable address for the clicked point.
      2. Places API searchNearby (300 m, transit hub types) — named place if one
         is within the search radius; no place is fine, address is enough.
      3. Distance Matrix transit — N origins (employee homes) × 2 destinations
         (clicked candidate + original PE) in one call to compute time savings.

    Parameters:
        lat (float):           Latitude of the clicked point.
        lng (float):           Longitude of the clicked point.
        remaining_pool (list): Employees with "coordinates" key that are NOT
                               already assigned to the frescos vehicle.
        meeting_point (dict):  {"lat": float, "lng": float} — the original PE
                               used as the comparison baseline.

    Returns:
        dict: {
            "lat":           float,
            "lng":           float,
            "name":          str | None,
            "address":       str,
            "primary_type":  str | None,
            "opening_hours": list[str],
            "staff_metrics": [
                {
                    "employee_name":            str,
                    "transit_to_candidate_min": float,
                    "transit_to_pe_min":        float,
                    "time_saved_min":           float,
                },
                ...  # one entry per remaining-pool employee with valid coords
            ]
        }
    """
    result = {
        "lat":           lat,
        "lng":           lng,
        "name":          None,
        "address":       f"{lat:.6f}, {lng:.6f}",  # fallback if geocoding fails
        "primary_type":  None,
        "opening_hours": [],
        "staff_metrics": [],
    }

    # ── 1. Reverse geocode ──────────────────────────────────────────────────
    cache_key_geo = ("reverse_geocode", round(lat, 5), round(lng, 5))
    geo_cached = cache_get("pea_place_info", cache_key_geo)
    if geo_cached is not None:
        geo_data = geo_cached["data"]
    else:
        try:
            geo_resp = httpx.get(
                _GEOCODING_URL,
                params={"latlng": f"{lat},{lng}", "key": GOOGLE_MAPS_API_KEY},
            )
            geo_resp.raise_for_status()
            geo_data = geo_resp.json()
            cache_put("pea_place_info", geo_data, *cache_key_geo)
        except Exception:
            geo_data = {}

    if geo_data.get("status") == "OK" and geo_data.get("results"):
        result["address"] = geo_data["results"][0].get("formatted_address", result["address"])

    # ── 2. Places API searchNearby (300m, transit hubs) ─────────────────────
    places_body = {
        "locationRestriction": {
            "circle": {
                "center":  {"latitude": lat, "longitude": lng},
                "radius":  _PLACES_SEARCH_RADIUS,
            }
        },
        "includedTypes":  _PEA_PLACE_TYPES,
        "maxResultCount": 1,
    }
    cache_key_places = ("pea_nearby_click", round(lat, 5), round(lng, 5))
    places_cached = cache_get("pea_place_info", cache_key_places)
    if places_cached is not None:
        places_data = places_cached["data"]
    else:
        try:
            headers = {
                "X-Goog-Api-Key":   GOOGLE_MAPS_API_KEY,
                "X-Goog-FieldMask": (
                    "places.displayName,"
                    "places.formattedAddress,"
                    "places.location,"
                    "places.primaryType,"
                    "places.currentOpeningHours"
                ),
            }
            places_resp = httpx.post(_PLACES_NEARBY_URL, json=places_body, headers=headers)
            places_resp.raise_for_status()
            places_data = places_resp.json()
            cache_put("pea_place_info", places_data, *cache_key_places)
        except Exception:
            places_data = {}

    places = places_data.get("places", [])
    if places:
        p = places[0]
        display_name = p.get("displayName", {})
        result["name"] = display_name.get("text") if isinstance(display_name, dict) else None
        result["primary_type"] = p.get("primaryType")
        # Prefer the place's own formatted address over the reverse-geocode result —
        # it is usually more precise for a named transit stop.
        if p.get("formattedAddress"):
            result["address"] = p["formattedAddress"]
        hours = p.get("currentOpeningHours", {})
        result["opening_hours"] = hours.get("weekdayDescriptions", [])

    # ── 3. Distance Matrix transit: employee homes → [candidate, PE] ─────────
    # Only employees with valid coordinates are included.  Invalid entries are
    # silently skipped — the InfoWindow still shows the place info.
    employees_with_coords = [
        emp for emp in remaining_pool
        if emp.get("coordinates") and emp["coordinates"].get("lat") is not None
    ]
    if employees_with_coords:
        origins = [emp["coordinates"] for emp in employees_with_coords]
        destinations = [
            {"lat": lat,                    "lng": lng},                   # [0] candidate
            {"lat": meeting_point["lat"],   "lng": meeting_point["lng"]},  # [1] original PE
        ]
        try:
            dm   = calculate_distances(origins, destinations, mode="transit")
            rows = dm.get("rows", [])
            for i, emp in enumerate(employees_with_coords):
                if i >= len(rows):
                    break
                elements = rows[i].get("elements", [])
                if len(elements) < 2:
                    continue
                el_cand = elements[0]
                el_pe   = elements[1]
                if el_cand.get("status") != "OK" or el_pe.get("status") != "OK":
                    continue
                transit_to_cand = el_cand["duration"]["value"] / 60.0
                transit_to_pe   = el_pe["duration"]["value"] / 60.0
                result["staff_metrics"].append({
                    "employee_name":            f"{emp.get('Nombre', '')} {emp.get('Apellido', '')}".strip(),
                    "transit_to_candidate_min": round(transit_to_cand, 1),
                    "transit_to_pe_min":        round(transit_to_pe, 1),
                    "time_saved_min":           round(transit_to_pe - transit_to_cand, 1),
                })
        except Exception:
            # Transit evaluation is best-effort; place info is still useful.
            pass

    return result


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Haversine distance in metres between two WGS-84 points."""
    R    = 6_371_000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    a    = (math.sin(math.radians(lat2 - lat1) / 2) ** 2
            + math.cos(phi1) * math.cos(phi2)
            * math.sin(math.radians(lng2 - lng1) / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(a))


def _closest_vertex_index(vertices: list, target_lat: float, target_lng: float) -> int:
    """
    Returns the index of the vertex in `vertices` closest to (target_lat, target_lng).
    Each vertex is a [lat, lng] pair as returned by polyline_lib.decode().
    """
    best_i, best_d = 0, float("inf")
    for i, (lat, lng) in enumerate(vertices):
        d = _haversine_m(lat, lng, target_lat, target_lng)
        if d < best_d:
            best_d, best_i = d, i
    return best_i


def simple_route(origin: dict, destination: dict) -> dict:
    """
    Computes a single driving route from origin to destination using the
    Google Routes API.

    Lighter-weight than calculate_driver_route() — no intermediates, no
    arrivalTime, no parallel direct-route computation.  Used by the frontend
    to draw a small secondary polyline from a custom Uber group meeting point
    to the event venue, without the overhead of the full driver-route pipeline.

    Parameters:
        origin      (dict): {"lat": float, "lng": float}
        destination (dict): {"lat": float, "lng": float}

    Returns:
        dict: {
            "encoded_polyline": str,
            "duration_seconds": int,
            "distance_meters":  int,
        }
    """
    body = {
        "origin":            _latLng(origin),
        "destination":       _latLng(destination),
        "travelMode":        "DRIVE",
        "routingPreference": "TRAFFIC_AWARE",
    }
    response_json = _call_routes_api(body)
    route = _extract_route(response_json)
    return {
        "encoded_polyline": route["encoded_polyline"],
        "duration_seconds": route["duration_seconds"],
        "distance_meters":  route["distance_meters"],
    }


def recalculate_route_with_pickup(
    driver_coords:       dict,
    pickup_point:        dict,
    meeting_point:       dict,
    event_coords:        dict,
    base_route_polyline: str,
) -> dict:
    """
    Computes the driving route from the driver's home to the event venue via
    the pickup point and the confirmed meeting point.

    Unlike the old fixed-order version, this function determines whether the
    pickup is BEFORE or AFTER the PE along the driver's natural route by
    comparing polyline vertex indices — no extra API calls needed.

    Vertex-index ordering:
        1. Decode base_route_polyline into [lat, lng] vertices.
        2. Find the vertex closest to the PE  → pe_idx.
        3. Find the vertex closest to pickup  → pickup_idx.
        4. pickup_idx < pe_idx  → pickup is before the PE in the route.
        5. pickup_idx ≥ pe_idx  → pickup is after the PE.

    Route order produced:
        pickup before PE:  home → pickup → PE → event
        pickup after  PE:  home → PE → pickup → event

    Middle-leg duration:
        With two intermediates the Routes API returns three legs:
          legs[0]: home → intermediate[0]
          legs[1]: intermediate[0] → intermediate[1]   ← pickup ↔ PE
          legs[2]: intermediate[1] → event
        legs[1].duration ("XXXs") gives the car travel time between pickup
        and PE regardless of which comes first, which the frontend uses to
        compute the pickup-point arrival time.

    Parameters:
        driver_coords       (dict): {"lat": float, "lng": float} — driver's home.
        pickup_point        (dict): {"lat": float, "lng": float} — pickup location.
        meeting_point       (dict): {"lat": float, "lng": float} — PE or PEA.
        event_coords        (dict): {"lat": float, "lng": float} — event venue.
        base_route_polyline (str):  Google-encoded polyline of the original
                                    home→PE→event route; used for vertex-index
                                    comparison only, not drawn on the map.

    Returns:
        dict: {
            "encoded_polyline": str,
            "duration_seconds": int,
            "distance_meters":  int,
            "pickup_before_pe": bool,   — True when pickup precedes PE on the route
            "leg_seconds":      int,    — driving seconds between pickup and PE
        }
    """
    # ── Determine pickup order via vertex-index comparison ───────────────────
    vertices = polyline_lib.decode(base_route_polyline)  # list of [lat, lng]

    pe_idx     = _closest_vertex_index(vertices, meeting_point["lat"], meeting_point["lng"])
    pickup_idx = _closest_vertex_index(vertices, pickup_point["lat"],  pickup_point["lng"])

    pickup_before_pe = pickup_idx < pe_idx

    # ── Build the route with the correct intermediate order ──────────────────
    if pickup_before_pe:
        intermediates = [_latLng(pickup_point), _latLng(meeting_point)]
    else:
        intermediates = [_latLng(meeting_point), _latLng(pickup_point)]

    body = {
        "origin":        _latLng(driver_coords),
        "destination":   _latLng(event_coords),
        "intermediates": intermediates,
        "travelMode":        "DRIVE",
        "routingPreference": "TRAFFIC_AWARE",
    }
    response_json = _call_routes_api(body)
    route = _extract_route(response_json)

    # ── Extract the middle-leg (pickup ↔ PE) duration ────────────────────────
    # Leg duration is returned as a string "XXXs" by the Routes API — strip
    # the unit suffix and convert to int, same as _extract_route does for the
    # overall route duration.
    legs = route.get("legs", [])
    leg_seconds = None
    if len(legs) >= 2:
        raw = legs[1].get("duration", "")
        if raw:
            leg_seconds = int(str(raw).rstrip("s"))

    return {
        "encoded_polyline": route["encoded_polyline"],
        "duration_seconds": route["duration_seconds"],
        "distance_meters":  route["distance_meters"],
        "pickup_before_pe": pickup_before_pe,
        "leg_seconds":      leg_seconds,
    }
