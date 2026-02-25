# =============================================================================
# maps_client.py
# Client module for Google Maps APIs.
# Provides geocoding, distance matrix, and meeting-point utilities.
#
# All functions in this module require the environment variable
# GOOGLE_MAPS_API_KEY to be set in .env at the project root.
#
# APIs used:
#   - Geocoding API:        https://developers.google.com/maps/documentation/geocoding
#   - Distance Matrix API:  https://developers.google.com/maps/documentation/distance-matrix
# =============================================================================

import os

import httpx
from dotenv import load_dotenv

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

# Base URLs for the two Google Maps APIs we call.
# Keeping them as module-level constants makes them easy to update or mock.
_GEOCODING_URL = "https://maps.googleapis.com/maps/api/geocode/json"
_DISTANCE_MATRIX_URL = "https://maps.googleapis.com/maps/api/distancematrix/json"


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
) -> dict:
    """
    Calls the Google Distance Matrix API to compute travel times and
    distances between every origin/destination pair in a single request.

    The API accepts N origins and M destinations and returns an N×M matrix
    where element [i][j] is the travel data from origins[i] to destinations[j].

    Parameters:
        origins (list[dict]):      Coordinate dicts {"lat": float, "lng": float}.
        destinations (list[dict]): Coordinate dicts {"lat": float, "lng": float}.

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
        "key":          GOOGLE_MAPS_API_KEY,
    }

    response = httpx.get(_DISTANCE_MATRIX_URL, params=params)
    response.raise_for_status()

    # Return the full JSON body; callers decide which fields they need
    return response.json()


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
