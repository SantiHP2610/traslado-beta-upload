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
- No personal car → use /assign-uber-only instead (all remaining staff assigned to Uber groups)

**Pending employee (single-employee edge case):** When exactly 1 employee remains unassigned at validate time, the manager may choose "Buscar alternativa y dejar pendiente" instead of assigning them to Uber. This stores the employee's name in `assignments.pending_employee`. `validate_assignments()` treats `pending_employee` as a valid assignment (same coverage as Uber — the name is in the pool and is accounted for). The final output shows them under "Transporte alternativo a coordinar". `pending_employee` is a field in `AssignmentsInput` (optional, `str | None = None`) and flows through `build_assignment_summary()` and `build_final_output()` to the frontend output blocks.

### Step 5 — Meeting point and driver routes
`nearest_meeting_point(event_coords)`: Distance Matrix, picks closest of 3 fixed PEs:
- North: Puente Saavedra (Av. Gral Paz y Cabildo)
- South: Caballito (Rivadavia y Emilio Mitre)
- West: Ramos Mejía (McDonald's, Av. de Mayo 1200)

`calculate_driver_route(driver_coords, meeting_point, event_coords)`: Routes API.
Returns base_route (home→PE→event) and direct_route (home→event). Both TRAFFIC_AWARE. Each has duration_seconds, distance_meters, encoded_polyline, legs.

### Step 6 — PEA (alternative meeting point)
**Employee-centric pipeline** `evaluate_pea_candidates(remaining_pool, meeting_point, route_polyline, driver_name=None)`:

Driver exclusion: before any filtering, the driver (personal vehicle) is removed from the candidate pool — they are already committed to the car, so a PEA near their home is irrelevant for them. Pass `driver_name = "Nombre Apellido"` from `/evaluate-pea`.

Phase 0 — Filter employees near route: `_filter_employees_near_route()` keeps only employees whose home is within `PEA_ROUTE_PROXIMITY_KM = 5km` of the nearest polyline vertex. If none qualify → return immediately, zero API calls.
Phase 1 — Cluster filtered employees by proximity (greedy, CLUSTER_RADIUS_KM = 8km): `_cluster_by_proximity()`. Clusters with fewer than `MIN_CLUSTER_SIZE = 2` members are discarded — a PEA only benefiting 1 person is not worth the detour.
Phase 2 — Per cluster: find the polyline vertex closest to the cluster centroid → one Places API call (`_search_pea_near_point()`, 300m radius, transit hubs) → evaluate with `_best_candidate_for_cluster()`. Total Places calls = number of clusters (1-3), not ~40 across full polyline.
Phase 3 — One winner per cluster, deduplicate, cap at 3. Proximity check: ≤ PEA_RADIUS_KM (10km) = "optimal", >10km = remuneration_note.

Score per candidate: sum of `time_saved_min` for the 4 closest employees (by transit time), stored as `top4_savings_minutes`. Candidates ranked descending.

PEA candidate fields (per candidate): `name`, `address`, `lat`, `lng`, `top4_savings_minutes`, `top4_employees`, `exclusively_prefer_count`, `pea_near_original`, `remuneration_note`, `cluster_members`, `staff_metrics`, plus three enriched Places fields: `primary_type` (str|None), `editorial_summary` (str|None), `opening_hours` (list[str], weekday descriptions).

`find_pea_candidates()` in maps_client.py is deprecated — kept for cache compatibility.

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

`GET`: /read-excel, /geocode-staff, /geocode-address, /nearest-meeting-point, /detect-personal-vehicle, /calculate-driver-route, /evaluate-pea, /cache-stats, /config
`POST`: /determine-frescos, /determine-second-miniflete, /calculate-departure-time, /get-remaining-pool, /find-pickup, /assign-passengers, /assign-uber-only, /validate-assignments, /confirm-assignments, /final-output, /config, /config-reset
`DELETE`: /cache-clear

---

## TODOs

- **Final output redesign (step 4 post-confirm)**: Replace the current two small draggable blocks (`FinalOutputBlocks`) with a single large modal/panel that occupies most of the screen. Map stays running and visible behind it (semi-transparent backdrop). Must include a "Volver a editar" button that returns to step 3 with full state preserved (same behavior as current "Editar"). Consolidate both blocks (frescos + transport) into sections within this single panel. The current ConfirmationModal should transition into this final view, not coexist with separate blocks.
- **Pickup map highlight**: Visual circle overlay around cross-points and candidates for CEO/manager review
- **Employee phone numbers**: Once the final Excel format is implemented, request a phone number field for each employee (Equipo sheet). Display it in the InfoWindow and in the sidebar whenever employee info is shown (steps 1-2 info panel, step 3 assignment context menu, assignment summary panel).

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
| currentStep, stepHistory | useBootstrap (0→1) / FrescosPanel (1→2) / useStepTwo (2→3) | All |
| meetingPoint, driverRoutes, peaEvaluation | useStepTwo (auto on step 2) | 2 |
| chosenMeetingPoint | MeetingPointMarkers InfoWindow | 2 |
| eventCoords | EventMarker (polyline or Geocoding) | 1+ |
| assignments | AppMap useEffect (init) + StaffMarkers context menu | 3 |
| activePickupResult | StaffMarkers → findPickup() | 3 |
| coordinateOverrides | StaffMarkers drag / geocode | 1+ |
| editingMarker | StaffMarkers "Editar dirección" | 1+ |
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
| PE marker | Yellow #FBBC04 | Yellow, 1.4×, ✓ | Hidden |
| PEA markers | Orange #FF6D00 | Hidden | Orange, 1.4×, ✓ |
| Driver + car passengers | Blue (unassigned) | Yellow #FBBC04 | Orange #FF6D00 |
| Uber passengers | Blue (unassigned) | Grey #9E9E9E | Grey #9E9E9E |
| Frescos-assigned employees | #B0C4DE faded blue, opacity 0.6, non-interactive, "Asignado al Vehículo QH" | same | same |
| Event venue | Red #EA4335 (always) | same | same |
| Pickup employee/venue | #FFC107 amber (always) | same | same |

- **"Vehículo QH"** replaces "camioneta propia" in UI display (backend value unchanged).
- **Vehicle label**: "{vehicle_description} de {Nombre} {Apellido}" everywhere.

### Manual assignment (step 3)
Context menu on marker click: "Asignar al vehículo", "Buscar pickup en ruta", "Asignar a Uber", "Quitar asignación".
Driver marker: green, no actions, "Chofer — asignado automáticamente". Steps 1-2: InfoWindow only.
Auto-fill remaining to Uber happens at validate time (not incrementally).

**Two-phase validate flow** (AssignmentPanel): clicking "Asignar N restantes a Uber y validar":
- Phase 1 — dispatch auto-fill to global state + set `pendingAutoFillCheck(true)` flag → triggers re-render so Uber groups appear on screen before any warning.
- Phase 2 — `useEffect([pendingAutoFillCheck, assignments])` fires after paint; checks whether any Uber group has exactly 1 passenger; if yes → shows two-button choice; if no → calls `doValidate()` immediately.
- Solo-passenger warning shows amber border on the solo group and two buttons: "Buscar alternativa y dejar pendiente" (stores `pending_employee` name, removes from Uber) / "Continuar con 1 pasajero en Uber" (proceeds as-is).
- "Reiniciar asignaciones" button resets all assignments back to driver-only initial state (dispatches fresh `SET_ASSIGNMENTS` with empty car/uber arrays).

### Marker position editing (all steps)
Every InfoWindow has an "Editar dirección" link at the bottom. Clicking it enters edit mode for that marker only: the pin becomes draggable and an address input + "Geocodificar" / "Listo" UI appears in the InfoWindow. Position changes (drag or geocode) are stored in `coordinateOverrides[name]` and overrule `employee.coordinates` for rendering. "Volver a ubicación original" reverts the override. Only one marker is editable at a time (`editingMarker` state); clicking any other marker exits edit mode. All position changes animate with ease-out-cubic over 800ms via `useAnimatedPosition` (requestAnimationFrame). Override indicator: small white dot badge on the pin. Backend: `GET /geocode-address?address=` wraps `geocode()` for on-demand address resolution.

**Driver coordinate override (step 2)**: when the driver's marker changes position (drag or address geocode) in step 2 BEFORE a meeting point is confirmed, `useStepTwo` Effect 2 automatically re-calls `/calculate-driver-route` and `/evaluate-pea` with the new origin. Effective coordinates are computed as `override?.lat ?? originalCoords?.lat ?? null` — this fires for both setting an override AND clearing one ("Volver a ubicación original"), so routes always reflect the driver's current position. After `chosenMeetingPoint` is set, driver editing is locked: the InfoWindow shows "Dirección bloqueada — punto de encuentro ya seleccionado." instead of the edit link.

### Global back button
A "Volver atrás" button (bottom-left corner, `position: absolute; bottom: 24; left: 16`) is visible whenever `state.stepHistory.length > 0` AND `state.showOutput` is false. Dispatches `STEP_BACK`, which pops the history stack and clears step-specific state: step 4 → clears modal/output/finalOutput; step 3 → clears assignments/activePickupResult/chosenMeetingPoint; step 2 → clears routes/PEA/meetingPoint/chosenMeetingPoint; step 1 → clears frescos/miniflete/pool/personalVehicle.

### Config panel
A gear icon button (top-right corner, always visible, z-40) opens a full-height settings panel (`ConfigPanel.jsx`, z-50) that slides in from the right. The panel loads all `config.py` constants via `GET /config`, grouped by category with Spanish section headers. Each constant shows its name (monospace), a description, and an editable input (number for int/float, text for strings, JSON textarea for dicts/lists). Changed fields get a blue left border.

- **"Guardar"** — sends only changed values to `POST /config`. The backend validates types, updates all importing modules' namespaces at runtime (no restart needed), and rewrites `config.py` on disk preserving comments and formatting.
- **"Restaurar ajustes predeterminados"** — shows an inline confirmation, then calls `POST /config-reset` which writes the original `config.py` text (snapshotted at server startup) back to disk and reloads all constants.

Categories: Frescos/Minifletes, Capacidad de vehículos, Tiempos, PEA, Pickup, CP, Fórmula de salida.

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
26. Two-phase validate in `AssignmentPanel` — Phase 1 dispatches auto-fill + sets `pendingAutoFillCheck(true)` flag; Phase 2 `useEffect` fires after re-render to check for solo group — avoids reading stale state inside the click handler before the reducer has processed the auto-fill dispatch
27. Step history stack: `initialState.currentStep = 0`; bootstrap dispatches `SET_CURRENT_STEP 1` to seed `stepHistory = [0]`; `STEP_BACK` determines what to clear from `state.currentStep` (the step being LEFT), not the destination step
28. `effectiveLat = override?.lat ?? originalCoords?.lat ?? null` unifies override-set and override-cleared cases into one dep value for `useStepTwo` Effect 2 — removing `!driverOverride` guard and using `effectiveLat == null` instead ensures clearing an override also triggers route recalculation
29. Optional `driver_lat`/`driver_lng` query params on `/calculate-driver-route` and `/evaluate-pea` — backend stays stateless; frontend passes current effective driver coordinates when available so the backend skips its own geocoding
