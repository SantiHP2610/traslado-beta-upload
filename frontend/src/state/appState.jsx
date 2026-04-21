/**
 * state/appState.jsx
 * Global application state via React context + useReducer.
 *
 * ── Why useReducer instead of multiple useState calls? ───────────────────────
 * This app has a strictly sequential multi-step flow: each step depends on the
 * result of the previous one, and many components need to read or update the
 * same slice of state (e.g. the map, the sidebar, and a confirmation modal all
 * care about chosenMeetingPoint).  With individual useState calls:
 *   - State is fragmented across components; sharing it requires prop drilling
 *     or lifting state further and further up the tree.
 *   - Related updates are scattered; dispatching a single "step completed"
 *     action that sets three fields simultaneously is impossible.
 *   - It is harder to trace what caused a given state change — reducers give
 *     us a central audit trail via action types.
 *
 * useReducer + context is the React-idiomatic answer for this pattern:
 *   - One reducer owns all transitions; action types document intent.
 *   - Context makes the state available anywhere without prop drilling.
 *   - No extra dependency (Redux, Zustand) needed for an app this size.
 *
 * ── Why currentStep is in global state ───────────────────────────────────────
 * Multiple unrelated components need to know which step is active:
 *   - The map renders different overlays depending on the step.
 *   - The sidebar shows different controls.
 *   - The step indicator (future) highlights the active step.
 * If currentStep were local to any one component, the others would need it
 * passed down as props, creating tight coupling.  Global state is the right
 * home for data that crosses component boundaries.
 *
 * ── Why loadingStep is a string, not a boolean ───────────────────────────────
 * A boolean `isLoading` can only answer "are we loading?" — it cannot answer
 * "loading what?".  A string like "excel" or "pea" lets the UI render a
 * step-specific spinner message ("Cargando datos del evento..." vs
 * "Buscando puntos de reunión...").  null means nothing is loading.
 *
 * ── vehicles array model (step 3+) ───────────────────────────────────────────
 * Each vehicle object:
 *   {
 *     id: "personal" | "uber_1" | "uber_2" | ...,
 *     type: "personal" | "uber",
 *     driver: string | null,           // personal only
 *     vehicle_description: string | null, // personal only
 *     meeting_point: { lat, lng, name, address },
 *     custom_meeting_point: boolean,
 *     passengers_pe: string[],         // names at this vehicle's PE
 *     pickup: { point: object|null, passengers: string[] },
 *     route: object | null,            // encoded_polyline, duration_seconds, etc.
 *     capacity: 5 (personal) | 4 (uber),
 *     color: object                    // from VEHICLE_COLORS
 *   }
 */

import { createContext, useContext, useReducer } from 'react'

// ---------------------------------------------------------------------------
// Vehicle color palette — one entry per vehicle slot.
// Each entry carries route color, passenger marker color, and pickup color.
// ---------------------------------------------------------------------------

export const VEHICLE_COLORS = {
  personal: { route: '#FBBC04', passengers: '#FBBC04', pickup: '#7B1FA2' },
  uber_1:   { route: '#2D2D2D', passengers: '#2D2D2D', pickup: '#1A3A5C' },
  uber_2:   { route: '#5A5A5A', passengers: '#5A5A5A', pickup: '#2E5E8E' },
  uber_3:   { route: '#858585', passengers: '#858585', pickup: '#4A7FB5' },
}

// ---------------------------------------------------------------------------
// Internal factory — builds a blank vehicle object with correct defaults.
// ---------------------------------------------------------------------------

function _buildVehicle(id, type, driver, vehicleDescription, meetingPoint, capacity, color) {
  return {
    id,
    type,
    driver:               driver ?? null,
    vehicle_description:  vehicleDescription ?? null,
    meeting_point:        meetingPoint,
    custom_meeting_point: false,
    passengers_pe:        [],
    pickup:               { point: null, passengers: [] },
    route:                null,
    capacity,
    color,
  }
}

// ---------------------------------------------------------------------------
// Initial state — mirrors the full app flow declared in CLAUDE.md
// ---------------------------------------------------------------------------

const initialState = {
  // Upload gate — false until the user uploads (or selects the test file) on the upload screen.
  // The map and all bootstrap calls are blocked until this is true.
  fileUploaded: false,
  eventSummary: null,   // { tipo, fecha, hora_inicio, comensales, staff_count } from /upload-excel

  // Step 1 — Excel data (loaded automatically on mount)
  excelData: null,

  // Step 2 — Frescos (triggered by user answering van availability question)
  frescosResult: null,
  secondMinifleteResult: null,

  // Step 3 — Remaining pool and personal vehicle detection
  remainingPool: null,
  personalVehicle: null,

  // Step 4 — Geocoded staff and nearest meeting point
  staffWithCoords: null,
  meetingPoint: null,

  // Event venue coordinates — derived either from an existing route polyline
  // or from the Google Geocoding API.  Kept in global state so AppMap can
  // include the venue in the auto-fit bounds without prop-drilling.
  eventCoords: null,

  // Step 5 — Driver routes and PEA evaluation
  driverRoutes: null,
  peaEvaluation: null,

  // Step 6 — User choices (set via map interactions, not API calls)
  chosenMeetingPoint: null,

  // ── NEW: vehicles array (step 3+) ─────────────────────────────────────────
  // Initialized by INIT_VEHICLES when the user enters step 3.
  // Each element is a vehicle object (see factory above).
  vehicles: [],

  // Single employee who could not be assigned to any vehicle and whose
  // transport will be coordinated separately.  Top-level, not per vehicle.
  pending_employee: null,

  // ── LEGACY: kept so existing components reading these fields don't crash ──
  // These are no longer written by any reducer case; new code uses vehicles.
  // Will be removed once all UI components are migrated to the vehicles model.
  assignments: null,
  uberMeetingPointOverrides: {},
  uberPeEditMode: null,
  uberPeDragMode: null,
  originalDriverRoutes: null,

  // Step 3 UI — result of an on-demand /find-pickup call.
  // Kept in global state so both StaffMarkers (trigger) and
  // PickupResultPanel (display) can access it without prop drilling.
  // Shape: { employeeName: string, result: object } or null.
  activePickupResult: null,

  // Step 4 — Final output blocks (set by POST /final-output on confirm)
  finalOutput: null,

  // Coordinate overrides — allows the user to reposition any employee marker
  // by dragging or re-geocoding their address.  Keys are "Nombre Apellido"
  // strings; values are { lat, lng, source } where source is "drag" | "address".
  // An empty object means no markers have been manually repositioned.
  coordinateOverrides: {},

  // Which employee is currently in marker-edit mode (drag + address input).
  // Only one marker is editable at a time — null when no edit is active.
  editingMarker: null,

  // UI state
  currentStep: 0,      // which step the user is currently on (0-indexed int; 0 = pre-frescos)
  stepHistory: [],     // stack of previous currentStep values; enables STEP_BACK
  loadingStep: null,   // string key of the in-flight step, or null when idle
  error: null,         // last error message surfaced to the user, or null
  showModal:        false,   // true when the step-4 ConfirmationModal is visible
  showOutput:       false,   // true when the two FinalOutputBlocks are visible
  manualPickupMode: false,   // true while the user is clicking the map to select a pickup point
  manualPeaMode:    false,   // true while the user is clicking the map to manually select a PEA

  // Snapshot of driverRoutes taken before the first pickup confirmation.
  // Kept as a legacy field (no longer written) — see originalDriverRoutes note above.
}

// ---------------------------------------------------------------------------
// Action types — named constants prevent typos and enable IDE autocomplete
// ---------------------------------------------------------------------------

export const ACTIONS = {
  // ── existing actions (unchanged) ─────────────────────────────────────────
  SET_EXCEL_DATA:            'SET_EXCEL_DATA',
  SET_FRESCOS_RESULT:        'SET_FRESCOS_RESULT',
  SET_SECOND_MINIFLETE:      'SET_SECOND_MINIFLETE',
  SET_REMAINING_POOL:        'SET_REMAINING_POOL',
  SET_PERSONAL_VEHICLE:      'SET_PERSONAL_VEHICLE',
  SET_STAFF_WITH_COORDS:     'SET_STAFF_WITH_COORDS',
  SET_MEETING_POINT:         'SET_MEETING_POINT',
  SET_DRIVER_ROUTES:         'SET_DRIVER_ROUTES',
  SET_PEA_EVALUATION:        'SET_PEA_EVALUATION',
  SET_EVENT_COORDS:          'SET_EVENT_COORDS',
  SET_CHOSEN_MEETING_POINT:  'SET_CHOSEN_MEETING_POINT',
  SET_ACTIVE_PICKUP_RESULT:  'SET_ACTIVE_PICKUP_RESULT',
  SET_FINAL_OUTPUT:          'SET_FINAL_OUTPUT',
  SET_SHOW_MODAL:            'SET_SHOW_MODAL',
  SET_SHOW_OUTPUT:           'SET_SHOW_OUTPUT',
  SET_COORDINATE_OVERRIDE:        'SET_COORDINATE_OVERRIDE',
  CLEAR_COORDINATE_OVERRIDE:      'CLEAR_COORDINATE_OVERRIDE',
  CLEAR_ALL_COORDINATE_OVERRIDES: 'CLEAR_ALL_COORDINATE_OVERRIDES',
  SET_EDITING_MARKER:             'SET_EDITING_MARKER',
  SET_MANUAL_PICKUP_MODE:    'SET_MANUAL_PICKUP_MODE',
  SET_MANUAL_PEA_MODE:       'SET_MANUAL_PEA_MODE',
  SET_FILE_UPLOADED:         'SET_FILE_UPLOADED',
  SET_CURRENT_STEP:          'SET_CURRENT_STEP',
  STEP_BACK:                 'STEP_BACK',
  SET_LOADING_STEP:          'SET_LOADING_STEP',
  SET_ERROR:                 'SET_ERROR',

  // ── legacy actions kept as no-ops so old components don't crash ──────────
  // These will be removed once UI components migrate to the vehicles model.
  SET_ASSIGNMENTS:            'SET_ASSIGNMENTS',
  ADD_PICKUP_PASSENGER:       'ADD_PICKUP_PASSENGER',
  REMOVE_PICKUP_PASSENGER:    'REMOVE_PICKUP_PASSENGER',
  SET_UBER_MEETING_POINT:     'SET_UBER_MEETING_POINT',
  CLEAR_UBER_MEETING_POINT:   'CLEAR_UBER_MEETING_POINT',
  SET_UBER_PE_EDIT_MODE:      'SET_UBER_PE_EDIT_MODE',
  SET_UBER_PE_DRAG_MODE:      'SET_UBER_PE_DRAG_MODE',
  SET_ORIGINAL_DRIVER_ROUTES:     'SET_ORIGINAL_DRIVER_ROUTES',
  RESTORE_ORIGINAL_DRIVER_ROUTES: 'RESTORE_ORIGINAL_DRIVER_ROUTES',

  // ── new vehicles-model actions ────────────────────────────────────────────
  INIT_VEHICLES:              'INIT_VEHICLES',
  ASSIGN_TO_PE:               'ASSIGN_TO_PE',
  ASSIGN_TO_PICKUP:           'ASSIGN_TO_PICKUP',
  UNASSIGN_EMPLOYEE:          'UNASSIGN_EMPLOYEE',
  SET_VEHICLE_ROUTE:          'SET_VEHICLE_ROUTE',
  SET_VEHICLE_MEETING_POINT:  'SET_VEHICLE_MEETING_POINT',
  RESET_VEHICLE_MEETING_POINT: 'RESET_VEHICLE_MEETING_POINT',
  SET_VEHICLE_PICKUP_POINT:   'SET_VEHICLE_PICKUP_POINT',
  CLEAR_VEHICLE_PICKUP:       'CLEAR_VEHICLE_PICKUP',
  SET_PENDING_EMPLOYEE:       'SET_PENDING_EMPLOYEE',
  RESET_ALL_VEHICLES:         'RESET_ALL_VEHICLES',
}

// ---------------------------------------------------------------------------
// Reducer — pure function: (state, action) → nextState
//
// Each case handles exactly one field (or a small related group).
// Using spread (...state) means every case only specifies what changed;
// unchanged fields carry over automatically.
// ---------------------------------------------------------------------------

function appReducer(state, action) {
  switch (action.type) {

    case ACTIONS.SET_FILE_UPLOADED:
      // payload: { uploaded: bool, summary: object | null }
      return {
        ...state,
        fileUploaded:  action.payload.uploaded,
        eventSummary:  action.payload.summary,
      }

    case ACTIONS.SET_EXCEL_DATA:
      return { ...state, excelData: action.payload }

    case ACTIONS.SET_FRESCOS_RESULT:
      return { ...state, frescosResult: action.payload }

    case ACTIONS.SET_SECOND_MINIFLETE:
      return { ...state, secondMinifleteResult: action.payload }

    case ACTIONS.SET_REMAINING_POOL:
      return { ...state, remainingPool: action.payload }

    case ACTIONS.SET_PERSONAL_VEHICLE:
      return { ...state, personalVehicle: action.payload }

    case ACTIONS.SET_STAFF_WITH_COORDS:
      return { ...state, staffWithCoords: action.payload }

    case ACTIONS.SET_MEETING_POINT:
      return { ...state, meetingPoint: action.payload }

    case ACTIONS.SET_EVENT_COORDS:
      return { ...state, eventCoords: action.payload }

    case ACTIONS.SET_DRIVER_ROUTES:
      return { ...state, driverRoutes: action.payload }

    case ACTIONS.SET_PEA_EVALUATION:
      return { ...state, peaEvaluation: action.payload }

    case ACTIONS.SET_CHOSEN_MEETING_POINT:
      return { ...state, chosenMeetingPoint: action.payload }

    case ACTIONS.SET_ACTIVE_PICKUP_RESULT:
      return { ...state, activePickupResult: action.payload }

    case ACTIONS.SET_FINAL_OUTPUT:
      return { ...state, finalOutput: action.payload }

    case ACTIONS.SET_SHOW_MODAL:
      return { ...state, showModal: action.payload }

    case ACTIONS.SET_SHOW_OUTPUT:
      return { ...state, showOutput: action.payload }

    case ACTIONS.SET_MANUAL_PICKUP_MODE:
      return { ...state, manualPickupMode: action.payload }

    case ACTIONS.SET_MANUAL_PEA_MODE:
      return { ...state, manualPeaMode: action.payload }

    // ── legacy no-ops ─────────────────────────────────────────────────────
    // Old components may still dispatch these. Returning state unchanged
    // prevents crashes without altering the vehicles-model state.
    case ACTIONS.SET_ASSIGNMENTS:
    case ACTIONS.ADD_PICKUP_PASSENGER:
    case ACTIONS.REMOVE_PICKUP_PASSENGER:
    case ACTIONS.SET_UBER_MEETING_POINT:
    case ACTIONS.CLEAR_UBER_MEETING_POINT:
    case ACTIONS.SET_UBER_PE_EDIT_MODE:
    case ACTIONS.SET_UBER_PE_DRAG_MODE:
    case ACTIONS.SET_ORIGINAL_DRIVER_ROUTES:
    case ACTIONS.RESTORE_ORIGINAL_DRIVER_ROUTES:
      return state

    // ── vehicles model ────────────────────────────────────────────────────

    case ACTIONS.INIT_VEHICLES: {
      // payload: { pool_count, has_personal_vehicle, driver, vehicle_description, chosenMeetingPoint }
      const { pool_count, has_personal_vehicle, driver, vehicle_description, chosenMeetingPoint } = action.payload
      const newVehicles = []

      let remaining = pool_count

      if (has_personal_vehicle) {
        newVehicles.push(_buildVehicle(
          'personal', 'personal', driver, vehicle_description, chosenMeetingPoint, 5, VEHICLE_COLORS.personal,
        ))
        remaining = pool_count - 1  // driver already consumes one slot
      }

      if (remaining > 0) {
        const uberCount = Math.ceil(remaining / 4)
        for (let i = 1; i <= uberCount; i++) {
          const colorKey = `uber_${i}`
          newVehicles.push(_buildVehicle(
            `uber_${i}`, 'uber', null, null, chosenMeetingPoint, 4,
            VEHICLE_COLORS[colorKey] ?? VEHICLE_COLORS.uber_1,
          ))
        }
      }

      return { ...state, vehicles: newVehicles }
    }

    case ACTIONS.ASSIGN_TO_PE: {
      // payload: { employee_name, vehicle_id }
      const { employee_name, vehicle_id } = action.payload
      return {
        ...state,
        vehicles: state.vehicles.map(v => {
          if (v.id !== vehicle_id) return v
          const maxPassengers = v.capacity - (v.type === 'personal' ? 1 : 0)
          if (v.passengers_pe.length + v.pickup.passengers.length >= maxPassengers) return v
          return { ...v, passengers_pe: [...v.passengers_pe, employee_name] }
        }),
      }
    }

    case ACTIONS.ASSIGN_TO_PICKUP: {
      // payload: { employee_name, vehicle_id }
      const { employee_name, vehicle_id } = action.payload
      return {
        ...state,
        vehicles: state.vehicles.map(v => {
          if (v.id !== vehicle_id) return v
          const maxPassengers = v.capacity - (v.type === 'personal' ? 1 : 0)
          if (v.passengers_pe.length + v.pickup.passengers.length >= maxPassengers) return v
          return { ...v, pickup: { ...v.pickup, passengers: [...v.pickup.passengers, employee_name] } }
        }),
      }
    }

    case ACTIONS.UNASSIGN_EMPLOYEE: {
      // payload: { employee_name } — removes from whichever vehicle/slot holds them.
      const { employee_name } = action.payload
      return {
        ...state,
        vehicles: state.vehicles.map(v => ({
          ...v,
          passengers_pe: v.passengers_pe.filter(n => n !== employee_name),
          pickup: { ...v.pickup, passengers: v.pickup.passengers.filter(n => n !== employee_name) },
        })),
      }
    }

    case ACTIONS.SET_VEHICLE_ROUTE: {
      // payload: { vehicle_id, route }
      const { vehicle_id, route } = action.payload
      return {
        ...state,
        vehicles: state.vehicles.map(v => v.id !== vehicle_id ? v : { ...v, route }),
      }
    }

    case ACTIONS.SET_VEHICLE_MEETING_POINT: {
      // payload: { vehicle_id, meeting_point }
      const { vehicle_id, meeting_point } = action.payload
      return {
        ...state,
        vehicles: state.vehicles.map(v =>
          v.id !== vehicle_id ? v : { ...v, meeting_point, custom_meeting_point: true },
        ),
      }
    }

    case ACTIONS.RESET_VEHICLE_MEETING_POINT: {
      // payload: { vehicle_id } — reverts to the global chosenMeetingPoint and clears route.
      const { vehicle_id } = action.payload
      return {
        ...state,
        vehicles: state.vehicles.map(v =>
          v.id !== vehicle_id ? v :
          { ...v, meeting_point: state.chosenMeetingPoint, custom_meeting_point: false, route: null },
        ),
      }
    }

    case ACTIONS.SET_VEHICLE_PICKUP_POINT: {
      // payload: { vehicle_id, point }
      const { vehicle_id, point } = action.payload
      return {
        ...state,
        vehicles: state.vehicles.map(v =>
          v.id !== vehicle_id ? v : { ...v, pickup: { ...v.pickup, point } },
        ),
      }
    }

    case ACTIONS.CLEAR_VEHICLE_PICKUP: {
      // payload: { vehicle_id } — removes pickup point, passengers, and the modified route.
      const { vehicle_id } = action.payload
      return {
        ...state,
        vehicles: state.vehicles.map(v =>
          v.id !== vehicle_id ? v :
          { ...v, pickup: { point: null, passengers: [] }, route: null },
        ),
      }
    }

    case ACTIONS.SET_PENDING_EMPLOYEE:
      // payload: { name } | null
      return { ...state, pending_employee: action.payload?.name ?? null }

    case ACTIONS.RESET_ALL_VEHICLES:
      // Clears all assignments and routes while preserving vehicle structure
      // (same vehicles, same types, same driver).  Meeting points reset to
      // the global chosenMeetingPoint.
      return {
        ...state,
        pending_employee: null,
        vehicles: state.vehicles.map(v => ({
          ...v,
          passengers_pe:        [],
          pickup:               { point: null, passengers: [] },
          route:                null,
          meeting_point:        state.chosenMeetingPoint,
          custom_meeting_point: false,
        })),
      }

    // ── navigation ────────────────────────────────────────────────────────

    case ACTIONS.SET_CURRENT_STEP:
      // Push the current step onto the history stack before advancing.
      // This lets STEP_BACK pop it to undo the transition.
      return {
        ...state,
        stepHistory: [...state.stepHistory, state.currentStep],
        currentStep: action.payload,
      }

    case ACTIONS.STEP_BACK: {
      if (state.stepHistory.length === 0) return state

      const newHistory   = state.stepHistory.slice(0, -1)
      const previousStep = state.stepHistory[state.stepHistory.length - 1]

      // Clear state that was populated DURING the step being undone.
      // The clearing set is keyed on the step we are LEAVING.
      const clearing = { error: null, loadingStep: null }

      if (state.currentStep >= 4) {
        // Leaving step 4 → step 3: undo confirmation and final output.
        Object.assign(clearing, { showModal: false, showOutput: false, finalOutput: null })
      } else if (state.currentStep >= 3) {
        // Leaving step 3 → step 2: undo all vehicle assignments.  Clearing
        // vehicles[] discards per-vehicle routes, pickups, and meeting point
        // overrides in one shot — no need for a separate originalDriverRoutes
        // snapshot since driverRoutes (set in step 2) is untouched.
        Object.assign(clearing, {
          vehicles: [],
          pending_employee: null,
          activePickupResult: null,
          chosenMeetingPoint: null,
          manualPickupMode: false,
        })
      } else if (state.currentStep >= 2) {
        // Leaving step 2 → step 1: undo routes, PEA evaluation, and meeting
        // point data so useStepTwo will recompute them if user re-advances.
        Object.assign(clearing, {
          meetingPoint: null,
          driverRoutes: null,
          peaEvaluation: null,
          chosenMeetingPoint: null,
          manualPeaMode: false,
        })
      } else if (state.currentStep >= 1) {
        // Leaving step 1 → step 0: undo the "van question" (frescos panel).
        // Clears the four slices that were set when the user answered it.
        Object.assign(clearing, {
          frescosResult: null,
          secondMinifleteResult: null,
          remainingPool: null,
          personalVehicle: null,
        })
      }

      return { ...state, ...clearing, stepHistory: newHistory, currentStep: previousStep }
    }

    // ── coordinate overrides ───────────────────────────────────────────────

    case ACTIONS.SET_COORDINATE_OVERRIDE: {
      // Spread the existing overrides and upsert the new entry so that
      // other employees' overrides are preserved across individual edits.
      const { name, lat, lng, source } = action.payload
      return {
        ...state,
        coordinateOverrides: { ...state.coordinateOverrides, [name]: { lat, lng, source } },
      }
    }

    case ACTIONS.CLEAR_COORDINATE_OVERRIDE: {
      // Delete only this employee's override — leave all others untouched.
      const next = { ...state.coordinateOverrides }
      delete next[action.payload.name]
      return { ...state, coordinateOverrides: next }
    }

    case ACTIONS.CLEAR_ALL_COORDINATE_OVERRIDES:
      return { ...state, coordinateOverrides: {} }

    case ACTIONS.SET_EDITING_MARKER:
      return { ...state, editingMarker: action.payload }

    case ACTIONS.SET_LOADING_STEP:
      return { ...state, loadingStep: action.payload }

    case ACTIONS.SET_ERROR:
      // Setting an error also clears loadingStep so spinners don't hang
      // when a request fails mid-flight.
      return { ...state, error: action.payload, loadingStep: null }

    default:
      // Unknown action types are a programmer error; surface them loudly
      // in development rather than silently returning stale state.
      if (import.meta.env.DEV) {
        console.warn('[appReducer] Unknown action type:', action.type)
      }
      return state
  }
}

// ---------------------------------------------------------------------------
// Context — two separate contexts following the "split context" pattern.
//
// Why two contexts (state vs dispatch)?
//   A component that only dispatches actions (e.g. a button) does not need
//   to re-render when state changes — it only needs the stable dispatch
//   function.  If dispatch and state lived in the same context, every
//   dispatch-only component would re-render on every state change.
//   Splitting them lets components subscribe to only what they need.
// ---------------------------------------------------------------------------

export const AppStateContext    = createContext(null)
export const AppDispatchContext = createContext(null)

// ---------------------------------------------------------------------------
// Provider — renders once at the app root; children access state and
// dispatch via the two contexts without prop drilling.
// ---------------------------------------------------------------------------

export function AppStateProvider({ children }) {
  const [state, dispatch] = useReducer(appReducer, initialState)

  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        {children}
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// Custom hook — convenience wrapper used by every component that needs state.
//
// Returns { state, dispatch } so callers can destructure only what they need:
//   const { state } = useAppState()              // state only
//   const { dispatch } = useAppState()           // dispatch only
//   const { state, dispatch } = useAppState()    // both
// ---------------------------------------------------------------------------

export function useAppState() {
  const state    = useContext(AppStateContext)
  const dispatch = useContext(AppDispatchContext)

  if (state === null || dispatch === null) {
    throw new Error('useAppState() must be used inside <AppStateProvider>.')
  }

  return { state, dispatch }
}

// ---------------------------------------------------------------------------
// Helper selectors — pure functions over state; no side effects.
// Export these so components don't duplicate the traversal logic.
// ---------------------------------------------------------------------------

/** Returns the vehicle with the given id, or null if not found. */
export function getVehicleById(state, id) {
  return state.vehicles.find(v => v.id === id) ?? null
}

/**
 * Returns a Set of all employee names currently assigned to any vehicle
 * (passengers_pe + pickup.passengers across all vehicles).
 * Does not include drivers — they are pre-assigned at INIT_VEHICLES time.
 */
export function getAssignedEmployees(state) {
  const names = new Set()
  for (const v of state.vehicles) {
    for (const n of v.passengers_pe)       names.add(n)
    for (const n of v.pickup.passengers)   names.add(n)
  }
  return names
}

/**
 * Returns the pool members who are not yet assigned to any vehicle.
 * Returns [] if remainingPool is not populated yet (pre-step-3).
 */
export function getUnassignedEmployees(state) {
  if (!state.remainingPool) return []
  const assigned = getAssignedEmployees(state)
  return state.remainingPool.filter(emp => {
    const name = `${emp.Nombre} ${emp.Apellido}`
    return !assigned.has(name)
  })
}

/**
 * True when the vehicle has no remaining passenger capacity.
 * Personal vehicle: capacity 5, driver occupies 1 → 4 passenger slots.
 * Uber vehicle: capacity 4 → 4 passenger slots.
 */
export function isVehicleFull(vehicle) {
  const maxPassengers = vehicle.capacity - (vehicle.type === 'personal' ? 1 : 0)
  return vehicle.passengers_pe.length + vehicle.pickup.passengers.length >= maxPassengers
}

/**
 * Checks whether the current vehicle state is ready for final validation.
 * Returns { valid: boolean, reasons: string[] }.
 *
 * Rules:
 *   1. All pool employees must be assigned (or tracked as pending_employee).
 *   2. Every vehicle that has passengers must have a route.
 *   3. If any Uber vehicle exists, the personal vehicle must be full first.
 */
export function canValidate(state) {
  const reasons = []

  const unassigned = getUnassignedEmployees(state)
  // pending_employee is accounted for — subtract them if present
  const effectivelyUnassigned = state.pending_employee
    ? unassigned.filter(emp => `${emp.Nombre} ${emp.Apellido}` !== state.pending_employee)
    : unassigned
  if (effectivelyUnassigned.length > 0) {
    reasons.push(`${effectivelyUnassigned.length} empleado(s) sin asignar`)
  }

  for (const v of state.vehicles) {
    const hasPassengers = v.passengers_pe.length > 0 || v.pickup.passengers.length > 0
    if (hasPassengers && !v.route) {
      reasons.push(`Vehículo ${v.id} tiene pasajeros pero no tiene ruta`)
    }
  }

  const hasUber     = state.vehicles.some(v => v.type === 'uber')
  const personal    = state.vehicles.find(v => v.type === 'personal')
  if (hasUber && personal && !isVehicleFull(personal)) {
    reasons.push('El vehículo personal debe estar lleno antes de usar Ubers')
  }

  return { valid: reasons.length === 0, reasons }
}
