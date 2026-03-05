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

import httpx
import polyline as polyline_lib
from dotenv import load_dotenv

from config import CP_LAT, CP_LNG  # noqa: F401 — available for route calculations from the CP

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
        return None

    # The results list is ordered by relevance; the first entry is the best match
    first_result = data["results"][0]

    # The lat/lng values are nested inside geometry → location
    location = first_result["geometry"]["location"]

    return {
        "lat": location["lat"],
        "lng": location["lng"],
        # "formatted_address" is the canonical address string Google resolved to
        "formatted_address": first_result["formatted_address"],
    }


def geocode_staff(staff: list[dict]) -> list[dict]:
    """
    Geocodes every employee in the staff list returned by read_excel().

    For each employee the full address is built by concatenating three
    columns from the Excel 'equipo' sheet:
        Direccion (street address)  +  CP (postal code)  +  Ciudad (city)

    The resulting coordinates dict (or None on failure) is stored in a new
    "coordinates" key on the employee dict.  The original list is modified
    in-place and also returned, so callers can chain or ignore the return value.

    Parameters:
        staff (list[dict]): List of employee dicts as returned by read_excel().
                            Expected keys per employee: "Direccion", "CP", "Ciudad".

    Returns:
        list[dict]: Same list with a "coordinates" key added to each employee.
                    Value is { "lat": ..., "lng": ..., "formatted_address": ... }
                    or None if geocoding failed for that employee.
    """
    for employee in staff:
        # Build the full address string from the three address columns.
        # strip() guards against accidental leading/trailing whitespace.
        street   = str(employee.get("Direccion", "")).strip()
        zip_code = str(employee.get("CP", "")).strip()
        city     = str(employee.get("Ciudad", "")).strip()

        # Combine into a single comma-separated address string for the API
        full_address = f"{street}, {zip_code}, {city}"

        # Call the Geocoding API and attach the result (or None) to the dict
        employee["coordinates"] = geocode(full_address)

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
    return response.json()


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

    return {"rows": rows}


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
    return response.json()


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
