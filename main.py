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
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv

# Import our data-reading and maps functions from the local modules package
from modules.excel_reader import read_excel
from modules.maps_client import geocode, geocode_staff, nearest_meeting_point, calculate_distances, calculate_driver_route, find_pea_candidates
from modules.logistics import determine_frescos_vehicle, determine_second_miniflete, calculate_departure_time, get_remaining_pool, detect_personal_vehicle, evaluate_pea_candidates

# CP coordinates are fixed constants defined in config.py — imported here
# so the endpoint can pass them directly to the Distance Matrix API.
from config import CP_LAT, CP_LNG

# Load the variables defined in .env into the process environment.
# This must run before any code that calls os.getenv().
load_dotenv()

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


# -----------------------------------------------------------------------------
# Endpoints
# -----------------------------------------------------------------------------

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
        "event":    { "presupuesto": ..., "tipo": ..., ... },
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
    summary="Determine the frescos vehicle and assigned staff roles",
    description=(
        "Given whether the company owns a van for this event, returns which "
        "vehicle will transport the frescos (raw ingredients) and which staff "
        "roles are assigned to it.  No external APIs are called — the decision "
        "is purely rule-based."
    ),
)
def endpoint_determine_frescos(body: FrescosRequest):
    """
    Delegates directly to determine_frescos_vehicle() from the logistics module.

    The Excel file is validated to exist (consistent with all other endpoints)
    even though this particular rule does not need its data — it confirms the
    event is properly configured before returning transport decisions.

    Returns a JSON object:
    {
        "vehicle":        "camioneta propia" | "miniflete contratado",
        "assigned_roles": ["Manager Senior"] | ["Manager Senior", "Jefe de Parrilla Senior"]
    }
    """
    # Validate that the event Excel exists before returning any logistics advice.
    # This guards against answering transport questions for a non-existent event.
    _load_excel()

    return determine_frescos_vehicle(body.has_own_van)


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
    # -------------------------------------------------------------------------
    return calculate_driver_route(driver_coords, meeting_point, event_coords)


@app.get(
    "/evaluate-pea",
    summary="Evaluate alternative meeting point (PEA) candidates along the driver's direct route",
    description=(
        "Runs the full PEA evaluation pipeline: geocodes all staff, finds the nearest "
        "meeting point (PE), computes the driver's direct route, searches for transit "
        "hubs along that route, then evaluates each candidate against the remaining "
        "staff pool using public-transport travel times.  Returns the best qualifying "
        "PEA (if any), how many staff exclusively prefer it, and a proximity flag that "
        "determines whether driver remuneration needs to be reviewed."
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
        7. Calculate the driver's direct route (home → event, no stopover).
        8. Search for PEA candidates along the direct route polyline.
        9. Build the remaining staff pool by removing the frescos-assigned roles.
           TODO: replace the hardcoded role list with the result of /determine-frescos
           and /determine-second-miniflete once role lookup is implemented.
       10. Evaluate the candidates against the pool and return the best result.

    Returns a JSON object:
    {
        "pea_proposed":             true | false,
        "best_candidate":           {
            "name":    str,
            "address": str,
            "lat":     float,
            "lng":     float,
            "types":   list[str]
        } | null,
        "exclusively_prefer_count": int,
        "pea_near_original":        true | false,
        "remuneration_note":        str | null
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
    # Step 5: compute the driver's direct route (home → event, no stopover).
    # The direct route polyline is what we search for transit hub candidates —
    # we want stations the driver would naturally pass, not detour to.
    # -------------------------------------------------------------------------
    routes       = calculate_driver_route(driver_coords, meeting_point, event_coords)
    direct_polyline = routes["direct_route"]["encoded_polyline"]

    # -------------------------------------------------------------------------
    # Step 6: find PEA candidates along the direct route.
    # -------------------------------------------------------------------------
    candidates = find_pea_candidates(direct_polyline)

    # -------------------------------------------------------------------------
    # Step 7: build the remaining staff pool.
    # TODO: replace hardcoded assigned_roles with the actual output of
    # /determine-frescos and /determine-second-miniflete once role lookup is
    # implemented.  For now we use the two default frescos roles.
    # -------------------------------------------------------------------------
    assigned_roles    = ["Manager Senior", "Jefe de Parrilla Senior"]
    remaining_result  = get_remaining_pool(data["staff"], assigned_roles)
    remaining_pool    = remaining_result["remaining_pool"]

    # -------------------------------------------------------------------------
    # Step 8: evaluate candidates and return the best qualifying PEA.
    # -------------------------------------------------------------------------
    return evaluate_pea_candidates(candidates, remaining_pool, meeting_point)
