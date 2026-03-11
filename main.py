# =============================================================================
# main.py
# FastAPI server for the catering logistics app.
# Exposes endpoints to read the event Excel and interact with Google Maps.
#
# To start the server:
#   uvicorn main:app --reload
# Then open: http://127.0.0.1:8000/docs  (auto-generated Swagger UI)
# =============================================================================

import os
import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# Import our data-reading and maps functions from the local modules package
from modules.excel_reader import read_excel
from modules.maps_client import geocode, geocode_staff, nearest_meeting_point, calculate_distances, calculate_driver_route, compute_route_matrix
from modules.logistics import determine_frescos_vehicle, determine_second_miniflete, calculate_departure_time, get_remaining_pool, detect_personal_vehicle, evaluate_pea_candidates, find_pickup_candidate, assign_vehicle_passengers, assign_uber_only, validate_assignments, build_assignment_summary, calculate_pe_departure_time, build_final_output

# CP coordinates are fixed constants defined in config.py — imported here
# so the endpoint can pass them directly to the Distance Matrix API.
from config import (
    CP_LAT, CP_LNG,
    DEPARTURE_PREP_HOURS, LONG_EVENT_EXTRA_HOURS,
    LONG_EVENT_DURATION_THRESHOLD, PICADA_GUEST_THRESHOLD,
)

# Load the variables defined in .env into the process environment.
# This must run before any code that calls os.getenv().
load_dotenv()

# Buenos Aires is UTC-3 year-round (Argentina abolished daylight saving in 2008).
# Using ZoneInfo rather than a fixed UTC offset makes the intent explicit and
# handles edge cases correctly if Python ever gets DST data for AR.
_BA_TZ = ZoneInfo("America/Argentina/Buenos_Aires")


def _compute_arrival_time(event_time_str: str, fecha_str: str, extra_hours: bool) -> str:
    """
    Returns an ISO 8601 UTC string for when vehicles must arrive at the event
    venue: event start time minus the full departure-preparation window.

    Passing arrivalTime (not departureTime) to the Routes API lets it apply
    historical traffic for the exact hour vehicles would be arriving — more
    accurate than predicting departure traffic when only the deadline is known.

    Parameters:
        event_time_str (str):  Event start time in "HH:MM" format, as stored by
                               the Excel reader.
        fecha_str      (str):  Event date returned by _clean_str() on the Excel
                               "Fecha" cell — "YYYY-MM-DD" or
                               "YYYY-MM-DD HH:MM:SS" (openpyxl date cells become
                               datetime.datetime objects; str() produces the latter).
        extra_hours    (bool): True when the event is long or has a large picada,
                               adding LONG_EVENT_EXTRA_HOURS to the prep window.

    Returns:
        str: ISO 8601 UTC string, e.g. "2025-06-15T16:00:00Z".
    """
    # fromisoformat() handles both "YYYY-MM-DD" and "YYYY-MM-DD HH:MM:SS".
    event_date = datetime.datetime.fromisoformat(fecha_str.strip()).date()
    event_hour, event_minute = map(int, event_time_str.strip().split(":"))

    # Build a Buenos Aires-localised datetime for the event start.
    event_dt = datetime.datetime(
        event_date.year, event_date.month, event_date.day,
        event_hour, event_minute,
        tzinfo=_BA_TZ,
    )

    # Subtract the full prep window to get the arrival deadline at the venue.
    prep_hours = DEPARTURE_PREP_HOURS + (LONG_EVENT_EXTRA_HOURS if extra_hours else 0)
    arrival_dt = event_dt - datetime.timedelta(hours=prep_hours)

    # Convert to UTC — the Routes API requires UTC for arrivalTime.
    arrival_utc = arrival_dt.astimezone(datetime.timezone.utc)
    return arrival_utc.strftime("%Y-%m-%dT%H:%M:%SZ")


# -----------------------------------------------------------------------------
# FastAPI application instance.
# The title and description appear in the auto-generated documentation (/docs).
# -----------------------------------------------------------------------------
app = FastAPI(
    title="App Traslado Personal - Catering",
    description=(
        "Logistics API for catering events. "
        "Modules: Excel data reading, staff geocoding, and meeting-point routing."
    ),
    version="0.2.0",
)

# -----------------------------------------------------------------------------
# CORS middleware.
#
# Why CORS is needed:
#   Browsers enforce the Same-Origin Policy: a page at origin A is not
#   allowed to read a response from origin B unless origin B explicitly
#   opts in via the Access-Control-Allow-Origin response header.  The
#   frontend runs at http://localhost:5173 (Vite dev server) while the
#   backend runs at http://127.0.0.1:8000 (uvicorn) — these are different
#   origins (different host), so every browser request is blocked by
#   default.  CORSMiddleware adds the required headers to every response.
#
# Why both localhost and 127.0.0.1?
#   Even though localhost resolves to 127.0.0.1 at the DNS/hosts level,
#   the browser compares origin strings literally — "localhost" and
#   "127.0.0.1" are treated as distinct origins.  Depending on whether
#   the developer opens the app as http://localhost:5173 or
#   http://127.0.0.1:5173, a different Origin header is sent.  Listing
#   both ensures neither variant is blocked.
#
# allow_credentials=False because we use no cookies or HTTP auth.
# allow_methods=["GET", "POST"] matches exactly the HTTP methods our
#   endpoints use — no DELETE, PUT, or PATCH exist in this app.
# allow_headers=["Content-Type"] is the only non-simple header axios sends.
# -----------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)

# -----------------------------------------------------------------------------
# Resolve the path to the Excel file once at app startup.
# BASE_DIR points to the directory containing this file (the project root).
# EXCEL_PATH falls back to the test file if EXCEL_PATH is not set in .env.
# -----------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
EXCEL_PATH = BASE_DIR / os.getenv("EXCEL_PATH", "sample_data/evento_prueba.xlsx")


# -----------------------------------------------------------------------------
# Internal helper shared by all endpoints that need the Excel data
# -----------------------------------------------------------------------------

def _load_excel() -> dict:
    """
    Reads the Excel file and returns the parsed data dict.
    Raises HTTPException 404 if the file does not exist.

    Centralising this check in one place keeps all endpoints DRY:
    each endpoint calls _load_excel() instead of repeating the
    file-existence check and the read_excel() call.
    """
    if not EXCEL_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Excel file not found at: {EXCEL_PATH}",
        )
    return read_excel(str(EXCEL_PATH))


# API response cache — eliminates repeated Google Maps calls during development.
# Toggle via .env: API_CACHE_ENABLED=true (default) or false.
from modules.api_cache import stats as cache_stats, clear as cache_clear

# -----------------------------------------------------------------------------
# Endpoints
# -----------------------------------------------------------------------------

@app.get(
    "/cache-stats",
    summary="Show API cache statistics",
    description="Returns the current state of the file-based API cache.",
)
def endpoint_cache_stats():
    return cache_stats()


@app.delete(
    "/cache-clear",
    summary="Clear the API response cache",
    description=(
        "Deletes all cached API responses.  Next request will make real "
        "Google Maps API calls and repopulate the cache."
    ),
)
def endpoint_cache_clear():
    deleted = cache_clear()
    return {"deleted": deleted, "message": f"Cleared {deleted} cached entries."}


@app.get(
    "/read-excel",
    summary="Read the event Excel file",
    description=(
        "Reads the test Excel file and returns the structured data "
        "from the three sheets: event, staff, and services."
    ),
)
def endpoint_read_excel():
    """
    Main endpoint for the Excel reading module.

    Returns a JSON with the structure:
    {
        "event":    { "tipo": ..., "ocasion": ..., "direccion_evento": ...,
                      "ciudad_evento": ..., "hora_inicio": ..., "comensales": ...,
                      "comensales_veggie": ..., "descripcion_locacion": ...,
                      "empresa": ..., "observaciones": [...], "fecha": ... },
        "staff":    [ { "Profesion": ..., "Nombre": ..., ... }, ... ],
        "services": [ { "Servicio": ..., "Detalle": ..., "Cantidad": ... }, ... ]
    }
    """
    # Delegate to the shared helper and let FastAPI serialize the dict to JSON
    data = _load_excel()
    return data


@app.get(
    "/geocode-staff",
    summary="Geocode the staff list",
    description=(
        "Reads the event Excel and returns the staff list enriched with "
        "geographic coordinates (lat/lng) from the Google Geocoding API. "
        "Each employee's address is built from the Direccion + CP + Ciudad columns."
    ),
)
def endpoint_geocode_staff():
    """
    Reads the 'equipo' sheet, geocodes every employee's address via the
    Google Geocoding API, and returns the augmented list.

    Returns a JSON array:
    [
      {
        "Profesion": "Chef Principal",
        "Nombre": "Martín",
        ...,
        "coordinates": {
          "lat": -34.603,
          "lng": -58.381,
          "formatted_address": "Av. Corrientes 3421, C1193 CABA, Argentina"
        }
      },
      ...
    ]
    Employees whose address cannot be resolved will have "coordinates": null.
    """
    data = _load_excel()

    # geocode_staff() adds a "coordinates" key to each employee dict in-place
    # and returns the same list — we pass it straight to FastAPI for serialisation
    staff_with_coords = geocode_staff(data["staff"])
    return staff_with_coords


@app.get(
    "/geocode-address",
    summary="Geocode a single free-text address",
    description=(
        "Accepts an address string via the 'address' query parameter and returns "
        "its lat/lng coordinates from the Google Geocoding API.  Used by the "
        "frontend when the user edits an employee's address in the marker edit UI. "
        "Returns 422 if the address cannot be resolved."
    ),
)
def endpoint_geocode_address(address: str):
    """
    Thin wrapper around geocode() — no Excel reading, no staff processing.
    Returns the same shape as the 'coordinates' key on geocoded staff:
    { "lat": float, "lng": float, "formatted_address": str }
    """
    coords = geocode(address)
    if coords is None:
        raise HTTPException(
            status_code=422,
            detail=f"Could not geocode address: '{address}'",
        )
    return coords


@app.get(
    "/nearest-meeting-point",
    summary="Find the nearest meeting point to the event venue",
    description=(
        "Reads the event Excel, geocodes the event venue address, and returns "
        "the predefined CABA meeting point with the shortest driving time to it. "
        "The three candidate points (North, South, West CABA) are defined as "
        "constants inside modules/maps_client.py."
    ),
)
def endpoint_nearest_meeting_point():
    """
    Workflow:
        1. Read event data from the Excel file.
        2. Build the full event address from 'direccion_evento' + 'ciudad_evento'
           (these keys come from the Excel sheet content and stay in Spanish).
        3. Geocode the address to obtain lat/lng coordinates.
        4. Call nearest_meeting_point() which queries the Distance Matrix API
           and picks the point with the shortest driving time.

    Returns a JSON object:
    {
        "name":             "North - Puente Saavedra",
        "address":          "Av. General Paz y Av. Cabildo, Saavedra, Buenos Aires",
        "lat":              -34.5535,
        "lng":              -58.4597,
        "duration_seconds": 540,
        "duration_text":    "9 mins",
        "distance_meters":  4200,
        "distance_text":    "4.2 km"
    }
    """
    data = _load_excel()
    event = data["event"]

    # Build the full event address by joining the street and city fields.
    # The keys ("direccion_evento", "ciudad_evento") are the raw field names
    # stored in the Excel sheet — they remain in Spanish intentionally.
    event_address = (
        f"{event.get('direccion_evento', '')}, "
        f"{event.get('ciudad_evento', '')}"
    )

    # Geocode the event venue to get its lat/lng coordinates
    event_coords = geocode(event_address)
    if event_coords is None:
        raise HTTPException(
            status_code=422,
            detail=f"Could not geocode the event address: '{event_address}'",
        )

    # Find the nearest predefined meeting point and return its travel data
    try:
        result = nearest_meeting_point(event_coords)
    except ValueError as exc:
        # nearest_meeting_point() raises ValueError when no route is reachable
        raise HTTPException(status_code=422, detail=str(exc))

    return result


# -----------------------------------------------------------------------------
# Request body models
# Pydantic models declare the expected JSON shape for POST endpoints.
# FastAPI uses them for automatic validation and documentation generation.
# -----------------------------------------------------------------------------

class FrescosRequest(BaseModel):
    """
    Body for POST /determine-frescos.
    has_own_van: True if the company's van is available for this event,
                 False if a miniflete must be hired.
    """
    has_own_van: bool


@app.post(
    "/determine-frescos",
    summary="Determine the frescos vehicle and assigned employees",
    description=(
        "Given whether the company owns a van for this event, reads the staff "
        "list from the Excel, looks up the Manager Senior and (if own van) the "
        "highest-seniority Parrilla employee, and returns which vehicle will "
        "transport the frescos together with the actual employee names assigned "
        "to it.  No external APIs are called — the decision is purely rule-based."
    ),
)
def endpoint_determine_frescos(body: FrescosRequest):
    """
    Workflow:
        1. Read the event Excel via _load_excel() to get the staff list.
        2. Pass has_own_van and the staff list to determine_frescos_vehicle(),
           which does a real employee lookup instead of returning hardcoded roles.
        3. Return the result directly.

    Returns a JSON object:
    {
        "vehicle":        "camioneta propia" | "miniflete contratado",
        "assigned_names": ["Nombre Apellido", ...]   # actual employee names
    }

    Raises 422 if the Excel has no Manager Senior, or (for own van) no Parrilla
    role — both are caught from the ValueError raised by the lookup helpers and
    reported as a human-readable detail string.
    """
    data = _load_excel()

    try:
        return determine_frescos_vehicle(body.has_own_van, data["staff"])
    except ValueError as exc:
        # _find_manager_senior() and _find_highest_parrilla() raise ValueError
        # when the required role is absent.  Surfacing that message directly
        # gives the operator an actionable explanation without a stack trace.
        raise HTTPException(status_code=422, detail=str(exc))


@app.post(
    "/determine-second-miniflete",
    summary="Determine whether a second miniflete is needed for frescos",
    description=(
        "Reads the event Excel, inspects the 'prestaciones' sheet, and "
        "evaluates whether the volume of frescos for this event requires a "
        "second miniflete.  Triggers are based on menu type and guest count. "
        "If 'Estación de fuegos' is contracted the answer is always false."
    ),
)
def endpoint_determine_second_miniflete():
    """
    Workflow:
        1. Read the event Excel via _load_excel().
        2. Extract the 'services' list (from the 'prestaciones' sheet).
        3. Pass it to determine_second_miniflete() which applies the
           threshold rules defined in config.py.

    Returns a JSON object:
    {
        "needs_second_miniflete": true | false,
        "reason": "<human-readable explanation>"
    }
    """
    data = _load_excel()

    # "services" maps to the 'prestaciones' sheet rows — each is a dict with
    # keys "Servicio", "Detalle", and "Cantidad" as read from the Excel columns.
    return determine_second_miniflete(data["services"])


class DepartureTimeRequest(BaseModel):
    """
    Body for POST /calculate-departure-time.
    event_duration_hours: planned length of the event in hours (triggers extra prep if >= 8).
    picada_guests: guest count for the picada service; pass 0 if none is contracted.
    """
    event_duration_hours: float
    picada_guests: int


@app.post(
    "/calculate-departure-time",
    summary="Calculate CP departure time for the frescos vehicle",
    description=(
        "Reads the event start time and address from the Excel, queries the "
        "Distance Matrix API for the driving time from the CP to the event venue, "
        "then applies the departure formula from config.py.  Both the frescos "
        "vehicle and the second miniflete (if any) depart at the same time."
    ),
)
def endpoint_calculate_departure_time(body: DepartureTimeRequest):
    """
    Workflow:
        1. Read the Excel for 'hora_inicio', 'direccion_evento', 'ciudad_evento'.
        2. Geocode the event address to obtain lat/lng coordinates.
        3. Call the Distance Matrix API with the CP as origin and the event
           venue as destination to get the driving time in seconds.
        4. Pass everything to calculate_departure_time() from the logistics module.

    Returns a JSON object:
    {
        "departure_time":             "HH:MM",
        "extra_prep_applied":         true | false,
        "extra_prep_reason":          ["long event"] | ["picada"] | ["long event", "picada"] | [],
        "total_minutes_before_event": int
    }
    """
    data = _load_excel()
    event = data["event"]

    # -------------------------------------------------------------------------
    # Step 1: read the event start time from the Excel.
    # 'hora_inicio' is a raw field name from the Excel sheet — stays in Spanish.
    # -------------------------------------------------------------------------
    hora_inicio = str(event.get("hora_inicio", "")).strip()
    if not hora_inicio:
        raise HTTPException(
            status_code=422,
            detail="'hora_inicio' is missing or empty in the Excel event sheet.",
        )

    # -------------------------------------------------------------------------
    # Step 2: geocode the event venue address.
    # -------------------------------------------------------------------------
    event_address = (
        f"{event.get('direccion_evento', '')}, "
        f"{event.get('ciudad_evento', '')}"
    )
    event_coords = geocode(event_address)
    if event_coords is None:
        raise HTTPException(
            status_code=422,
            detail=f"Could not geocode the event address: '{event_address}'",
        )

    # -------------------------------------------------------------------------
    # Step 3: get driving time from the CP to the event venue.
    # CP_LAT / CP_LNG are the fixed coordinates of the production centre,
    # imported from config.py.  We wrap them in lists because calculate_distances()
    # always expects lists of coordinate dicts.
    # -------------------------------------------------------------------------
    cp_origin = [{"lat": CP_LAT, "lng": CP_LNG}]
    event_destination = [{"lat": event_coords["lat"], "lng": event_coords["lng"]}]

    matrix = calculate_distances(cp_origin, event_destination)

    # The matrix has exactly one row (one origin) and one element (one destination).
    # We check the status before reading the duration to give a clear error message.
    element = matrix["rows"][0]["elements"][0]
    if element["status"] != "OK":
        raise HTTPException(
            status_code=422,
            detail=(
                f"Distance Matrix API could not find a route from the CP to "
                f"'{event_address}'. Status: {element['status']}"
            ),
        )

    travel_seconds = element["duration"]["value"]

    # -------------------------------------------------------------------------
    # Step 4: apply the departure formula and return the result.
    # -------------------------------------------------------------------------
    return calculate_departure_time(
        event_time_str=hora_inicio,
        travel_seconds=travel_seconds,
        event_duration_hours=body.event_duration_hours,
        picada_guests=body.picada_guests,
    )


class RemainingPoolRequest(BaseModel):
    """
    Body for POST /get-remaining-pool.
    assigned_roles: list of role strings already committed to the frescos vehicle
                    and/or second miniflete (matched against the "Profesion" column).
    """
    assigned_roles: list[str]


@app.post(
    "/get-remaining-pool",
    summary="Build the remaining staff pool after frescos assignments",
    description=(
        "Reads the staff list from the Excel, removes any employee whose "
        "'Profesion' matches an assigned role, and returns the remaining pool "
        "with charter and alternative flags.  If status is 'charter' or "
        "'alternative', routing should not proceed until the user resolves it."
    ),
)
def endpoint_get_remaining_pool(body: RemainingPoolRequest):
    """
    Workflow:
        1. Read the Excel to get the full staff list.
        2. Pass staff and assigned_roles to get_remaining_pool().
        3. Return the pool summary with status and edge-case flags.

    # TODO: once role lookup is implemented, assigned_roles will be populated
    # automatically from the results of /determine-frescos and
    # /determine-second-miniflete — the user will not need to provide them manually.

    Returns a JSON object:
    {
        "remaining_pool":       [ { "Profesion": ..., "Nombre": ..., ... }, ... ],
        "remaining_count":      int,
        "assigned_to_frescos":  [ { ... }, ... ],
        "charter_required":     true | false,
        "alternative_required": true | false,
        "status":               "charter" | "alternative" | "proceed"
    }
    """
    data = _load_excel()

    # "staff" maps to the 'equipo' sheet — each dict has at least "Profesion",
    # which is what get_remaining_pool() uses for role matching.
    return get_remaining_pool(data["staff"], body.assigned_roles)


@app.get(
    "/detect-personal-vehicle",
    summary="Detect if any staff member has a personal vehicle available",
    description=(
        "Reads the full staff list from the Excel and checks the 'Auto' column "
        "for each employee.  Returns the driver and vehicle description if one "
        "is found.  Emits a warning if more than one car is listed — the first "
        "found is used and the others are ignored."
    ),
)
def endpoint_detect_personal_vehicle():
    """
    Delegates to detect_personal_vehicle() from the logistics module.

    This endpoint is called during Step 4b of the routing flow, after
    get_remaining_pool() has confirmed the pool size is valid (status "proceed").
    The result determines whether the remaining staff travel in a personal car
    + Uber combination, or in Ubers only.

    Returns a JSON object:
    {
        "has_personal_vehicle": true | false,
        "driver":               { "Profesion": ..., "Nombre": ..., "Auto": ..., ... } | null,
        "vehicle_description":  "Toyota Corolla" | null,
        "warning":              "More than one personal vehicle found. ..." | null
    }
    """
    data = _load_excel()

    # Pass the full staff list — detection is not filtered to the remaining pool
    # because the caller needs to know the driver's identity regardless of which
    # vehicle they were previously assigned to.
    return detect_personal_vehicle(data["staff"])


@app.get(
    "/calculate-driver-route",
    summary="Calculate base and direct driving routes for the personal car driver",
    description=(
        "Reads the Excel to find the personal car driver, geocodes their home address "
        "and the event venue, finds the nearest meeting point (PE), then calls the "
        "Google Routes API to compute two routes: driver home → PE → event (base route) "
        "and driver home → event (direct route, used for PEA and pickup-point evaluation). "
        "Raises 422 if no personal vehicle is found in the staff list."
    ),
)
def endpoint_calculate_driver_route():
    """
    Workflow:
        1. Read the Excel for the full staff list and event data.
        2. Detect the personal vehicle — if none, raise 422 immediately.
        3. Build the driver's home address from Direccion + CP + Ciudad and geocode it.
        4. Build the event address from direccion_evento + ciudad_evento and geocode it.
        5. Call nearest_meeting_point() to select the PE closest to the event venue.
        6. Call calculate_driver_route() with the three coordinate sets.

    Returns a JSON object:
    {
        "base_route": {
            "duration_seconds": int,
            "distance_meters":  int,
            "encoded_polyline": str,
            "legs":             list
        },
        "direct_route": {
            "duration_seconds": int,
            "distance_meters":  int,
            "encoded_polyline": str,
            "legs":             list
        }
    }
    """
    data = _load_excel()

    # -------------------------------------------------------------------------
    # Step 1: confirm a personal vehicle exists.
    # We check this before making any API calls — no point geocoding or routing
    # if there is no driver to build a route for.
    # -------------------------------------------------------------------------
    vehicle_info = detect_personal_vehicle(data["staff"])
    if not vehicle_info["has_personal_vehicle"]:
        raise HTTPException(
            status_code=422,
            detail="No personal vehicle found in staff list.",
        )

    driver = vehicle_info["driver"]

    # -------------------------------------------------------------------------
    # Step 2: geocode the driver's home address.
    # Address columns come from the Excel 'equipo' sheet — keys stay in Spanish.
    # -------------------------------------------------------------------------
    driver_address = (
        f"{str(driver.get('Direccion', '')).strip()}, "
        f"{str(driver.get('CP', '')).strip()}, "
        f"{str(driver.get('Ciudad', '')).strip()}"
    )
    driver_coords = geocode(driver_address)
    if driver_coords is None:
        raise HTTPException(
            status_code=422,
            detail=f"Could not geocode driver address: '{driver_address}'",
        )

    # -------------------------------------------------------------------------
    # Step 3: geocode the event venue address.
    # -------------------------------------------------------------------------
    event = data["event"]
    event_address = (
        f"{event.get('direccion_evento', '')}, "
        f"{event.get('ciudad_evento', '')}"
    )
    event_coords = geocode(event_address)
    if event_coords is None:
        raise HTTPException(
            status_code=422,
            detail=f"Could not geocode event address: '{event_address}'",
        )

    # -------------------------------------------------------------------------
    # Step 4: find the nearest meeting point (PE) to the event venue.
    # This is the same PE used by the Uber vehicles and is the intermediate
    # waypoint in Route A.
    # -------------------------------------------------------------------------
    try:
        meeting_point = nearest_meeting_point(event_coords)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    # -------------------------------------------------------------------------
    # Step 5: calculate both routes via the Routes API and return the result.
    # extra_hours is False here: event_duration_hours is not known at this stage
    # (it comes from user input at confirm time).  Using the base DEPARTURE_PREP_HOURS
    # window gives traffic-accurate travel times for the common case.
    # -------------------------------------------------------------------------
    arrival_time = _compute_arrival_time(
        event.get("hora_inicio", ""),
        event.get("fecha", ""),
        extra_hours=False,
    )
    return calculate_driver_route(driver_coords, meeting_point, event_coords, arrival_time=arrival_time)


@app.get(
    "/evaluate-pea",
    summary="Evaluate alternative meeting point (PEA) candidates along the driver's direct route",
    description=(
        "Runs the full PEA evaluation pipeline: geocodes all staff, finds the nearest "
        "meeting point (PE), computes the driver's base and direct routes, searches for "
        "transit hubs along the direct route, then evaluates each candidate against the "
        "remaining staff pool using public-transport travel times.  Returns up to 3 ranked "
        "PEA candidates (if any) and both route polylines for the frontend to render.  "
        "Pickup logic is separate — use POST /find-pickup on demand once the user selects "
        "an employee from the map."
    ),
)
def endpoint_evaluate_pea():
    """
    Workflow:
        1. Read the Excel for staff and event data.
        2. Geocode all staff — adds "coordinates" to each employee dict in-place.
           The remaining-pool members need coordinates for the transit-time matrix.
        3. Detect the personal vehicle; raise 422 if none exists.
        4. Use the driver's geocoded coordinates (already set in step 2).
        5. Geocode the event venue address.
        6. Find the nearest meeting point (PE) to the event venue.
        7. Calculate both driver routes (base: home→PE→event, direct: home→event).
           Both polylines are returned so the frontend can render each scenario.
        8. Search for PEA candidates along the direct route polyline.
        9. Build the remaining staff pool by removing the frescos-assigned roles.
           TODO: replace the hardcoded role list with the result of /determine-frescos
           and /determine-second-miniflete once role lookup is implemented.
       10. Evaluate the candidates against the pool and return ranked results.

    Pickup logic is intentionally excluded here.  It runs on demand via
    POST /find-pickup only when the user explicitly selects an employee on the
    map — making every API call at this stage would be wasteful because the
    user may never request a pickup, or may request it for a different employee
    than the algorithm would suggest.

    Returns a JSON object:
    {
        "meeting_point": {
            "name":             str,
            "address":          str,
            "lat":              float,
            "lng":              float,
            "duration_seconds": int,
            "duration_text":    str,
            "distance_meters":  int,
            "distance_text":    str
        },
        "driver_routes": {
            "base_route":   { "duration_seconds": int, "distance_meters": int,
                              "encoded_polyline": str, "legs": list },
            "direct_route": { "duration_seconds": int, "distance_meters": int,
                              "encoded_polyline": str, "legs": list }
        },
        "pea_evaluation": {
            "has_candidates": bool,
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
                            "time_saved_min":           float
                        },
                        ...  # up to MAX_PASSENGERS_PER_CAR (4) entries
                    ],
                    "exclusively_prefer_count": int,
                    "pea_near_original":        bool,
                    "remuneration_note":        str | null,
                    "staff_metrics": [
                        {
                            "employee_name":            str,
                            "transit_to_candidate_min": float,
                            "transit_to_pe_min":        float,
                            "time_saved_min":           float,
                            "exceeds_max_transit":      bool
                        },
                        ...
                    ]
                },
                ...  # up to 3, ranked by top4_savings_minutes descending
            ]
        }
    }
    """
    data = _load_excel()

    # -------------------------------------------------------------------------
    # Step 1: geocode all staff up-front.
    # evaluate_pea_candidates() needs each remaining-pool member's coordinates
    # to query transit times.  geocode_staff() adds "coordinates" to every
    # employee dict in-place, so later calls to detect_personal_vehicle() and
    # get_remaining_pool() will receive the enriched dicts automatically.
    # -------------------------------------------------------------------------
    geocode_staff(data["staff"])

    # -------------------------------------------------------------------------
    # Step 2: detect the personal vehicle.
    # After geocode_staff(), the driver dict already has a "coordinates" key,
    # so we can use it directly without a second geocoding call.
    # -------------------------------------------------------------------------
    vehicle_info = detect_personal_vehicle(data["staff"])
    if not vehicle_info["has_personal_vehicle"]:
        raise HTTPException(
            status_code=422,
            detail="No personal vehicle found in staff list.",
        )

    driver        = vehicle_info["driver"]
    driver_coords = driver["coordinates"]
    driver_name   = f"{driver.get('Nombre', '')} {driver.get('Apellido', '')}".strip()

    if driver_coords is None:
        raise HTTPException(
            status_code=422,
            detail="Could not geocode the driver's home address.",
        )

    # -------------------------------------------------------------------------
    # Step 3: geocode the event venue address.
    # -------------------------------------------------------------------------
    event = data["event"]
    event_address = (
        f"{event.get('direccion_evento', '')}, "
        f"{event.get('ciudad_evento', '')}"
    )
    event_coords = geocode(event_address)
    if event_coords is None:
        raise HTTPException(
            status_code=422,
            detail=f"Could not geocode the event address: '{event_address}'",
        )

    # -------------------------------------------------------------------------
    # Step 4: find the nearest meeting point (PE) to the event venue.
    # -------------------------------------------------------------------------
    try:
        meeting_point = nearest_meeting_point(event_coords)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    # -------------------------------------------------------------------------
    # Step 5: compute both driver routes.
    # The base route (home → PE → event) is the path the driver takes when the
    # original PE is confirmed.  The direct route (home → event, no stopover)
    # is used to search for PEA candidates — we want stations the driver would
    # naturally pass, not ones that require a detour.
    # Both polylines are returned so the frontend can render each scenario and
    # pass the correct one to POST /find-pickup when the user requests it.
    # extra_hours is False here for the same reason as /calculate-driver-route:
    # event_duration_hours is not known at the PEA evaluation stage.
    # -------------------------------------------------------------------------
    arrival_time = _compute_arrival_time(
        event.get("hora_inicio", ""),
        event.get("fecha", ""),
        extra_hours=False,
    )
    routes          = calculate_driver_route(driver_coords, meeting_point, event_coords, arrival_time=arrival_time)
    direct_polyline = routes["direct_route"]["encoded_polyline"]

    # -------------------------------------------------------------------------
    # Step 6: build the remaining staff pool.
    # TODO: replace hardcoded assigned_roles with the actual output of
    # /determine-frescos and /determine-second-miniflete once role lookup is
    # implemented.  For now we use the two default frescos roles.
    # -------------------------------------------------------------------------
    assigned_roles   = ["Manager Senior", "Jefe de Parrilla Senior"]
    remaining_result = get_remaining_pool(data["staff"], assigned_roles)
    remaining_pool   = remaining_result["remaining_pool"]

    # -------------------------------------------------------------------------
    # Step 7: evaluate PEA candidates using the employee-centric pipeline.
    # evaluate_pea_candidates() now owns the Places API search internally:
    # it filters employees near the route, clusters them, and makes one Places
    # call per cluster instead of ~40 calls across the full polyline.
    # -------------------------------------------------------------------------
    pea_result = evaluate_pea_candidates(
        remaining_pool=remaining_pool,
        meeting_point=meeting_point,
        route_polyline=direct_polyline,
        driver_name=driver_name,
    )

    return {
        "meeting_point":  meeting_point,
        "driver_routes":  routes,
        "pea_evaluation": pea_result,
    }


# -----------------------------------------------------------------------------
# /assign-passengers request body model (also reused by /find-pickup)
# -----------------------------------------------------------------------------

class MeetingPointInput(BaseModel):
    """
    The meeting point the user has confirmed (PE or PEA).
    Mirrors the lat/lng/name shape returned by nearest_meeting_point() and
    evaluate_pea_candidates(), so the frontend can pass either result directly.
    Reused by FindPickupRequest and AssignPassengersRequest.
    """
    name: str
    lat:  float
    lng:  float


# =============================================================================
# Step 7 — on-demand pickup search
# =============================================================================

class FindPickupRequest(BaseModel):
    """
    Body for POST /find-pickup.

    employee_name:  Full name ("Nombre Apellido") of the employee the user
                    selected on the map.  Used to look up the employee in the
                    geocoded staff list so that their coordinates come from the
                    single source of truth (the Excel), not from the frontend.

    route_polyline: The encoded polyline of the driver's chosen route.
                    The frontend supplies this because only it knows which
                    scenario the user selected:
                      - PE chosen  → base route polyline  (home → PE → event)
                      - PEA chosen → direct route polyline (home → event)
                    The backend has no persistent state between requests, so
                    it cannot infer the active scenario on its own.

    meeting_point:  The confirmed PE or PEA.  Transit-time savings for the
                    employee are measured against this point.
    """
    employee_name:  str
    route_polyline: str
    meeting_point:  MeetingPointInput


@app.post(
    "/find-pickup",
    summary="Find pickup venue options for a specific employee along the driver's route",
    description=(
        "Called on demand when the user opens the map context menu for an employee "
        "and selects 'Find pickup on route'.  Geocodes the full staff list, locates "
        "the named employee, then searches for transit-hub pickup venues along the "
        "provided route polyline using the Distance Matrix and Places APIs.  "
        "Returns transit-time data and candidate venues so the manager can decide "
        "whether to offer the pickup.  Always returns 200 — if no result is possible "
        "the response has pickup_candidate: null with an explanatory reason string."
    ),
)
def endpoint_find_pickup(body: FindPickupRequest):
    """
    Why this endpoint is on-demand rather than called automatically:
        Pickup evaluation makes two external API calls (Distance Matrix +
        Places API) per employee.  Running it automatically for every candidate
        on every page load would burn quota unnecessarily — most events will
        not use a pickup at all.  Instead, the frontend calls this endpoint
        only when the user explicitly opens the context menu and requests it.

    Why the polyline comes from the frontend:
        The backend is stateless.  After /evaluate-pea returns, it retains no
        memory of which scenario the user is considering.  Only the frontend
        knows whether the user selected the PE or PEA as the confirmed meeting
        point, and therefore which route polyline is the active one.  The
        frontend passes the correct polyline back so the search targets the
        route the driver will actually take.

    Why we re-geocode from the Excel rather than accepting the full employee dict:
        Accepting arbitrary employee data from the frontend would create a
        second source of truth and open the door to stale or tampered data.
        Re-reading from the Excel keeps the backend authoritative: coordinates
        always come from the same geocoding call we made during /evaluate-pea,
        and any data-entry error in the Excel is caught consistently.

    Workflow:
        1. Read the Excel and geocode all staff.
        2. Find the employee whose "Nombre Apellido" matches employee_name.
           Raise 422 if no match is found.
        3. Call find_pickup_candidate() with the matched employee, the
           route polyline, and the meeting point from the request body.
        4. Return the result directly — pickup_candidate: null is a valid
           outcome (e.g. no transit route exists) and is not an HTTP error.

    Returns a JSON object — see find_pickup_candidate() for the full schema.
    Two possible shapes:

    When a result is available (even with empty place_options):
    {
        "pickup_candidate": {
            "employee":                       { ... },
            "cross_point":                    { "lat": float, "lng": float },
            "transit_time_to_pickup_minutes": int,
            "transit_time_to_pe_minutes":     int,
            "time_saved_minutes":             int,
            "transit_warning":                bool,
            "time_saving_warning":            bool,
            "place_options":                  [ { ... }, ... ]
        },
        "reason": null
    }

    When no result is possible (genuine impossibility):
    {
        "pickup_candidate": null,
        "reason": str
    }
    """
    data = _load_excel()

    # -------------------------------------------------------------------------
    # Step 1: geocode all staff.
    # We always geocode the full list rather than only the requested employee
    # because geocode_staff() enriches dicts in-place and the function is
    # designed to batch-process the list.  The extra geocoding calls are
    # inexpensive relative to the Distance Matrix + Places calls that follow,
    # and it keeps this endpoint consistent with /evaluate-pea.
    # -------------------------------------------------------------------------
    geocode_staff(data["staff"])

    # -------------------------------------------------------------------------
    # Step 2: find the matching employee.
    # We match on "Nombre Apellido" — the same format the frontend uses to
    # identify employees on the map and the format returned by /geocode-staff.
    # -------------------------------------------------------------------------
    full_name = body.employee_name.strip()
    matched_employee = None
    for emp in data["staff"]:
        emp_full_name = f"{emp.get('Nombre', '')} {emp.get('Apellido', '')}".strip()
        if emp_full_name == full_name:
            matched_employee = emp
            break

    if matched_employee is None:
        raise HTTPException(
            status_code=422,
            detail=f"Employee '{full_name}' not found in staff list.",
        )

    # -------------------------------------------------------------------------
    # Step 3: convert the Pydantic meeting-point model to a plain dict.
    # find_pickup_candidate() expects the same shape as the dicts returned by
    # nearest_meeting_point() — {"name": str, "lat": float, "lng": float}.
    # -------------------------------------------------------------------------
    meeting_point_dict = {
        "name": body.meeting_point.name,
        "lat":  body.meeting_point.lat,
        "lng":  body.meeting_point.lng,
    }

    # -------------------------------------------------------------------------
    # Step 4: run the pickup search and return the result directly.
    # pickup_candidate: null is a valid response (impossibility, not an error).
    # -------------------------------------------------------------------------
    return find_pickup_candidate(
        route_polyline=body.route_polyline,
        employee=matched_employee,
        meeting_point=meeting_point_dict,
    )


class AssignPassengersRequest(BaseModel):
    """
    Body for POST /assign-passengers.

    chosen_meeting_point: the PE or PEA the user selected at the end of the
                          PEA evaluation step.
    assigned_roles:       role strings already committed to the frescos vehicle
                          and/or second miniflete; used to rebuild the remaining
                          pool the same way /get-remaining-pool did.

    TODO: once frontend state management is implemented, both fields will be
    populated automatically from the results of the preceding steps and the
    user will not need to supply them manually.
    """
    chosen_meeting_point: MeetingPointInput
    assigned_roles:       list[str]


@app.post(
    "/assign-passengers",
    summary="Assign remaining staff to personal vehicle and Uber groups",
    description=(
        "Reads the staff list from the Excel, rebuilds the remaining pool after "
        "excluding the frescos-assigned roles, detects the personal vehicle driver, "
        "and assigns every remaining employee to either the personal car or an Uber "
        "group.  Personal car passengers are chosen by proximity to the confirmed "
        "meeting point; Uber passengers are grouped in batches of MAX_PASSENGERS_UBER. "
        "Raises 422 if no personal vehicle is found — use /assign-uber-only instead."
    ),
)
def endpoint_assign_passengers(body: AssignPassengersRequest):
    """
    Workflow:
        1. Read the Excel to obtain the full staff list.
        2. Geocode all staff — coordinates are needed for proximity sorting.
        3. Rebuild the remaining pool by excluding the frescos-assigned roles.
        4. Detect the personal vehicle driver; raise 422 if none is found.
        5. Call assign_vehicle_passengers() with the pool, driver, and the
           user-confirmed meeting point.

    Returns a JSON object:
    {
        "personal_vehicle": {
            "driver":          { ... },
            "passengers":      [ { ... }, ... ],
            "total_occupants": int
        },
        "uber_groups": [
            {
                "group_number":  int,
                "passengers":    [ { ... }, ... ],
                "meeting_point": { "name": str, "lat": float, "lng": float }
            },
            ...
        ],
        "single_employee_warning": str | null
    }
    """
    data = _load_excel()

    # -------------------------------------------------------------------------
    # Step 1: geocode all staff.
    # assign_vehicle_passengers() sorts by Haversine distance to the meeting
    # point, which requires coordinates on every employee dict.
    # -------------------------------------------------------------------------
    geocode_staff(data["staff"])

    # -------------------------------------------------------------------------
    # Step 2: rebuild the remaining pool by excluding frescos-assigned roles.
    # We replicate the same filtering that /get-remaining-pool performs so that
    # this endpoint can be called independently without requiring the caller to
    # pass the pool explicitly.
    # -------------------------------------------------------------------------
    remaining_result = get_remaining_pool(data["staff"], body.assigned_roles)
    remaining_pool   = remaining_result["remaining_pool"]

    # -------------------------------------------------------------------------
    # Step 3: detect the personal vehicle driver.
    # If no employee has a personal car listed, this endpoint cannot proceed —
    # all remaining staff must be routed via Uber, which is a separate flow.
    # -------------------------------------------------------------------------
    vehicle_info = detect_personal_vehicle(data["staff"])
    if not vehicle_info["has_personal_vehicle"]:
        raise HTTPException(
            status_code=422,
            detail=(
                "No personal vehicle available — all staff must use Uber. "
                "Use /assign-uber-only endpoint instead."
            ),
        )

    driver = vehicle_info["driver"]

    # -------------------------------------------------------------------------
    # Step 4: assign passengers to personal vehicle and Uber groups.
    # Convert the Pydantic model to a plain dict so assign_vehicle_passengers()
    # receives the same shape as meeting point dicts returned by the maps module.
    # -------------------------------------------------------------------------
    meeting_point_dict = {
        "name": body.chosen_meeting_point.name,
        "lat":  body.chosen_meeting_point.lat,
        "lng":  body.chosen_meeting_point.lng,
    }

    return assign_vehicle_passengers(remaining_pool, driver, meeting_point_dict)


class UberOnlyRequest(BaseModel):
    """
    Body for POST /assign-uber-only.

    Used when no personal vehicle is available — every remaining employee
    must travel by Uber.  The request shape is identical to
    AssignPassengersRequest; a separate model makes the intent explicit and
    allows the two endpoints to evolve independently.

    chosen_meeting_point: the PE or PEA the user selected.
    assigned_roles:       role strings already committed to the frescos vehicle
                          and/or second miniflete; used to rebuild the remaining
                          pool the same way /get-remaining-pool did.
    """
    chosen_meeting_point: MeetingPointInput
    assigned_roles:       list[str]


@app.post(
    "/assign-uber-only",
    summary="Assign all remaining staff to Uber groups (no personal vehicle)",
    description=(
        "Used when no employee has a personal vehicle available.  Reads the "
        "staff list from the Excel, rebuilds the remaining pool, and assigns "
        "every remaining employee to Uber groups of up to MAX_PASSENGERS_UBER "
        "each.  All groups share the same chosen meeting point.  The "
        "personal_vehicle key in the response is None."
    ),
)
def endpoint_assign_uber_only(body: UberOnlyRequest):
    """
    Workflow:
        1. Read the Excel to obtain the full staff list.
        2. Geocode all staff.
        3. Rebuild the remaining pool by excluding the frescos-assigned roles.
        4. Call assign_uber_only() with the pool and the confirmed meeting point.

    Returns a JSON object:
    {
        "personal_vehicle": null,
        "uber_groups": [
            {
                "group_number":  int,
                "passengers":    [ { ... }, ... ],
                "meeting_point": { "name": str, "lat": float, "lng": float }
            },
            ...
        ],
        "single_employee_warning": str | null
    }
    """
    data = _load_excel()

    # -------------------------------------------------------------------------
    # Step 1: geocode all staff.
    # Not required for Uber-only (no Haversine sorting), but keeps the pool
    # data consistent with what /validate-assignments and downstream functions
    # expect (coordinates on each employee dict).
    # -------------------------------------------------------------------------
    geocode_staff(data["staff"])

    # -------------------------------------------------------------------------
    # Step 2: rebuild the remaining pool by excluding frescos-assigned roles.
    # -------------------------------------------------------------------------
    remaining_result = get_remaining_pool(data["staff"], body.assigned_roles)
    remaining_pool   = remaining_result["remaining_pool"]

    # -------------------------------------------------------------------------
    # Step 3: assign all remaining employees to Uber groups.
    # -------------------------------------------------------------------------
    meeting_point_dict = {
        "name": body.chosen_meeting_point.name,
        "lat":  body.chosen_meeting_point.lat,
        "lng":  body.chosen_meeting_point.lng,
    }

    return assign_uber_only(remaining_pool, meeting_point_dict)


# =============================================================================
# Step 8 — assignment validation and confirmation
# =============================================================================

# -----------------------------------------------------------------------------
# Shared sub-model for the assignments dict sent by the frontend.
# Placed here (not inside the request model) so both /validate-assignments and
# /confirm-assignments can reference the same model without duplication.
# -----------------------------------------------------------------------------

class AssignmentsInput(BaseModel):
    """
    The user-submitted vehicle groupings produced by the interactive map.

    driver:           full name ("Nombre Apellido") of the personal car driver.
    car_passengers:   full names of employees travelling in the personal car.
    uber_groups:      each inner list is one Uber booking; names in "Nombre Apellido".
    pickup_employee:  full name of the employee picked up along the route, or None.
    pending_employee: full name of the single employee left without Uber (alternative
                      transport to be arranged separately), or None if not applicable.
    """
    driver:           str
    car_passengers:   list[str]
    uber_groups:      list[list[str]]
    pickup_employee:  str | None = None
    pending_employee: str | None = None


class ValidateAssignmentsRequest(BaseModel):
    """
    Body for POST /validate-assignments.

    assignments:    the user-submitted groupings to be validated.
    assigned_roles: role strings already committed to the frescos vehicle and/or
                    second miniflete (used to rebuild the remaining pool the same
                    way /get-remaining-pool did in the earlier step).
    """
    assignments:    AssignmentsInput
    assigned_roles: list[str]


class ConfirmAssignmentsRequest(BaseModel):
    """
    Body for POST /confirm-assignments.

    Extends ValidateAssignmentsRequest with the fields that are only known once
    the user has made their final map decisions:

    chosen_meeting_point: the PE or PEA the user confirmed on the map.
    has_own_van:          whether the company van was available (needed to call
                          determine_frescos_vehicle() and recover the exact
                          vehicle name for the summary).
    event_duration_hours: planned length of the event in hours; required to
                          compute the CP departure time via calculate_departure_time().
    picada_guests:        guest count for any picada service; required for the
                          same calculation.  Pass 0 if none was contracted.
    """
    assignments:          AssignmentsInput
    assigned_roles:       list[str]
    chosen_meeting_point: MeetingPointInput   # reuse model from /assign-passengers
    has_own_van:          bool
    event_duration_hours: float
    picada_guests:        int


@app.post(
    "/validate-assignments",
    summary="Validate that every remaining employee has been assigned to a vehicle",
    description=(
        "Reads the Excel, rebuilds the remaining staff pool after excluding the "
        "frescos-assigned roles, and checks that every employee in that pool "
        "appears exactly once in the submitted assignments.  Returns 422 with the "
        "list of unassigned employees if validation fails.  On success, returns a "
        "partial assignment summary (without departure times, which are computed "
        "only at the confirm step) for the user to review in the confirmation modal."
    ),
)
def endpoint_validate_assignments(body: ValidateAssignmentsRequest):
    """
    Workflow:
        1. Read the Excel to obtain the staff list and services.
        2. Geocode all staff — needed for coordinates in any subsequent steps.
        3. Rebuild the remaining pool by excluding the frescos-assigned roles.
        4. Call validate_assignments() to check coverage.
           If invalid → 422 with the list of unassigned / unknown employees.
        5. Infer the frescos vehicle type from assigned_roles so we do not need
           has_own_van in this lighter request body.
        6. Compute the second miniflete result from the services sheet.
        7. Call build_assignment_summary() and return it for modal preview.
           departure_from_cp and departure_from_pe are None at this stage —
           they are computed in the confirm step.

    Returns a JSON object matching the build_assignment_summary() shape, or:
    {
        "detail": {
            "valid":                false,
            "unassigned_employees": [...],
            "unknown_assignments":  [...],
            "message":              "..."
        }
    }
    on validation failure (HTTP 422).
    """
    data = _load_excel()

    # -------------------------------------------------------------------------
    # Step 1: geocode all staff.
    # Coordinates are needed for subsequent steps in the full flow; geocoding
    # here ensures the enriched dicts are available to every helper called below.
    # -------------------------------------------------------------------------
    geocode_staff(data["staff"])

    # -------------------------------------------------------------------------
    # Step 2: rebuild the remaining pool — same filtering as /get-remaining-pool.
    # -------------------------------------------------------------------------
    remaining_result = get_remaining_pool(data["staff"], body.assigned_roles)
    remaining_pool   = remaining_result["remaining_pool"]

    # -------------------------------------------------------------------------
    # Step 3: validate coverage.
    # Convert the Pydantic model to a plain dict so validate_assignments()
    # receives the same shape as the raw frontend JSON.
    # -------------------------------------------------------------------------
    assignments_dict = body.assignments.model_dump()
    validation       = validate_assignments(remaining_pool, assignments_dict)

    if not validation["valid"]:
        # Return the full validation detail as the error body so the frontend
        # can highlight exactly which employees are missing or mistyped.
        raise HTTPException(status_code=422, detail=validation)

    # -------------------------------------------------------------------------
    # Step 4: infer frescos vehicle type from assigned_roles.
    # ValidateAssignmentsRequest does not carry has_own_van explicitly, but we
    # can infer it: the frontend always includes the Parrilla role string in
    # assigned_roles when a van was used.  Checking for "parrilla" (normalised,
    # lowercase) is more robust than matching the exact role string exactly.
    # -------------------------------------------------------------------------
    inferred_has_own_van = any(
        "parrilla" in r.lower() for r in body.assigned_roles
    )
    frescos_result = determine_frescos_vehicle(inferred_has_own_van, data["staff"])

    # -------------------------------------------------------------------------
    # Step 5: evaluate second miniflete — only needs the services list.
    # Pass None to the summary if a second miniflete is not needed so the
    # frontend knows to hide that section of the modal.
    # -------------------------------------------------------------------------
    second_miniflete_info   = determine_second_miniflete(data["services"])
    second_miniflete_result = (
        second_miniflete_info
        if second_miniflete_info["needs_second_miniflete"]
        else None
    )

    # -------------------------------------------------------------------------
    # Step 6: assemble the partial summary.
    # chosen_meeting_point and departure_time_result are None here — the user
    # has not yet clicked "Confirm" on the map modal, so those values are not
    # available.  The frontend renders the summary with those fields blank and
    # fills them in after the user confirms.
    # -------------------------------------------------------------------------
    return build_assignment_summary(
        assignments=assignments_dict,
        chosen_meeting_point=None,
        frescos_result=frescos_result,
        second_miniflete_result=second_miniflete_result,
        departure_time_result=None,
    )


@app.post(
    "/confirm-assignments",
    summary="Final confirmation of all assignments — returns the complete event summary",
    description=(
        "Called only after the user has reviewed the preview modal and clicked "
        "Confirm.  Re-validates assignments as a safety check, then computes the "
        "full summary including the CP departure time.  Returns the complete "
        "summary object that populates both draggable output blocks on the map."
    ),
)
def endpoint_confirm_assignments(body: ConfirmAssignmentsRequest):
    """
    Workflow:
        1. Read the Excel to obtain staff list and services.
        2. Geocode all staff.
        3. Rebuild the remaining pool.
        4. Safety-validate assignments again — guards against stale frontend state.
           Returns 422 if invalid (same shape as /validate-assignments).
        5. Call determine_frescos_vehicle(has_own_van) for the exact vehicle name.
        6. Evaluate second miniflete from the services sheet.
        7. Geocode the event venue and query the Distance Matrix API for the
           driving time from CP to the event venue.
        8. Call calculate_departure_time() to get departure_from_cp.
        9. Query the Routes API for PE/PEA → event driving time; call
           calculate_pe_departure_time() to get departure_from_pe.
       10. Call build_assignment_summary() with all computed results and return
           the complete confirmed summary.

    Returns a JSON object matching the build_assignment_summary() shape with
    both departure_from_cp and departure_from_pe populated.
    """
    data = _load_excel()

    # -------------------------------------------------------------------------
    # Step 1: geocode all staff.
    # -------------------------------------------------------------------------
    geocode_staff(data["staff"])

    # -------------------------------------------------------------------------
    # Step 2: rebuild remaining pool.
    # -------------------------------------------------------------------------
    remaining_result = get_remaining_pool(data["staff"], body.assigned_roles)
    remaining_pool   = remaining_result["remaining_pool"]

    # -------------------------------------------------------------------------
    # Step 3: safety re-validation.
    # The user may have been on the map for a while; re-checking here prevents
    # a corrupted assignment from being persisted as "confirmed".
    # -------------------------------------------------------------------------
    assignments_dict = body.assignments.model_dump()
    validation       = validate_assignments(remaining_pool, assignments_dict)

    if not validation["valid"]:
        raise HTTPException(status_code=422, detail=validation)

    # -------------------------------------------------------------------------
    # Step 4: compute frescos result with the real has_own_van value.
    # Unlike the validate step (which infers it), here we have the authoritative
    # has_own_van flag from the user, so we call determine_frescos_vehicle()
    # directly to get the canonical vehicle name and assigned employee names.
    # -------------------------------------------------------------------------
    frescos_result = determine_frescos_vehicle(body.has_own_van, data["staff"])

    # -------------------------------------------------------------------------
    # Step 5: second miniflete.
    # -------------------------------------------------------------------------
    second_miniflete_info   = determine_second_miniflete(data["services"])
    second_miniflete_result = (
        second_miniflete_info
        if second_miniflete_info["needs_second_miniflete"]
        else None
    )

    # -------------------------------------------------------------------------
    # Step 6: compute CP departure time.
    # We need to geocode the event venue and query the Distance Matrix API for
    # driving time from the CP to the event, then feed that into
    # calculate_departure_time() alongside the event duration and picada guests.
    # -------------------------------------------------------------------------
    event = data["event"]
    event_address = (
        f"{event.get('direccion_evento', '')}, "
        f"{event.get('ciudad_evento', '')}"
    )
    event_coords = geocode(event_address)
    if event_coords is None:
        raise HTTPException(
            status_code=422,
            detail=f"Could not geocode the event address: '{event_address}'",
        )

    hora_inicio = str(event.get("hora_inicio", "")).strip()
    if not hora_inicio:
        raise HTTPException(
            status_code=422,
            detail="'hora_inicio' is missing or empty in the Excel event sheet.",
        )

    cp_origin         = [{"lat": CP_LAT, "lng": CP_LNG}]
    event_destination = [{"lat": event_coords["lat"], "lng": event_coords["lng"]}]

    # Use compute_route_matrix() with arrivalTime so the Routes API applies
    # historical traffic for the exact hour the frescos vehicle must arrive.
    # extra_hours mirrors the same condition used by calculate_departure_time().
    extra_hours = (
        body.event_duration_hours >= LONG_EVENT_DURATION_THRESHOLD
        or body.picada_guests >= PICADA_GUEST_THRESHOLD
    )
    arrival_time = _compute_arrival_time(hora_inicio, event.get("fecha", ""), extra_hours)
    matrix   = compute_route_matrix(cp_origin, event_destination, arrival_time=arrival_time)
    element  = matrix["rows"][0]["elements"][0]

    if element["status"] != "OK":
        raise HTTPException(
            status_code=422,
            detail=(
                f"Routes API could not find a route from the CP to "
                f"'{event_address}'. Status: {element['status']}"
            ),
        )

    travel_seconds = element["duration"]["value"]

    departure_time_result = calculate_departure_time(
        event_time_str=hora_inicio,
        travel_seconds=travel_seconds,
        event_duration_hours=body.event_duration_hours,
        picada_guests=body.picada_guests,
    )

    # -------------------------------------------------------------------------
    # Step 7: PE/PEA → event driving time → PE departure time.
    # The same arrival_time applies here — both the CP frescos vehicle and the
    # personal car must arrive at the event at the same setup deadline.
    # comensales is read from the Excel (not from body.picada_guests) so that
    # calculate_pe_departure_time() can apply its own picada detection logic.
    # -------------------------------------------------------------------------
    try:
        comensales = int(event.get("comensales", 0))
    except (ValueError, TypeError):
        comensales = 0

    pe_origin  = [{
        "lat": body.chosen_meeting_point.lat,
        "lng": body.chosen_meeting_point.lng,
    }]
    pe_matrix  = compute_route_matrix(pe_origin, event_destination, arrival_time=arrival_time)
    pe_element = pe_matrix["rows"][0]["elements"][0]

    if pe_element["status"] != "OK":
        raise HTTPException(
            status_code=422,
            detail=(
                f"Routes API could not find a route from the meeting point "
                f"to '{event_address}'. Status: {pe_element['status']}"
            ),
        )

    pe_departure = calculate_pe_departure_time(
        event_time_str=hora_inicio,
        travel_seconds=pe_element["duration"]["value"],
        event_duration_hours=body.event_duration_hours,
        prestaciones=data["services"],
        comensales=comensales,
    )

    # -------------------------------------------------------------------------
    # Step 8: assemble and return the complete confirmed summary.
    # chosen_meeting_point is now available (the user confirmed it on the map),
    # so the meeting_point field in the summary will be populated.
    # -------------------------------------------------------------------------
    chosen_meeting_point_dict = {
        "name": body.chosen_meeting_point.name,
        "lat":  body.chosen_meeting_point.lat,
        "lng":  body.chosen_meeting_point.lng,
    }

    return build_assignment_summary(
        assignments=assignments_dict,
        chosen_meeting_point=chosen_meeting_point_dict,
        frescos_result=frescos_result,
        second_miniflete_result=second_miniflete_result,
        departure_time_result=departure_time_result,
        pe_departure_time_result=pe_departure,
    )


# =============================================================================
# Step 8 — final output
# =============================================================================

class FinalOutputRequest(BaseModel):
    """
    Body for POST /final-output.

    Similar to ConfirmAssignmentsRequest but without event_duration_hours and
    picada_guests: both values are read from the Excel (or temporarily hardcoded)
    inside the endpoint rather than supplied by the frontend.  The design
    intention is that all event-level data eventually comes from the Excel
    'evento' sheet, not from repeated form input.

    assignments:          the user-confirmed vehicle groupings.
    assigned_roles:       roles already committed to the frescos vehicle.
    chosen_meeting_point: the PE or PEA the user confirmed on the map.
    has_own_van:          whether the company van was available for this event.
    """
    assignments:          AssignmentsInput
    assigned_roles:       list[str]
    chosen_meeting_point: MeetingPointInput
    has_own_van:          bool


@app.post(
    "/final-output",
    summary="Build the complete final output for both draggable map blocks",
    description=(
        "Called immediately after the user clicks Confirm on the assignment modal. "
        "Re-validates assignments as a final safety check, then computes both "
        "departure times (CP for frescos, PE/PEA for staff vehicles) and assembles "
        "the two draggable output blocks shown on the map: the frescos block and "
        "the transport block."
    ),
)
def endpoint_final_output(body: FinalOutputRequest):
    """
    Workflow:
        1. Read the Excel for staff, services, event data (hora_inicio, comensales,
           prestaciones).
        2. Geocode all staff.
        3. Rebuild the remaining pool.
        4. Final safety re-validation of assignments.
        5. Compute frescos_result and second_miniflete_result.
        6. Geocode the event venue address.
        7. Distance Matrix: CP → event → calculate_departure_time() → cp_departure.
        8. Distance Matrix: PE/PEA → event → calculate_pe_departure_time() → pe_departure.
        9. Assemble confirmed_summary via build_assignment_summary().
       10. Assemble and return the two draggable blocks via build_final_output().

    Returns a JSON object:
    {
        "frescos_block": {
            "vehicle":             str,
            "assigned_roles":      list[str],
            "departure_from_cp":   "HH:MM",
            "departure_breakdown": dict,
            "second_miniflete":    dict | None
        },
        "transport_block": {
            "meeting_point":       dict,
            "departure_from_pe":   "HH:MM",
            "departure_breakdown": dict,
            "personal_vehicle":    dict,
            "uber_groups":         list[dict]
        }
    }
    """
    data = _load_excel()

    # -------------------------------------------------------------------------
    # Step 1: read event-level fields from the Excel.
    # 'hora_inicio' and 'comensales' live in the 'evento' sheet (field/value
    # format); 'services' is the parsed 'prestaciones' sheet.
    # -------------------------------------------------------------------------
    event        = data["event"]
    hora_inicio  = str(event.get("hora_inicio", "")).strip()
    if not hora_inicio:
        raise HTTPException(
            status_code=422,
            detail="'hora_inicio' is missing or empty in the Excel event sheet.",
        )

    try:
        comensales = int(event.get("comensales", 0))
    except (ValueError, TypeError):
        comensales = 0

    prestaciones = data["services"]

    # TODO: read event_duration_hours from the Excel 'evento' sheet once the
    # field is added.  The planned event duration affects the extra-prep block
    # in both departure formulas.  Until the Excel is finalised, 5.0 hours is
    # used as a reasonable default for a mid-size catering event.
    event_duration_hours = 5.0

    # -------------------------------------------------------------------------
    # Step 2: geocode all staff.
    # -------------------------------------------------------------------------
    geocode_staff(data["staff"])

    # -------------------------------------------------------------------------
    # Step 3: rebuild the remaining pool.
    # -------------------------------------------------------------------------
    remaining_result = get_remaining_pool(data["staff"], body.assigned_roles)
    remaining_pool   = remaining_result["remaining_pool"]

    # -------------------------------------------------------------------------
    # Step 4: final safety re-validation.
    # This is the last line of defence before writing confirmed output — we check
    # again even though the user already passed /validate-assignments, because
    # frontend state can drift between the two calls (e.g. a network retry that
    # carried stale assignments).
    # -------------------------------------------------------------------------
    assignments_dict = body.assignments.model_dump()
    validation       = validate_assignments(remaining_pool, assignments_dict)
    if not validation["valid"]:
        raise HTTPException(status_code=422, detail=validation)

    # -------------------------------------------------------------------------
    # Step 5: frescos vehicle and second miniflete.
    # -------------------------------------------------------------------------
    frescos_result        = determine_frescos_vehicle(body.has_own_van, data["staff"])
    second_miniflete_info = determine_second_miniflete(prestaciones)
    second_miniflete_result = (
        second_miniflete_info
        if second_miniflete_info["needs_second_miniflete"]
        else None
    )

    # -------------------------------------------------------------------------
    # Step 6: geocode the event venue.
    # -------------------------------------------------------------------------
    event_address = (
        f"{event.get('direccion_evento', '')}, "
        f"{event.get('ciudad_evento', '')}"
    )
    event_coords = geocode(event_address)
    if event_coords is None:
        raise HTTPException(
            status_code=422,
            detail=f"Could not geocode the event address: '{event_address}'",
        )

    event_destination = [{"lat": event_coords["lat"], "lng": event_coords["lng"]}]

    # -------------------------------------------------------------------------
    # Step 7: CP → event driving time → CP departure time.
    # The CP is the fixed production centre; its coordinates come from config.py.
    # -------------------------------------------------------------------------

    # Picada detection is moved before the matrix calls so extra_hours can be
    # computed once and shared by both arrivalTime calculations below.
    # calculate_departure_time() uses the same picada + duration thresholds.
    from modules.logistics import _normalize, _row_contains  # private helpers
    kw_picada        = _normalize("picada")
    picada_detected  = any(_row_contains(r, kw_picada) for r in prestaciones)
    picada_guests_cp = comensales if picada_detected else 0

    # extra_hours mirrors the same condition used inside calculate_departure_time().
    extra_hours = (
        event_duration_hours >= LONG_EVENT_DURATION_THRESHOLD
        or picada_guests_cp >= PICADA_GUEST_THRESHOLD
    )

    # Compute once — the same arrivalTime applies to both the CP and PE routes
    # because both vehicles must arrive at the event at the same setup deadline.
    arrival_time = _compute_arrival_time(hora_inicio, event.get("fecha", ""), extra_hours)

    cp_origin  = [{"lat": CP_LAT, "lng": CP_LNG}]
    cp_matrix  = compute_route_matrix(cp_origin, event_destination, arrival_time=arrival_time)
    cp_element = cp_matrix["rows"][0]["elements"][0]

    if cp_element["status"] != "OK":
        raise HTTPException(
            status_code=422,
            detail=(
                f"Routes API could not find a route from the CP to "
                f"'{event_address}'. Status: {cp_element['status']}"
            ),
        )

    cp_departure = calculate_departure_time(
        event_time_str=hora_inicio,
        travel_seconds=cp_element["duration"]["value"],
        event_duration_hours=event_duration_hours,
        picada_guests=picada_guests_cp,
    )

    # -------------------------------------------------------------------------
    # Step 8: PE/PEA → event driving time → PE departure time.
    # The meeting point is the one the user confirmed on the map (PE or PEA).
    # -------------------------------------------------------------------------
    pe_origin  = [{
        "lat": body.chosen_meeting_point.lat,
        "lng": body.chosen_meeting_point.lng,
    }]
    pe_matrix  = compute_route_matrix(pe_origin, event_destination, arrival_time=arrival_time)
    pe_element = pe_matrix["rows"][0]["elements"][0]

    if pe_element["status"] != "OK":
        raise HTTPException(
            status_code=422,
            detail=(
                f"Routes API could not find a route from the meeting point "
                f"to '{event_address}'. Status: {pe_element['status']}"
            ),
        )

    pe_departure = calculate_pe_departure_time(
        event_time_str=hora_inicio,
        travel_seconds=pe_element["duration"]["value"],
        event_duration_hours=event_duration_hours,
        prestaciones=prestaciones,
        comensales=comensales,
    )

    # -------------------------------------------------------------------------
    # Step 9: assemble the confirmed summary (assignment groupings + meeting point).
    # We pass cp_departure as departure_time_result so the frescos_vehicle block
    # inside confirmed_summary already has the correct departure_time string.
    # -------------------------------------------------------------------------
    chosen_meeting_point_dict = {
        "name": body.chosen_meeting_point.name,
        "lat":  body.chosen_meeting_point.lat,
        "lng":  body.chosen_meeting_point.lng,
    }

    confirmed_summary = build_assignment_summary(
        assignments=assignments_dict,
        chosen_meeting_point=chosen_meeting_point_dict,
        frescos_result=frescos_result,
        second_miniflete_result=second_miniflete_result,
        departure_time_result=cp_departure,
    )

    # -------------------------------------------------------------------------
    # Step 10: assemble and return the two draggable output blocks.
    # -------------------------------------------------------------------------
    return build_final_output(
        confirmed_summary=confirmed_summary,
        pe_departure=pe_departure,
        cp_departure=cp_departure,
    )
