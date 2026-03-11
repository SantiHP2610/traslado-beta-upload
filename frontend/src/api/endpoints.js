/**
 * api/endpoints.js
 * One named async function per FastAPI endpoint.
 *
 * Why keep endpoints in a separate file from the axios client?
 *   - client.js owns transport concerns (base URL, headers, interceptors).
 *   - endpoints.js owns contract concerns (paths, parameters, return shapes).
 *   Separating them means you can swap the HTTP client (axios → fetch, etc.)
 *   without touching the endpoint definitions, and vice versa.
 *
 * Why named functions instead of a class or object map?
 *   - Tree-shakeable: bundlers can drop unused endpoints.
 *   - Easy to mock individually in tests.
 *   - React Query's queryFn / mutationFn slots accept a plain async function.
 *
 * Naming convention:
 *   - GET endpoints: readExcel(), geocodeStaff(), etc. (no body parameter)
 *   - POST endpoints: determineFrescos(body), etc. (body is a plain object)
 *   - GET endpoints with query params: calculateDriverRoute(params) where
 *     params is an object passed as { params } to axios (→ query string).
 *
 * Return value:
 *   Each function returns response.data — the parsed JSON from FastAPI.
 *   Callers do not need to await .json() or check .ok; axios does that.
 */

import client from './client'

// ---------------------------------------------------------------------------
// Step 1 — Excel data
// ---------------------------------------------------------------------------

/**
 * Reads the event Excel and returns the three parsed sheets.
 * @returns {{ event: object, staff: object[], services: object[] }}
 */
export async function readExcel() {
  const response = await client.get('/read-excel')
  return response.data
}

// ---------------------------------------------------------------------------
// Step 2 — Staff geocoding
// ---------------------------------------------------------------------------

/**
 * Returns the full staff list enriched with lat/lng coordinates.
 * Each employee gets a "coordinates" key (or null if geocoding fails).
 * @returns {object[]}
 */
export async function geocodeStaff() {
  const response = await client.get('/geocode-staff')
  return response.data
}

// ---------------------------------------------------------------------------
// Address geocoding (on-demand, marker edit UI)
// ---------------------------------------------------------------------------

/**
 * Geocodes a free-text address string.
 * Used by the marker edit UI when the user corrects an employee's address.
 * @param {string} address
 * @returns {{ lat: number, lng: number, formatted_address: string }}
 */
export async function geocodeAddress(address) {
  const response = await client.get('/geocode-address', { params: { address } })
  return response.data
}

// ---------------------------------------------------------------------------
// Step 3 — Meeting point
// ---------------------------------------------------------------------------

/**
 * Returns the nearest of the 3 fixed staging points (PE) to the event venue.
 * @returns {{ name: string, address: string, lat: number, lng: number,
 *             duration_seconds: number, distance_meters: number, ... }}
 */
export async function nearestMeetingPoint() {
  const response = await client.get('/nearest-meeting-point')
  return response.data
}

// ---------------------------------------------------------------------------
// Step 4 — Frescos vehicle
// ---------------------------------------------------------------------------

/**
 * Determines which vehicle carries the frescos and which employees are assigned.
 * @param {{ has_own_van: boolean }} body
 * @returns {{ vehicle: string, assigned_names: string[] }}
 */
export async function determineFrescos(body) {
  const response = await client.post('/determine-frescos', body)
  return response.data
}

/**
 * Evaluates whether a second miniflete is needed based on event services.
 * @returns {{ needs_second_miniflete: boolean, reason: string }}
 */
export async function determineSecondMiniflete() {
  const response = await client.post('/determine-second-miniflete')
  return response.data
}

// ---------------------------------------------------------------------------
// Step 5 — Departure time from CP
// ---------------------------------------------------------------------------

/**
 * Calculates the CP departure time for the frescos vehicle(s).
 * @param {{ event_duration_hours: number, picada_guests: number }} body
 * @returns {{ departure_time: string, extra_prep_applied: boolean,
 *             extra_prep_reason: string[], total_minutes_before_event: number }}
 */
export async function calculateDepartureTime(body) {
  const response = await client.post('/calculate-departure-time', body)
  return response.data
}

// ---------------------------------------------------------------------------
// Step 6 — Remaining staff pool
// ---------------------------------------------------------------------------

/**
 * Builds the remaining staff pool after excluding frescos-assigned roles.
 * Returns charter / alternative flags if the pool size is out of range.
 * @param {{ assigned_roles: string[] }} body
 * @returns {{ remaining_pool: object[], remaining_count: number,
 *             status: 'proceed'|'charter'|'alternative', ... }}
 */
export async function getRemainingPool(body) {
  const response = await client.post('/get-remaining-pool', body)
  return response.data
}

// ---------------------------------------------------------------------------
// Step 7 — Personal vehicle detection
// ---------------------------------------------------------------------------

/**
 * Checks the staff list for a personal vehicle (Auto column).
 * @returns {{ has_personal_vehicle: boolean, driver: object|null,
 *             vehicle_description: string|null, warning: string|null }}
 */
export async function detectPersonalVehicle() {
  const response = await client.get('/detect-personal-vehicle')
  return response.data
}

// ---------------------------------------------------------------------------
// Step 8 — Driver route calculation
// ---------------------------------------------------------------------------

/**
 * Computes the driver's base route (home→PE→event) and direct route (home→event).
 * Both encoded polylines are returned for map rendering and PEA/pickup evaluation.
 * @returns {{ base_route: object, direct_route: object }}
 */
export async function calculateDriverRoute() {
  const response = await client.get('/calculate-driver-route')
  return response.data
}

// ---------------------------------------------------------------------------
// Step 9 — PEA evaluation
// ---------------------------------------------------------------------------

/**
 * Runs the full PEA pipeline: geocodes staff, computes driver routes, searches
 * for transit-hub candidates, evaluates them, and returns up to 3 ranked options.
 *
 * Pickup logic is NOT included here — use findPickup() on demand instead.
 *
 * @returns {{
 *   meeting_point: object,
 *   driver_routes: { base_route: object, direct_route: object },
 *   pea_evaluation: { has_candidates: boolean, candidates: object[] }
 * }}
 */
export async function evaluatePea() {
  const response = await client.get('/evaluate-pea')
  return response.data
}

// ---------------------------------------------------------------------------
// Step 10 — On-demand pickup search
// ---------------------------------------------------------------------------

/**
 * Searches for pickup venue options along the driver's route for a specific
 * employee.  Called on demand when the user opens the map context menu and
 * selects "Find pickup on route".
 *
 * Why does the frontend supply the polyline?
 *   The backend is stateless — it does not know which scenario the user
 *   chose (PE vs PEA) after /evaluate-pea returned.  The frontend holds
 *   both polylines and passes the correct one here.
 *
 * @param {{
 *   employee_name: string,
 *   route_polyline: string,
 *   meeting_point: { name: string, lat: number, lng: number }
 * }} body
 * @returns {{
 *   pickup_candidate: object|null,
 *   reason: string|null
 * }}
 */
export async function findPickup(body) {
  const response = await client.post('/find-pickup', body)
  return response.data
}

// ---------------------------------------------------------------------------
// Step 11 — Passenger assignment
// ---------------------------------------------------------------------------

/**
 * Assigns the remaining staff pool to the personal car and Uber groups.
 * @param {{
 *   chosen_meeting_point: { name: string, lat: number, lng: number },
 *   assigned_roles: string[]
 * }} body
 * @returns {{ personal_vehicle: object, uber_groups: object[],
 *             single_employee_warning: string|null }}
 */
export async function assignPassengers(body) {
  const response = await client.post('/assign-passengers', body)
  return response.data
}

// ---------------------------------------------------------------------------
// Step 12 — Assignment validation and confirmation
// ---------------------------------------------------------------------------

/**
 * Validates that all employees in the remaining pool appear in the submitted
 * assignments.  Returns a partial summary (no departure times) for the
 * preview modal.
 * @param {{ assignments: object, assigned_roles: string[] }} body
 * @returns {{ valid: boolean, message: string, summary: object|null }}
 */
export async function validateAssignments(body) {
  const response = await client.post('/validate-assignments', body)
  return response.data
}

/**
 * Safety re-validates, then builds the complete assignment summary including
 * CP departure time.  Populates both draggable output blocks.
 * @param {{
 *   assignments: object,
 *   assigned_roles: string[],
 *   chosen_meeting_point: object,
 *   event_duration_hours: number,
 *   picada_guests: number
 * }} body
 * @returns {{ valid: boolean, summary: object }}
 */
export async function confirmAssignments(body) {
  const response = await client.post('/confirm-assignments', body)
  return response.data
}

/**
 * Final safety check.  Computes both departure times (CP and PE/PEA) and
 * returns the two draggable map blocks (frescos_block + transport_block).
 *
 * The backend reads event_duration_hours and picada_guests directly from the
 * Excel file — the frontend does not need to supply them.
 *
 * @param {{
 *   assignments:          object,
 *   assigned_roles:       string[],
 *   chosen_meeting_point: { name: string, lat: number, lng: number },
 *   has_own_van:          boolean
 * }} body
 * @returns {{ frescos_block: object, transport_block: object }}
 */
export async function finalOutput(body) {
  const response = await client.post('/final-output', body)
  return response.data
}
