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
- **Frontend:** React + Vite, @vis.gl/react-google-maps, shadcn/ui, Tailwind CSS v4
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
├── .env
└── frontend/                ← React + Vite app
    ├── index.html
    ├── vite.config.js       ← @tailwindcss/vite plugin + @ alias
    ├── .env                 ← VITE_API_BASE_URL, VITE_GOOGLE_MAPS_API_KEY, VITE_GOOGLE_MAPS_MAP_ID
    ├── src/
    │   ├── main.jsx         ← ReactDOM.createRoot, QueryClientProvider
    │   ├── App.jsx          ← AppStateProvider → APIProvider → AppShell
    │   ├── AppShell.jsx     ← loading/error gate; renders AppMap on success
    │   ├── index.css        ← @import "tailwindcss"; shadcn/ui CSS variables
    │   ├── api/
    │   │   ├── client.js    ← axios instance (baseURL from env, dev error interceptor)
    │   │   └── endpoints.js ← one named async function per backend endpoint
    │   ├── state/
    │   │   └── appState.jsx ← useReducer + split contexts (state + dispatch)
    │   ├── hooks/
    │   │   └── useBootstrap.js ← readExcel + geocodeStaff on mount
    │   └── components/
    │       ├── map/
    │       │   ├── AppMap.jsx              ← full-screen Map canvas + floating panels
    │       │   ├── MapBoundsController.jsx ← renderless; calls map.fitBounds()
    │       │   ├── StaffMarkers.jsx        ← AdvancedMarker + Pin per employee; InfoWindow (steps 1-2) or context menu (step 3+)
    │       │   ├── RoutePolylines.jsx      ← blue base route + red direct route (imperative, step 2+)
    │       │   ├── MeetingPointMarkers.jsx ← green PE + orange PEA markers with InfoWindows (step 2)
    │       │   └── EventMarker.jsx         ← black pin at event venue; auto-resolves coords (step 1+)
    │       ├── panels/
    │       │   ├── FrescosPanel.jsx        ← floating Card: van question + result summary (step 1+)
    │       │   ├── PeaPanel.jsx            ← floating Card: meeting point guide + confirmation (step 2)
    │       │   ├── AssignmentPanel.jsx     ← floating Card: car/uber assignment progress + validate (step 3)
    │       │   └── PickupResultPanel.jsx   ← floating Card: find-pickup results + confirm (on-demand)
    │       └── ui/                         ← shadcn/ui generated components (Card, Button…)
    └── package.json
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
- Feeds into evaluate_pea_candidates() which ranks and returns up to 3 candidates

Evaluation implemented: `evaluate_pea_candidates(candidates, remaining_pool, meeting_point)` — in modules/logistics.py.
Uses geographic clustering (CLUSTER_RADIUS_KM = 8 km) before transit evaluation. Three phases:

**Phase 1 — cluster** (`_cluster_by_proximity`):
- Greedy first-fit radius algorithm; CLUSTER_RADIUS_KM from seed (first member of each cluster)
- Employees without coordinates are excluded entirely
- Discovers k naturally — no need to pre-specify the number of clusters
- Why not k-means: k is unknown per event; radius clusters have real geographic meaning

**Phase 2 — evaluate per cluster** (`_best_candidate_for_cluster`):
- For each cluster: one Distance Matrix call per candidate (cluster_size rows × 2 destinations: candidate + PE, transit mode)
- All-or-nothing validity rule: if any cluster member has non-OK status, skip that candidate
- Per-employee metrics: transit_to_candidate_min, transit_to_pe_min, time_saved_min, exceeds_max_transit
- Selects the best candidate for that cluster (lowest median transit time)
- Returns `cluster_members`: lightweight list of {employee_name, transit_to_candidate_min} — which employees this PEA serves

**Phase 3 — assemble**:
- Collect one winner per cluster; deduplicate by address (two clusters may pick the same hub)
- Sort by median transit time ascending; cap at 3 total (UI constraint — more is visually overwhelming)
- Proximity check per candidate: Haversine km from PEA to original PE
  ≤ PEA_RADIUS_KM (10 km) → flagged "optimal"; > 10 km → remuneration_note set
- Returns `{"has_candidates": bool, "candidates": [...up to 3 dicts...]}`
- Each candidate dict: name, address, lat, lng, median_transit_minutes, exclusively_prefer_count,
  pea_near_original, remuneration_note, **cluster_members**, staff_metrics
- Full pipeline exposed at `GET /evaluate-pea`

User sees map and decides: keep original meeting point or switch to PEA.

### Step 7 — Pickup points (modules/logistics.py)
Only for personal car vehicle. Maximum 1 pickup point per trip.

Two functions cover this step:

`get_pickup_highlight(remaining_pool, route_polyline, meeting_point)` — pure geometry, no API calls.
- Sorts the remaining pool by Haversine distance to the meeting point; the farthest employee
  is the natural pickup candidate
- Finds that employee's closest decoded polyline vertex (cross_point)
- Returns `{"highlight_candidate": {"employee": dict, "cross_point": {lat, lng}}, "reason": None}`
  or `{"highlight_candidate": None, "reason": str}` if the pool is empty or has no coordinates
- Called automatically when the map loads to show an immediate visual hint

`find_pickup_candidate(route_polyline, employee, meeting_point)` — called ON DEMAND only, when
the user opens the map context menu for a specific employee and selects "Find pickup on route".
Signature takes a single `employee` dict (not the full pool — pool sorting is done by
`get_pickup_highlight()` and the user may override the suggestion).

Algorithm:
1. Decode route polyline; find the decoded vertex closest to the employee's home (cross_point).
2. Distance Matrix transit call (1 origin × 2 destinations: cross_point + meeting_point):
   - `transit_warning` = True if transit time to cross_point > PICKUP_MAX_TRANSIT_MINUTES (30 min)
   - `time_saving_warning` = True if time saved < PICKUP_MIN_TIME_SAVING_MINUTES (20 min)
   - Both are informational flags — they do not suppress the result; the manager decides
   - Non-OK Distance Matrix status → returns `pickup_candidate: null` with reason (genuine impossibility)
3. Search Places API (New) around cross_point, radius = PICKUP_MAX_DETOUR_METERS (300 m), types = PICKUP_PLACE_TYPES.
4. Filter results: keep only places where min Haversine distance to any polyline point ≤ PICKUP_MAX_DETOUR_METERS.
   Return top PICKUP_TOP_CANDIDATES (3) ordered by distance to cross_point ascending.
   If no places pass the filter, returns result with `place_options: []` — not suppressed.

Exposed at `POST /find-pickup` (on demand).
User sees all candidate venues on map with transit data and warning flags before confirming.
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
- `GET /evaluate-pea` — geocode staff → driver routes → PEA candidate search → ranked evaluation; returns `{meeting_point, driver_routes, pea_evaluation}` with up to 3 candidates; no pickup logic
- `POST /find-pickup` — on-demand pickup search for a specific employee; accepts `{employee_name, route_polyline, meeting_point}`; returns `find_pickup_candidate()` result directly
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
`find_pea_candidates()` decodes the polyline and iterates over its points on every call.
Post-deployment, add caching keyed on the encoded polyline string so that repeated calls
for the same route (e.g. same driver, same event address) do not re-decode and re-query
the same points.

`find_pickup_candidate()` is now called on demand (one employee at a time via `POST /find-pickup`).
Post-deployment, add caching keyed on `(employee_name, route_polyline)` so that repeated
requests for the same employee on the same route do not re-run the Distance Matrix and
Places API calls.

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

### Frontend — current status
Steps 1, 2, and 3 are implemented and building cleanly.

**Implemented:**
- Full-screen Google Map (vis.gl `<Map>`) with staff markers (AdvancedMarker + Pin)
- `useBootstrap` hook auto-runs on mount: readExcel → geocodeStaff → markers appear
- `FrescosPanel` floating Card: van question → four sequential backend calls → result summary
- `AppShell` loading/error gate with phase-specific Spanish messages
- Global state via `useReducer` + split contexts (prevents unnecessary re-renders)
- `useStepTwo` hook: auto-runs on step 1→2; calls nearestMeetingPoint → calculateDriverRoute → evaluatePea
- `RoutePolylines` component: blue base route + red direct route drawn imperatively via useMap()
- `MeetingPointMarkers` component: green PE + orange PEA markers with detailed InfoWindows + selection buttons
- `PeaPanel` floating panel: loading states, instruction text, route summary, confirmation + advance button
- `EventMarker` component: black pin at event venue; 3-priority coord resolution (state → polyline → Geocoding API)
- `StaffMarkers` rewritten: step 1-2 shows InfoWindow, step 3+ shows context menu with assignment actions
  - Marker color: blue=unassigned, green=driver/car, grey=uber, yellow=pickup employee
  - Context menu: "Asignar al vehículo propio", "Buscar pickup en ruta", "Asignar a Uber", "Quitar asignación"
  - Driver marker: always green, no assignment actions
- `AssignmentPanel`: floating panel (step 3) showing car/uber assignments, progress counter, validate button
  - Auto-fills remaining unassigned to Uber on validate; calls POST /validate-assignments; advances to step 4
- `PickupResultPanel`: floating panel (on-demand) showing place_options from POST /find-pickup
  - Confirming a pickup sets pickup_employee (yellow marker) + pickup_place (yellow pin on map)
- Driver auto-assigned in AppMap useEffect when step 3 starts (assignments initialized from personalVehicle)
- Pickup place star marker: yellow AdvancedMarker at pickup_place.lat/lng rendered inside <Map>

**Not yet implemented (frontend steps 4–8):**
- Assignment confirmation modal (draggable, step 4)
- Final output draggable info blocks (frescos_block + transport_block)
- Departure time display

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
Staff assignments are NOT automatic — the user makes the final call via a context
menu that appears when clicking a marker in step 3.  Context menu actions:
  - "Asignar al vehículo propio" — shown when car not full and employee unassigned
  - "Buscar pickup en ruta" — shown when personal vehicle exists; triggers POST /find-pickup,
    opens PickupResultPanel with venue options
  - "Asignar a Uber" — shown when employee not already in Uber
  - "Quitar asignación" — shown when employee is currently assigned

Driver marker (auto-assigned green): shows name + "Chofer — asignado automáticamente",
no action buttons. The driver cannot be moved to Uber or removed.

In steps 1-2, clicking a marker shows an InfoWindow with employee info only (no actions).

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

---

## Frontend architecture

### Stack
- React 19 + Vite (JSX files must use `.jsx` extension — Vite won't transform JSX in `.js`)
- Tailwind CSS v4 via `@tailwindcss/vite` plugin — no `postcss.config.js`, no `tailwind.config.js`
- shadcn/ui v3 (Tailwind v4 compatible, initialized with `--defaults` flag)
- `@vis.gl/react-google-maps` v1.7.1
- axios for HTTP (shared instance in `api/client.js`)
- `@tanstack/react-query` (QueryClient with no retry on 4xx)

### Provider hierarchy (App.jsx)
```
AppStateProvider          ← global useReducer state
  └── APIProvider         ← Google Maps JS API (must outlive any map unmount/remount)
        └── AppShell      ← loading/error gate; calls useBootstrap()
              └── AppMap  ← full-screen map + floating panels
```
`APIProvider` is in `App.jsx`, NOT in `AppMap.jsx`, because it must survive map remount cycles.
`AppShell` is a separate file (not inlined in `App.jsx`) because it calls `useAppState()`,
which requires being below `AppStateProvider` in the tree.

### Layout model (AppMap.jsx)
The outer div is `position: relative; width: 100vw; height: 100vh`.
`<Map>` fills it entirely via `width: 100%; height: 100%`.
Floating panels use `position: absolute` inside this same div — they are **siblings** of
`<Map>`, not children, because the Maps JS API owns the DOM inside `<Map>`.

### CORS
FastAPI `CORSMiddleware` must allow both `http://localhost:5173` AND `http://127.0.0.1:5173`.
The browser treats these as different origins. Vite's `VITE_API_BASE_URL` is set to
`http://127.0.0.1:8000` to match the allowed origin.

---

## Frontend state flow

State lives in `src/state/appState.jsx` as a `useReducer` with split contexts
(`AppStateContext` + `AppDispatchContext`) to avoid re-rendering dispatch-only consumers.

| State slice | Populated by | Step |
|---|---|---|
| `excelData` | `useBootstrap` → `readExcel()` | Boot |
| `staffWithCoords` | `useBootstrap` → `geocodeStaff()` | Boot |
| `loadingStep` | `useBootstrap`, `FrescosPanel` | All loading phases |
| `error` | `useBootstrap`, `FrescosPanel` | Any failed call |
| `currentStep` | `FrescosPanel` (dispatched last, after all 4 calls succeed) | Step 1 → 2 |
| `frescosResult` | `FrescosPanel` → `determineFrescos()` | Step 1 |
| `secondMinifleteResult` | `FrescosPanel` → `determineSecondMiniflete()` | Step 1 (batch) |
| `remainingPool` | `FrescosPanel` → `getRemainingPool()` | Step 1 (batch) |
| `personalVehicle` | `FrescosPanel` → `detectPersonalVehicle()` | Step 1 (batch) |
| `meetingPoint` | `useStepTwo` → `nearestMeetingPoint()` | Step 2 auto |
| `driverRoutes` | `useStepTwo` → `calculateDriverRoute()` | Step 2 auto |
| `peaEvaluation` | `useStepTwo` → `evaluatePea()` | Step 2 auto |
| `chosenMeetingPoint` | `MeetingPointMarkers` → InfoWindow "Elegir" click | Step 2 |
| `eventCoords` | `EventMarker` → polyline last point or Geocoding API | Step 1+ |
| `assignments` | `AppMap` useEffect (driver init) + `StaffMarkers` context menu | Step 3 |
| `activePickupResult` | `StaffMarkers` → `findPickup()` | Step 3 on-demand |
| `finalOutput` | `AssignmentPanel` → `validateAssignments()` (partial); step 4+ | Step 4 |

`SET_CURRENT_STEP` is always dispatched **after** all dependent slices are populated
to guarantee the next view renders with complete data on its first paint.

---

## Key architectural decisions (finalized)

1. **`APIProvider` at app root, not in `AppMap`.**
   Moving it into `AppMap` would destroy and recreate the Maps JS API context on every map
   remount. Keeping it in `App.jsx` makes it outlive the map lifecycle.

2. **Floating panels as siblings of `<Map>`, never children.**
   The Maps JS API controls the DOM inside `<Map>`; appending arbitrary React nodes there
   conflicts with its internal rendering. Siblings in the same `position: relative` container
   achieve the same visual layering without interference.

3. **`AdvancedMarker` instead of deprecated `Marker`.**
   `google.maps.Marker` is deprecated as of February 2024. `AdvancedMarkerElement` is the
   replacement, supports Map ID / custom styling, and is keyboard/screen-reader accessible.
   Requires `mapId` to be set on the `<Map>` component.

4. **`selectedEmployee` in local state, not global state.**
   "Which info card is open" is pure transient UI state scoped to `StaffMarkers`.
   No other part of the app needs it. Global state is reserved for business state.

5. **Bounds computed in `AppMap`, not in `StaffMarkers`.**
   `AppMap` is the viewport owner. `StaffMarkers` renders pins; it should not also control
   the camera. All viewport decisions (bounds, center, zoom) belong in `AppMap` so they can
   later incorporate routes, meeting points, pickup candidates, etc. in one place.

6. **Four backend calls in one `FrescosPanel` handler.**
   All four results (frescos, second miniflete, remaining pool, personal vehicle) depend on
   a single user decision (has_own_van). Splitting them into separate user actions would
   create an unnecessary multi-step wizard. A single try/catch covers the whole sequence
   and leaves state consistent on failure.

7. **`deriveProfesiones()` bridge function.**
   `determineFrescos` returns `assigned_names` (employee full names for display).
   `getRemainingPool` needs `assigned_roles` (Profesion strings for exact pool filtering).
   The frontend looks up each name in `excelData.staff` to retrieve the Profesion — avoids
   hardcoding role strings that could drift from the actual Excel data.

8. **`appState.jsx` uses `.jsx` extension.**
   Vite only transforms JSX syntax in files with a `.jsx` (or `.tsx`) extension.
   Context providers use JSX (`<Context.Provider>`), so the state file must be `.jsx`.
   Vite's extensionless import resolution picks it up automatically — no import path changes needed.

9. **Meeting point selection lives on map markers, not in the panel.**
   The purpose of step 2 is for the user to see routes, staff addresses, and candidate points
   together and make a spatially-informed decision. Putting selection buttons in the panel would
   let the user choose without looking at the map, losing the spatial context entirely.
   `PeaPanel` is informational only; the "Elegir" button is in the InfoWindow of each marker.

10. **Uber vehicles always meet at the original PE — this cannot be changed.**
    This is an operational rule, not a UI preference. Uber drivers are external and are given
    a single pickup address (the PE). Changing that address dynamically would require re-booking
    the Uber. The PE is the only valid meeting point for Uber regardless of what the personal
    car driver chooses. `useStepTwo` enforces this by setting `chosenMeetingPoint = PE` and
    skipping to step 3 automatically when `has_personal_vehicle` is false.

11. **Polylines drawn imperatively via `useMap()`, not declaratively.**
    `@vis.gl/react-google-maps` v1.7.x does not ship a `<Polyline>` React component.
    The idiomatic approach is to get the map instance via `useMap()` and manage
    `google.maps.Polyline` objects directly inside a `useEffect`. Refs hold the live
    polyline instances for cleanup; the effect re-runs only when `driverRoutes` changes.

12. **Route bounds include only polyline endpoints, not all decoded points.**
    Decoding the full polyline just to compute bounds would process hundreds of points
    for a result nearly identical to using the start and end points. All intermediate
    points on a road fall between the endpoints; the bounding box from endpoints alone
    is sufficient to fit the viewport to the route. `@mapbox/polyline` is used for
    decoding (the maintained successor to the deprecated `polyline` package).

13. **`useStepTwo` watches `currentStep` via `useEffect`, not event handlers.**
    Step 2 is entered by `FrescosPanel` dispatching `SET_CURRENT_STEP 2`. Watching that
    state transition in a `useEffect` is the cleanest trigger: the hook fires exactly once
    on the 1→2 transition without needing to know anything about how step 1 is implemented.
    The `cancelled` flag prevents dispatches after the component unmounts mid-flight.

14. **Driver auto-assigned in `AppMap`, not in `PeaPanel` or `StaffMarkers`.**
    The driver assignment is a structural side-effect of entering step 3 — it belongs in
    `AppMap` (the component that owns the step lifecycle and triggers all step transitions)
    rather than in `PeaPanel` (which only dispatches SET_CURRENT_STEP and doesn't know about
    driver state) or `StaffMarkers` (which renders markers and should not own lifecycle logic).
    The guard `if (assignments !== null) return` prevents re-initialization on re-renders.

15. **Assignment state stores employee objects locally; converts to name strings for the API.**
    During step 3, `assignments.car_passengers`, `uber_passengers`, `pickup_employee`, and `driver`
    hold full employee objects (for display: name, color, Profesion).  Only when calling
    `validateAssignments` does `AssignmentPanel` convert them to `"Nombre Apellido"` strings
    (as required by `AssignmentsInput` on the backend). This avoids duplicating employee data
    or re-looking up by name for every render.

16. **Context menu as InfoWindow, not a separate DOM overlay.**
    Assignment actions in step 3 are spatially anchored to specific markers.  Rendering the
    action menu as an InfoWindow on the clicked pin is the natural Google Maps affordance.
    A separate DOM overlay would require tracking screen coordinates and handling map pan/zoom
    to keep it aligned — complexity that InfoWindow handles automatically.

17. **`activePickupResult` in global state, not local to `StaffMarkers`.**
    The find-pickup call is triggered from the context menu inside `StaffMarkers` but the result
    is displayed in `PickupResultPanel` (a sibling outside `<Map>`).  Lifting the result to global
    state avoids prop-drilling through `AppMap` or using a non-React communication mechanism.
    `PickupResultPanel` reads `state.activePickupResult` directly and clears it when dismissed.

18. **Auto-fill remaining unassigned to Uber on validate, not at assignment time.**
    Uber is the default transport: every unassigned employee in the remaining pool goes to Uber.
    Auto-filling at validate time (not incrementally as each employee is left unassigned) means
    the user can continue reassigning until they click validate, with the unassigned list always
    visible.  The validate button label changes to "Asignar X restantes a Uber y validar" when
    there are unassigned employees so the user knows exactly what will happen before clicking.
