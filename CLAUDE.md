# App Traslado Personal — Project Context

## What this app does

This is a logistics planning tool for catering events in Buenos Aires.
Given an Excel file with event data, it automates the full staff transport
plan: which vehicles carry the food, who travels in each vehicle, where
everyone meets, and what time everything departs.

The app is built progressively. Not all modules exist yet.
Read this file before making any changes.

---

## Tech stack

- **Backend:** Python, FastAPI, uvicorn
- **Data:** openpyxl (Excel reading), httpx (HTTP calls)
- **APIs:** Google Geocoding, Distance Matrix, Routes, Places (New), Maps JavaScript
- **Frontend:** React + Vite, @vis.gl/react-google-maps, shadcn/ui (not started yet)
- **Secrets:** All API keys and paths live in `.env`, never in code

---

## Project structure

```
app-traslado-personal/
├── main.py                  ← FastAPI server and all endpoints
├── config.py                ← ALL business-rule constants and thresholds
├── modules/
│   ├── excel_reader.py      ← reads 3-sheet Excel (event, staff, services)
│   ├── maps_client.py       ← Google Maps: geocode, distance matrix, meeting points
│   └── logistics.py        ← business logic: frescos, minifletes, vehicle assignment
├── _generar_excel.py        ← generates sample .xlsx for testing
├── sample_data/
│   └── evento_prueba.xlsx
├── requirements.txt
└── .env
```

---

## Excel structure (3 sheets)

Sheet names are capitalised: **Evento**, **Equipo**, **Prestaciones**.
Field names are in Spanish (from the Access DB export). `excel_reader.py` maps them
to internal English keys via `_EVENT_FIELD_MAP` — all other code uses internal names.

### Sheet: "Evento" (field/value pairs — NO header row)
| Excel field name (Spanish) | Internal key (English) | Notes |
|---|---|---|
| Menu | tipo | e.g. "Asado Finger Food" |
| Evento | ocasion | e.g. "Cumpleaños" |
| Locacion | direccion_evento | Full address string used for geocoding |
| *(derived from Locacion)* | ciudad_evento | Last comma-separated token, trailing `.` stripped |
| DescripcionLocacion | descripcion_locacion | Free-text venue description |
| Empresa | empresa | Client company name (may be None) |
| Observaciones * (podes ponerlas todas juntas?) | observaciones | List of strings; split on literal `\n` |
| Fecha | fecha | Date string as returned by openpyxl |
| Horario | hora_inicio | Formatted as "HH:MM" string (openpyxl returns datetime.time) |
| Comensales carne | comensales | Integer |
| Comensales veggie | comensales_veggie | Integer |

### Sheet: "Equipo" (table format, row 1 = headers)
Columns: Profesion, Nombre, Apellido, Direccion, CP, Ciudad, Auto, Patente
- **Seniority is embedded in Profesion** — there is no separate Senioridad column.
  Examples: "Manager Senior", "Camarero Medior", "Parrillero Junior".
- **Auto** column: non-empty, non-"NO" value → employee has a personal car (make/model).
  "NO" (case-insensitive) is normalised to "" by the reader — same as empty.
- Trailing `None` columns from the Access export are ignored (only first 8 read).
- Rows where Profesion is None or empty are skipped (spacer/junk rows).
- `\xa0` (non-breaking space) is stripped from all string values.
- There are always exactly 2 Parrilleros per event, never two Seniors.

### Sheet: "Prestaciones" (table format, row 1 = headers)
Columns: Servicio, Detalle, Cantidad
- Trailing `None` columns beyond the first 3 are ignored.

**Excel column names stay in Spanish** — they come from the source file (Access DB).
All other code is in English.

---

## Full app flow (implemented progressively)

### Step 1 — Frescos vehicle (modules/logistics.py)
Implemented: `determine_frescos_vehicle(has_own_van, staff)`.
- User is asked: is the company van available?
- If yes → "camioneta propia", assign Manager Senior + highest-seniority Parrilla employee
- If no → "miniflete contratado", assign Manager Senior only
- Employees are found by real lookup using `_find_manager_senior()` and `_find_highest_parrilla()`.
- Output: `{"vehicle": str, "assigned_names": list[str]}` — actual employee names for display.
- Assigned employees are removed from the remaining pool (Step 4) via role strings the frontend tracks.

### Step 2 — Second miniflete (modules/logistics.py)
Evaluated independently from Step 1.
Triggered when "estacion de fuegos" is NOT contracted AND any of:
- "asado tradicional" AND comensales > 60
- "asado finger food" AND comensales > 70
- "acompañamiento bebidas" AND cantidad > 20

If triggered: assign 1 person by role hierarchy → removed from staff pool.

### Step 3 — Departure times from CP (modules/logistics.py)
Implemented: `calculate_departure_time(event_time_str, travel_seconds, event_duration_hours, picada_guests)`
CP address and coordinates are constants in `config.py` (CP_ADDRESS, CP_LAT, CP_LNG).
Formula (all values from config.py):
- departure = event_time − DEPARTURE_PREP_HOURS − travel_time (rounded up) − DEPARTURE_BUFFER_MINUTES − LOADING_TIME_MINUTES
- If event_duration_hours >= LONG_EVENT_DURATION_THRESHOLD (8h) OR picada_guests >= PICADA_GUEST_THRESHOLD (100) → subtract LONG_EVENT_EXTRA_HOURS (2h) additional
Both vehicles (frescos + second miniflete if any) always depart at the same time.

### Step 4 — Remaining staff vehicle assignment (modules/logistics.py)
Step 4a implemented: `get_remaining_pool(staff, assigned_roles)`
Pool = all staff minus employees whose "Profesion" matches an assigned role.
- If pool == 1  → status "alternative" — halt, user must find alternative (moto, baúl, etc.)
- If pool > 8   → status "charter" — halt, user must arrange a charter bus
- Otherwise     → status "proceed" — continue to Step 4b (not yet built)

Step 4b — personal vehicle detection implemented: `detect_personal_vehicle(staff)`
Scans the "Auto" column across the full staff list. First non-empty value wins.
If more than one car is found, first is used and a warning is returned (data error).

Step 4b — passenger assignment implemented: `assign_vehicle_passengers(remaining_pool, driver, chosen_meeting_point)`
Called after the user has confirmed the final meeting point (PE or PEA).
- Removes driver from pool (matched by Nombre + Apellido)
- Sorts remaining by Haversine distance to chosen_meeting_point; MAX_PASSENGERS_PER_CAR (4) closest → personal car
- Everyone else → Uber groups of MAX_PASSENGERS_UBER (4) each; all go directly to the meeting point
- If exactly 1 Uber passenger remains → single_employee_warning returned; TODO: consult manager
- If no personal car → /assign-passengers raises 422; separate /assign-uber-only endpoint needed (not yet built)

### Step 5 — Meeting point and driver routes (modules/maps_client.py)
Implemented: `nearest_meeting_point(event_coords)` — Distance Matrix API, picks closest of 3 fixed PEs.
Fixed points:
- North: Puente Saavedra (Av. General Paz y Av. Cabildo)
- South: Caballito (Av. Rivadavia y Av. Emilio Mitre)
- West: Ramos Mejía (McDonald's, Av. de Mayo 1200)

Implemented: `calculate_driver_route(driver_coords, meeting_point, event_coords)` — Routes API (POST).
Returns two routes:
- base_route:   driver home → PE → event (via intermediate waypoint)
- direct_route: driver home → event (no stopover — reference for Step 6 and 7)
Both use travelMode DRIVE, routingPreference TRAFFIC_AWARE.
Each route returns duration_seconds, distance_meters, encoded_polyline, legs.
Uber vehicles go directly to the PE — no individual routing needed.

### Step 6 — Alternative meeting point / PEA (modules/maps_client.py + modules/logistics.py)
Candidate search implemented: `find_pea_candidates(direct_route_polyline)` — Places API (New).
- Decodes direct_route encoded polyline using the `polyline` library
- Samples every 5th point (_POLYLINE_SAMPLE_STEP) to limit API calls
- Searches 300 m radius (_PLACES_SEARCH_RADIUS) around each sample for transit hubs
- Types searched: transit_station, subway_station, train_station, bus_station
- Deduplicates results by formattedAddress (stable unique key)
- Returns list of {name, address, lat, lng, types} — no evaluation, no scoring

Evaluation implemented: `evaluate_pea_candidates(candidates, remaining_pool, meeting_point)` — in modules/logistics.py.
- For each candidate: one Distance Matrix call (N staff × 2 destinations: candidate + PE, transit mode)
- A candidate qualifies when ALL staff reach it in ≤ PEA_MAX_TRANSIT_MINUTES (25min) AND
  AT LEAST PEA_MIN_EXCLUSIVE_PREFERENCE (2) staff "exclusively prefer" it:
  "exclusively prefers PEA" = transit_time_to_PE − transit_time_to_PEA ≥ PEA_EXCLUSIVE_DIFF_MINUTES (20min)
- Best candidate = highest exclusively_prefer_count among qualifying candidates
- Proximity check via Haversine (no API call): straight-line km from PEA to original PE
  ≤ PEA_RADIUS_KM (10 km) → "optimal"; > 10 km → "consult_remuneration"
- Full pipeline exposed at `GET /evaluate-pea`

User sees map and decides: keep original meeting point or switch to PEA.

### Step 7 — Pickup points (modules/logistics.py)
Only for personal car vehicle. Maximum 1 pickup point per trip.
Implemented: `find_pickup_candidate(route_polyline, remaining_pool, meeting_point)`.

Algorithm:
1. Sort pool by Haversine distance to meeting_point. The (pool_size − 1) closest → employees_to_meeting_point (go to PE directly).
   The 1 farthest → pickup candidate (always exactly 1, regardless of pool size).
2. For the pickup candidate, find their closest decoded polyline point (cross_point).
3. Verify eligibility via Distance Matrix transit call (1 origin × 2 destinations: cross_point + PE):
   - Transit time to cross_point ≤ PICKUP_MAX_TRANSIT_MINUTES (30 min)
   - Time saved (transit to PE − transit to cross_point) ≥ PICKUP_MIN_TIME_SAVING_MINUTES (20 min)
4. Search Places API (New) around cross_point, radius = PICKUP_MAX_DETOUR_METERS (300 m), types = PICKUP_PLACE_TYPES.
5. Filter results: keep only places where min Haversine distance to any polyline point ≤ PICKUP_MAX_DETOUR_METERS.
   Return top PICKUP_TOP_CANDIDATES (3) ordered by distance to cross_point ascending.

Called twice inside `GET /evaluate-pea`:
- `pickup_if_pe_chosen`:  base_route polyline + PE as meeting_point
- `pickup_if_pea_chosen`: direct_route polyline + PEA best_candidate as meeting_point (None if pea_proposed is False)

User sees all candidate venues on map with full detail before confirming.
Uber vehicles do NOT get pickup points — they go to the meeting point only.

### Step 8 — Final output
- Departure time from CP (frescos + second miniflete if exists)
- Departure time from meeting point (personal car + uber)
- Full map with all staff addresses as markers (clicking a marker highlights
  the corresponding address in a sidebar list) and vehicle routes
- Vehicle assignments: who goes in what, from where
- Pickup points confirmed by user

---

## Architecture rules — do not change without explicit instruction

### Constants
ALL thresholds, keywords, and numeric parameters live in `config.py`.
Never hardcode business values inside logic modules.

### Multi-step flow
Each endpoint handles one step. The frontend accumulates state between steps.
Do not collapse multiple steps into a single endpoint.

### Maximum one personal vehicle per event
There is never more than one employee with a personal car per event.
Do not build multi-vehicle routing logic.

### Passenger capacity
`MAX_PASSENGERS_PER_CAR = 4` → passengers only, excludes driver. Total = 5.
`MAX_PASSENGERS_UBER = 4` → passengers only, Uber driver is external. Total = 5.

---

## Current status and known TODOs

### Working endpoints
- `GET /read-excel` — returns structured JSON from Excel
- `GET /geocode-staff` — staff list with coordinates
- `GET /nearest-meeting-point` — closest of 3 fixed meeting points
- `POST /determine-frescos` — frescos vehicle and assigned employee names (real lookup)
- `POST /determine-second-miniflete` — whether second miniflete is needed
- `POST /calculate-departure-time` — CP departure time for frescos vehicle(s)
- `POST /get-remaining-pool` — remaining staff pool after frescos assignments, with charter/alternative flags
- `GET /detect-personal-vehicle` — checks "Auto" column; returns driver, vehicle description, and warning if multiple cars found
- `GET /calculate-driver-route` — Routes API: base route (home→PE→event) and direct route (home→event)
- `GET /evaluate-pea` — full PEA + pickup pipeline: geocode staff → driver route → PEA evaluation → pickup candidates for both PE and PEA scenarios
- `POST /assign-passengers` — assigns remaining staff to personal car + Uber groups after user confirms meeting point
- `POST /validate-assignments` — validates full employee coverage; if valid, returns partial summary (no departure times) for preview modal
- `POST /confirm-assignments` — safety re-validates, then returns complete summary including CP departure time; populates both draggable output blocks
- `POST /final-output` — final safety check + computes both departure times (CP and PE/PEA) + returns the two draggable map blocks (frescos_block + transport_block)

### Role lookup — implemented
`determine_frescos_vehicle(has_own_van, staff)` does real employee lookups:
- `_find_manager_senior(staff)` — exact normalised match on `"Manager Senior"`.
  Raises `ValueError` if none found (propagated as HTTP 422).
- `_find_highest_parrilla(staff)` — substring match for `"parrilla"` or `"parrillero"`
  in the normalised Profesion string; picks the employee with the highest seniority
  using `_seniority_rank()` which reads the seniority level embedded in Profesion.
  Raises `ValueError` if none found.
- `_seniority_rank(profesion)` — returns 3/2/1/0 for Senior/Medior/Junior/unknown.
- Returns `{"vehicle": str, "assigned_names": list[str]}` where each name is
  `"Nombre Apellido"` of the actual employee assigned.

### TODO: Places API caching for polyline points
`find_pickup_candidate()` and `find_pea_candidates()` decode the polyline and iterate over its
points on every call.  Post-deployment, add caching keyed on the encoded polyline string so
that repeated calls for the same route (e.g. same driver, same event address) do not re-decode
and re-query the same points.

### TODO: Frontend pickup map highlight for CEO and manager review
`PICKUP_MAX_DETOUR_METERS` (and `_PLACES_SEARCH_RADIUS` in maps_client.py) are currently in
metres.  When the frontend map is built, add a visual circle overlay around each cross-point
and each candidate venue so that the CEO and manager can visually verify that the pickup
radius feels right before going live.

### TODO: departure_from_pe not yet computed
`build_assignment_summary()` always returns `departure_from_pe: null`.
Once the confirm step is fully wired, add a Routes API call inside
`/confirm-assignments` (chosen_meeting_point → event_venue) and pass the
resulting duration into `build_assignment_summary()` as a new parameter.

### Step 8 functions (modules/logistics.py)
`validate_assignments(remaining_pool, assignments)` — compares pool names vs
assigned names; returns `valid`, `unassigned_employees`, `unknown_assignments`,
and a human-readable `message`.

`build_assignment_summary(assignments, chosen_meeting_point, frescos_result,
second_miniflete_result, departure_time_result)` — pure data assembly; produces
the confirmation modal dict.  `chosen_meeting_point` and `departure_time_result`
may be None when called from the validate step.

`calculate_pe_departure_time(event_time_str, travel_seconds, event_duration_hours,
prestaciones, comensales)` — departure time from the meeting point (PE or PEA).
Same formula as CP departure minus LOADING_TIME_MINUTES.  Detects picada from
prestaciones rows using `_row_contains()`.  Returns `departure_time` + full
`breakdown` dict with every formula component explicit.

`build_final_output(confirmed_summary, pe_departure, cp_departure)` — pure data
assembly; reshapes the three pre-computed results into `frescos_block` and
`transport_block` for the two draggable map modals.

### TODO: Frontend not started
React + Vite + @vis.gl/react-google-maps + shadcn/ui.
Build only after backend is fully tested.

---

## Frontend UX decisions

### Route and assignment color coding
Each route scenario has its own color. Suggested assignments inherit the color
of their route so the user can visually associate employees with their scenario.

- PE route (chofer → PE → evento): BLUE
  - Staff markers suggested for this route: blue highlight
  - Pickup candidate for PE route: blue marker

- PEA route (chofer → PEA → evento): RED
  - Staff markers suggested for this route: red highlight
  - Pickup candidate for PEA route: red marker

- Uber (any scenario): GREY markers
- Frescos vehicle: separate color TBD by CEO/manager

### Manual assignment via map
Staff assignments are NOT automatic — the backend provides proximity-based
suggestions but the user makes the final call via a contextual menu on each
marker:
  - "Assign to PE (Uber)"
  - "Assign to PE (personal vehicle)"
  - "Find pickup on route"

The user can override any suggestion before confirming.

### Config parameters visual highlight
Parameters defined in config.py that affect map display (radii, detour distances)
should be visually represented on the map as circles or overlays so the
CEO and manager can intuitively understand and adjust them.

### Modal design — assignment confirmation
The assignment confirmation summary appears as a MODAL overlaid on the map.
The map remains fully visible and interactive behind the modal (semi-darkened).
The modal is DRAGGABLE so the user can reposition it to see any part of the map.
Clicking "Edit" closes the modal and returns to the interactive map with full state preserved — no API calls are repeated.

### Final output — draggable info blocks on map
Once the user confirms assignments, the modal does NOT disappear.
It stays on screen and a SECOND draggable block appears alongside it containing:
- Departure time from CP (frescos vehicle + second miniflete if applicable)
- Departure time from PE/PEA (personal vehicle + uber groups)
- Full vehicle assignments: who goes in what, from where
- Pickup confirmed (if any): employee name, place, time saved
- Meeting point confirmed: PE or PEA with address

Both blocks are draggable and can be repositioned freely over the map.
The map stays fully interactive underneath.

### Map viewport
The map must not be constrained to CABA. Routes can be long (e.g. Pilar to Temperley are
examples of possible extremes, not a fixed requirement).
The viewport must zoom to fit all staff addresses and routes simultaneously.

### Employee database (pending)
TODO: implement employees.json to store employee data and cached coordinates.
When an employee appears in an event, check employees.json first before
calling the Geocoding API. First time seen → geocode and save to file.
Implement after employee list is finalised with the manager.
