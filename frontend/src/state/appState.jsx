/**
 * state/appState.js
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
 */

import { createContext, useContext, useReducer } from 'react'

// ---------------------------------------------------------------------------
// Initial state — mirrors the full app flow declared in CLAUDE.md
// ---------------------------------------------------------------------------

const initialState = {
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
  assignments: null,

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
  currentStep: 1,      // which step the user is currently on (1-indexed int)
  loadingStep: null,   // string key of the in-flight step, or null when idle
  error: null,         // last error message surfaced to the user, or null
  showModal:  false,   // true when the step-4 ConfirmationModal is visible
  showOutput: false,   // true when the two FinalOutputBlocks are visible
}

// ---------------------------------------------------------------------------
// Action types — named constants prevent typos and enable IDE autocomplete
// ---------------------------------------------------------------------------

export const ACTIONS = {
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
  SET_CHOSEN_MEETING_POINT:   'SET_CHOSEN_MEETING_POINT',
  SET_ASSIGNMENTS:            'SET_ASSIGNMENTS',
  SET_ACTIVE_PICKUP_RESULT:   'SET_ACTIVE_PICKUP_RESULT',
  SET_FINAL_OUTPUT:          'SET_FINAL_OUTPUT',
  SET_SHOW_MODAL:            'SET_SHOW_MODAL',
  SET_SHOW_OUTPUT:           'SET_SHOW_OUTPUT',
  SET_COORDINATE_OVERRIDE:        'SET_COORDINATE_OVERRIDE',
  CLEAR_COORDINATE_OVERRIDE:      'CLEAR_COORDINATE_OVERRIDE',
  CLEAR_ALL_COORDINATE_OVERRIDES: 'CLEAR_ALL_COORDINATE_OVERRIDES',
  SET_EDITING_MARKER:             'SET_EDITING_MARKER',
  SET_CURRENT_STEP:          'SET_CURRENT_STEP',
  SET_LOADING_STEP:          'SET_LOADING_STEP',
  SET_ERROR:                 'SET_ERROR',
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

    case ACTIONS.SET_ASSIGNMENTS:
      return { ...state, assignments: action.payload }

    case ACTIONS.SET_ACTIVE_PICKUP_RESULT:
      return { ...state, activePickupResult: action.payload }

    case ACTIONS.SET_FINAL_OUTPUT:
      return { ...state, finalOutput: action.payload }

    case ACTIONS.SET_SHOW_MODAL:
      return { ...state, showModal: action.payload }

    case ACTIONS.SET_SHOW_OUTPUT:
      return { ...state, showOutput: action.payload }

    case ACTIONS.SET_CURRENT_STEP:
      return { ...state, currentStep: action.payload }

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
