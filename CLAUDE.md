# App Traslado Personal — Project Context

Logistics planning tool for catering events in Buenos Aires. Given an Excel file, it automates the staff transport plan: vehicles, passengers, meeting points, departure times. Built progressively — not all modules exist yet. **Read this file before making changes.**

## Tech stack

- **Backend:** Python, FastAPI, uvicorn, openpyxl, httpx
- **APIs:** Google Geocoding, Distance Matrix, Routes, Places (New), Maps JavaScript
- **Frontend:** React 19 + Vite, @vis.gl/react-google-maps v1.7.1, shadcn/ui v3, Tailwind CSS v4
- **Secrets:** All in `.env`, never in code

## Project structure

```
app-traslado-personal/
├── main.py                  ← FastAPI server and all endpoints
├── config.py                ← ALL business-rule constants and thresholds
├── modules/
│   ├── excel_reader.py      ← reads 3-sheet Excel (event, staff, services)
│   ├── maps_client.py       ← Google Maps: geocode, distance matrix, meeting points
│   ├── logistics.py         ← business logic: frescos, minifletes, vehicle assignment
│   └── api_cache.py         ← file-based cache for all Google API calls (.api_cache/)
├── _generar_excel.py        ← generates sample .xlsx for testing
├── sample_data/evento_prueba.xlsx
├── requirements.txt
├── .env
└── frontend/
    ├── vite.config.js       ← @tailwindcss/vite plugin + @ alias
    ├── .env                 ← VITE_API_BASE_URL, VITE_GOOGLE_MAPS_API_KEY, VITE_GOOGLE_MAPS_MAP_ID
    ├── src/
    │   ├── main.jsx         ← ReactDOM.createRoot, QueryClientProvider
    │   ├── App.jsx          ← AppStateProvider → APIProvider → AppShell
    │   ├── AppShell.jsx     ← loading/error gate; renders AppMap on success
    │   ├── index.css        ← @import "tailwindcss"; shadcn/ui CSS variables
    │   ├── api/
    │   │   ├── client.js    ← axios instance (baseURL from env)
    │   │   └── endpoints.js ← one async function per backend endpoint
    │   ├── state/
    │   │   └── appState.jsx ← useReducer + split contexts (state + dispatch)
    │   ├── hooks/
    │   │   └── useBootstrap.js ← readExcel + geocodeStaff on mount
    │   └── components/
    │       ├── map/
    │       │   ├── AppMap.jsx              ← full-screen Map + floating panels
    │       │   ├── MapBoundsController.jsx ← renderless; calls map.fitBounds()
    │       │   ├── StaffMarkers.jsx        ← AdvancedMarker per employee; InfoWindow (steps 1-2), context menu (step 3+)
    │       │   ├── RoutePolylines.jsx      ← blue base + red direct route (imperative via useMap())
    │       │   ├── MeetingPointMarkers.jsx ← green PE + orange PEA markers with InfoWindows
    │       │   └── EventMarker.jsx         ← black pin at event venue
    │       ├── panels/
    │       │   ├── FrescosPanel.jsx        ← van question + result summary (step 1+)
    │       │   ├── PeaPanel.jsx            ← meeting point guide + confirmation (step 2)
    │       │   ├── AssignmentPanel.jsx     ← car/uber assignment + validate (step 3)
    │       │   └── PickupResultPanel.jsx   ← find-pickup results + confirm (on-demand)
    │       └── ui/                         ← shadcn/ui components
```

---

## Excel structure (3 sheets)

Sheet names: **Evento**, **Equipo**, **Prestaciones** (Spanish, from Access DB). `excel_reader.py` maps to internal English keys via `_EVENT_FIELD_MAP`.

### Evento (field/value pairs, NO header row)
| Excel field | Internal key | Notes |
|---|---|---|
| Menu | tipo | e.g. "Asado Finger Food" |
| Evento | ocasion | e.g. "Cumpleaños" |
| Locacion | direccion_evento | Full address for geocoding |
| *(derived)* | ciudad_evento | Last comma token, `.` stripped |
| DescripcionLocacion | descripcion_locacion | Free text |
| Empresa | empresa | May be None |
| Observaciones | observaciones | List of strings; split on `\n` |
| Fecha | fecha | Date string from openpyxl |
| Horario | hora_inicio | "HH:MM" (openpyxl returns datetime.time) |
| Comensales carne | comensales | Integer |
| Comensales veggie | comensales_veggie | Integer |

### Equipo (table, row 1 = headers)
Columns: Profesion, Nombre, Apellido, Direccion, CP, Ciudad, Auto, Patente (first 8 only).
- Seniority embedded in Profesion (e.g. "Manager Senior", "Camarero Medior", "Parrillero Junior")
- Auto: non-empty, non-"NO" → has car. "NO" normalized to "". Always exactly 2 Parrilleros, never two Seniors.
- Rows with empty Profesion skipped. `\xa0` stripped. Trailing None columns ignored.

### Prestaciones (table, row 1 = headers)
Columns: Servicio, Detalle, Cantidad. Trailing None columns beyond 3 ignored.

---

## Full app flow

### Step 1 — Frescos vehicle
`determine_frescos_vehicle(has_own_van, staff)`:
- Van available → "camioneta propia", assign Manager Senior + highest-seniority Parrilla
- No van → "miniflete contratado", assign Manager Senior only
- Uses `_find_manager_senior()` (exact match) and `_find_highest_parrilla()` (substring + seniority rank)
- Output: `{"vehicle": str, "assigned_names": list[str]}`
- Assigned employees removed from pool via role strings tracked by frontend

### Step 2 — Second miniflete
Independent from Step 1. Triggered when "estacion de fuegos" NOT contracted AND any of:
- "asado tradicional" AND comensales > 60
- "asado finger food" AND comensales > 70
- "acompañamiento bebidas" AND cantidad > 20

If triggered: assign 1 person by role hierarchy → removed from pool.

### Step 3 — Departure times from CP
`calculate_departure_time(event_time_str, travel_seconds, event_duration_hours, picada_guests)`.
CP address/coords are constants in `config.py`.
Formula: departure = event_time − DEPARTURE_PREP_HOURS − travel_time(ceil) − DEPARTURE_BUFFER_MINUTES − LOADING_TIME_MINUTES.
If duration ≥ LONG_EVENT_DURATION_THRESHOLD (8h) OR picada_guests ≥ PICADA_GUEST_THRESHOLD (100) → subtract LONG_EVENT_EXTRA_HOURS (2h).
Both vehicles always depart at the same time.

### Step 4 — Remaining staff vehicle assignment
**4a** `get_remaining_pool`: pool = staff minus assigned roles.
- pool == 1 → "alternative" (halt). pool > 8 → "charter" (halt). Otherwise → "proceed".

**4b** `detect_personal_vehicle`: scans Auto column, first non-empty wins. Warning if multiple cars.

**4b** `assign_vehicle_passengers(remaining_pool, driver, chosen_meeting_point)`:
- Removes driver; sorts by Haversine to meeting point; closest MAX_PASSENGERS_PER_CAR (4) → car
- Rest → Uber groups of MAX_PASSENGERS_UBER (4). Single Uber passenger → warning (TODO: consult manager)
- No personal car → 422 (separate /assign-uber-only endpoint needed, not built)

### Step 5 — Meeting point and driver routes
`nearest_meeting_point(event_coords)`: Distance Matrix, picks closest of 3 fixed PEs:
- North: Puente Saavedra (Av. Gral Paz y Cabildo)
- South: Caballito (Rivadavia y Emilio Mitre)
- West: Ramos Mejía (McDonald's, Av. de Mayo 1200)

`calculate_driver_route(driver_coords, meeting_point, event_coords)`: Routes API.
Returns base_route (home→PE→event) and direct_route (home→event). Both TRAFFIC_AWARE. Each has duration_seconds, distance_meters, encoded_polyline, legs.

### Step 6 — PEA (alternative meeting point)
**Candidate search** `find_pea_candidates(direct_route_polyline)`: Places API (New).
Decodes polyline, samples every 5th point, searches 300m for transit hubs (transit/subway/train/bus_station). Deduplicates by address.

**Evaluation** `evaluate_pea_candidates(candidates, remaining_pool, meeting_point)`:

Phase 1 — Cluster employees by proximity (greedy, CLUSTER_RADIUS_KM = 8km).
Phase 2 — Per cluster: Distance Matrix per candidate (transit to candidate vs PE). Score = sum of time_saved for top 4 closest employees (matches car capacity).
Phase 3 — One winner per cluster, deduplicate, cap at 3. Proximity check: ≤ PEA_RADIUS_KM (10km) = "optimal", >10km = remuneration_note.

User sees candidates on map, decides PE or PEA.

### Step 7 — Pickup points (personal car only, max 1)
`get_pickup_highlight(remaining_pool, route_polyline, meeting_point)`: pure geometry, farthest employee from meeting point → cross_point on polyline. Auto-shown on map load.

`find_pickup_candidate(route_polyline, employee, meeting_point)`: ON DEMAND via context menu.
1. Find closest polyline vertex to employee (cross_point)
2. Distance Matrix transit: warnings if transit > PICKUP_MAX_TRANSIT_MINUTES (30min) or savings < PICKUP_MIN_TIME_SAVING_MINUTES (20min) — informational only
3. Places API around cross_point, radius PICKUP_MAX_DETOUR_METERS (300m), filter by proximity to polyline
4. Return top PICKUP_TOP_CANDIDATES (3)

Uber vehicles do NOT get pickup points.

### Step 8 — Final output
Departure times (CP + PE/PEA), full map with markers, vehicle assignments, pickup confirmations.

Functions: `validate_assignments`, `build_assignment_summary`, `calculate_pe_departure_time` (same formula as CP minus LOADING_TIME), `build_final_output` (reshapes into frescos_block + transport_block).

---

## Architecture rules

1. **Constants**: ALL thresholds/keywords/numeric params in `config.py`. Never hardcode in logic modules.
2. **Multi-step flow**: One endpoint per step. Frontend accumulates state. Don't collapse steps.
3. **One personal vehicle per event**: Never build multi-vehicle routing.
4. **Capacity**: MAX_PASSENGERS_PER_CAR = 4 (excl. driver), MAX_PASSENGERS_UBER = 4 (excl. Uber driver).

---

## Working endpoints

`GET`: /read-excel, /geocode-staff, /nearest-meeting-point, /detect-personal-vehicle, /calculate-driver-route, /evaluate-pea, /cache-stats
`POST`: /determine-frescos, /determine-second-miniflete, /calculate-departure-time, /get-remaining-pool, /find-pickup, /assign-passengers, /validate-assignments, /confirm-assignments, /final-output
`DELETE`: /cache-clear

---

## TODOs

- ~~**Places API caching**: Cache `find_pea_candidates()` and `find_pickup_candidate()`~~ → DONE: `modules/api_cache.py` caches all Google API calls to `.api_cache/`. Toggle via `API_CACHE_ENABLED` in `.env`.
- **Frescos-assigned markers non-interactive (step 3)**: Employees already assigned to the frescos vehicle (e.g. Manager Senior, Jefe de Parrilla Senior) must NOT appear as assignable in step 3. Their markers must use a distinct color (not blue/unassigned), show "Asignado al Vehículo QH" on click, and have NO context menu actions (no "Asignar al vehículo", no "Asignar a Uber"). They are already committed — the user cannot reassign them. Affects `StaffMarkers.jsx`: check employee name against `state.frescosResult.assigned_names` (and `state.secondMinifleteResult.assigned_name` if present) before rendering context menu. Use a dedicated color (suggestion: dark purple or similar, distinct from driver green, uber grey, unassigned blue).
- **Final output redesign (step 4 post-confirm)**: Replace the current two small draggable blocks (`FinalOutputBlocks`) with a single large modal/panel that occupies most of the screen. Map stays running and visible behind it (semi-transparent backdrop). Must include a "Volver a editar" button that returns to step 3 with full state preserved (same behavior as current "Editar"). Consolidate both blocks (frescos + transport) into sections within this single panel. The current ConfirmationModal should transition into this final view, not coexist with separate blocks.
- **Pickup map highlight**: Visual circle overlay around cross-points and candidates for CEO/manager review
- **Employee database**: `employees.json` with cached coordinates — check before geocoding
- **departure_from_pe**: Currently null in `build_assignment_summary()` — needs Routes API call in /confirm-assignments
- **End-to-end departure time verification** with Routes API arrivalTime in production

---

## Frontend architecture

### Provider hierarchy
```
AppStateProvider → APIProvider → AppShell → AppMap
```
`APIProvider` in `App.jsx` (survives map remount). `AppShell` separate file (needs `useAppState()` below `AppStateProvider`).

### Layout
AppMap: `position: relative; 100vw × 100vh`. `<Map>` fills entirely. Floating panels are **siblings** of `<Map>` (not children — Maps API owns DOM inside `<Map>`).

### Key stack details
- JSX files must use `.jsx` extension (Vite requirement). `appState.jsx` included.
- Tailwind v4 via `@tailwindcss/vite` — no postcss/tailwind config files
- `@tanstack/react-query` with no retry on 4xx
- CORS: must allow both `localhost:5173` and `127.0.0.1:5173`

---

## Frontend state flow

State in `appState.jsx`: `useReducer` + split contexts (state + dispatch, prevents unnecessary re-renders).

| Slice | Source | Step |
|---|---|---|
| excelData, staffWithCoords | useBootstrap | Boot |
| loadingStep, error | useBootstrap, FrescosPanel | All |
| frescosResult, secondMinifleteResult, remainingPool, personalVehicle | FrescosPanel (4 calls) | 1 |
| currentStep | FrescosPanel (after all calls succeed) | 1→2 |
| meetingPoint, driverRoutes, peaEvaluation | useStepTwo (auto on step 2) | 2 |
| chosenMeetingPoint | MeetingPointMarkers InfoWindow | 2 |
| eventCoords | EventMarker (polyline or Geocoding) | 1+ |
| assignments | AppMap useEffect (init) + StaffMarkers context menu | 3 |
| activePickupResult | StaffMarkers → findPickup() | 3 |
| showModal | AssignmentPanel → validateAssignments() | 4 |
| finalOutput, showOutput | ConfirmationModal → finalOutput() | 4 |

**Rule**: `SET_CURRENT_STEP` always dispatched after all dependent slices are populated.

---

## Frontend UX

### Color coding
| Element | Before selection | After PE | After PEA |
|---|---|---|---|
| Base route (home→PE→event) | Blue #4285F4 | Yellow #FBBC04 | Hidden |
| Direct route (home→event) | Red #EA4335 60% | Hidden | Orange #FF6D00 |
| PE marker | Green #34A853 | Green, 1.4×, ✓ | Hidden |
| PEA markers | Orange #FF6D00 | Hidden | Orange, 1.4×, ✓ |
| Driver + car passengers | Blue (unassigned) | Yellow #FBBC04 | Orange #FF6D00 |
| Uber passengers | Blue (unassigned) | Grey #9E9E9E | Grey #9E9E9E |
| Frescos-assigned employees | Distinct color (TODO), non-interactive, "Asignado al Vehículo QH" | same | same |
| Event venue | Red #EA4335 (always) | same | same |
| Pickup employee/venue | #FFC107 amber (always) | same | same |

- **"Vehículo QH"** replaces "camioneta propia" in UI display (backend value unchanged).
- **Vehicle label**: "{vehicle_description} de {Nombre} {Apellido}" everywhere.

### Manual assignment (step 3)
Context menu on marker click: "Asignar al vehículo", "Buscar pickup en ruta", "Asignar a Uber", "Quitar asignación".
Driver marker: green, no actions, "Chofer — asignado automáticamente". Steps 1-2: InfoWindow only.
Auto-fill remaining to Uber happens at validate time (not incrementally).

### Modal & output
- Confirmation modal: draggable, map interactive behind it. "Editar" → back to step 3, full state preserved, no API re-calls.
- "Confirmar" → POST /final-output → **TODO: replace current two small draggable blocks with a single large panel** that covers most of the screen (map visible behind). Includes both frescos and transport info as sections, plus "Volver a editar" button.
- Map viewport: not constrained to CABA, must fit all addresses and routes.

---

## Key decisions (rationale summary)

1. `APIProvider` at root — survives map remount
2. Panels as siblings of `<Map>` — Maps API owns DOM inside `<Map>`
3. `AdvancedMarker` not deprecated `Marker` — requires mapId
4. `selectedEmployee` local state — transient UI, not business state
5. Bounds computed in AppMap — single viewport owner
6. Four backend calls in one FrescosPanel handler — single user decision, single try/catch
7. `deriveProfesiones()` bridges assigned_names → assigned_roles to avoid hardcoding role strings
8. `appState.jsx` needs `.jsx` extension for Vite JSX transform
9. Meeting point selection on map markers (InfoWindow), not in panel — spatial context matters
10. Uber always meets at original PE — operational rule, not UI preference
11. Polylines drawn imperatively via `useMap()` — no `<Polyline>` component in vis.gl v1.7.x
12. Route bounds use polyline endpoints only — sufficient, avoids decoding hundreds of points
13. `useStepTwo` watches `currentStep` via useEffect — clean 1→2 transition trigger
14. Driver auto-assigned in AppMap — owns step lifecycle
15. Assignments store full objects locally, convert to name strings for API
16. Context menu as InfoWindow — auto-handles pan/zoom alignment
17. `activePickupResult` in global state — cross-component (StaffMarkers → PickupResultPanel)
18. Auto-fill Uber at validate time — user keeps full control until then
19. `compute_route_matrix()` replaces `calculate_distances()` for driving — supports arrivalTime. Legacy kept for transit and `nearest_meeting_point()`
20. `_compute_arrival_time()` — Buenos Aires UTC-3 (no DST), `tzdata` required on Windows
21. ConfirmationModal reads from existing state, not validate response
22. Modal stays after "Confirmar"; **TODO: redesign output as single large panel replacing two draggable blocks**
23. "Editar" preserves all state, no API re-calls
24. `pickup_transit_minutes` stored on `state.assignments`, computed locally
25. `FinalOutputRequest` has 4 fields only; `/final-output` reads rest from Excel
