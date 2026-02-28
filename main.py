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
from modules.maps_client import geocode, geocode_staff, nearest_meeting_point
from modules.logistics import determine_frescos_vehicle, determine_second_miniflete

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
