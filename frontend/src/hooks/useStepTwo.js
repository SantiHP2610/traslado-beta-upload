/**
 * hooks/useStepTwo.js
 * Runs automatically when state.currentStep advances to 2.
 * Computes the nearest meeting point, driver routes, and PEA evaluation.
 *
 * ── Why this runs automatically (no user trigger) ────────────────────────────
 * Everything computed here is deterministic: the meeting point is the PE
 * closest to the event venue (a Distance Matrix query), the driver routes are
 * the fixed home→PE→event and home→event paths (Routes API), and the PEA
 * candidates are places along that direct route (Places + Distance Matrix).
 * None of these require user input — they only require the frescos step to
 * have completed so that `remainingPool` is populated for the PEA evaluation.
 * Running them automatically the moment step 2 starts mirrors the same pattern
 * used by `useBootstrap` for the Excel + geocoding phases.
 *
 * ── Why useEffect watches currentStep ────────────────────────────────────────
 * Step 2 is entered by `FrescosPanel` dispatching SET_CURRENT_STEP 2 after all
 * step-1 calls succeed.  Watching that state transition is the cleanest trigger:
 * it ensures the hook only runs once (on the 1→2 transition), and it does not
 * need to know anything about how step 1 is implemented.
 *
 * ── Two paths through step 2 ─────────────────────────────────────────────────
 * Personal vehicle present:
 *   1. nearestMeetingPoint()   → SET_MEETING_POINT
 *   2. calculateDriverRoute()  → SET_DRIVER_ROUTES   (base + direct polylines)
 *   3. evaluatePea()           → SET_PEA_EVALUATION  (up to 3 ranked candidates)
 *   User must then choose PE or a PEA candidate on the map before step 3.
 *
 * No personal vehicle (Uber-only):
 *   1. nearestMeetingPoint()   → SET_MEETING_POINT
 *   The PE is the only option — Uber always meets at the original PE.
 *   No driver route and no PEA alternatives exist without a driver to route.
 *   SET_CHOSEN_MEETING_POINT is set to the PE automatically.
 *   SET_CURRENT_STEP 3 is dispatched immediately — no map interaction needed.
 *
 * ── Why the Uber-only path skips step 2 UI entirely ─────────────────────────
 * The entire purpose of the step-2 map interaction is for the user to choose
 * between the original PE and a PEA alternative for the personal car driver.
 * If there is no personal car, there is no driver route to show, no PEA to
 * evaluate, and no choice to make.  Advancing to step 3 automatically keeps
 * the flow unblocked while setting chosenMeetingPoint to the PE so that
 * subsequent passenger-assignment logic always has a valid meeting point.
 *
 * ── Driver coordinate override re-calculation ────────────────────────────────
 * When the user drags the driver's marker or geocodes a new address in step 2
 * (before a meeting point is chosen), the routes and PEA must be re-computed
 * from the new driver origin.  A second useEffect watches the driver's
 * *effective* lat/lng — which is the override if set, or the original geocoded
 * position from staffWithCoords otherwise.  Using effective coords means the
 * effect fires for BOTH setting an override AND clearing one ("Volver a
 * ubicación original"), so routes always reflect the driver's current position.
 * The coords are passed to the backend as optional query params so the backend
 * skips its own geocoding and uses them directly.
 * nearestMeetingPoint is NOT re-called: it depends on the event venue only.
 *
 * ── Loading phases ────────────────────────────────────────────────────────────
 * "meeting_point" → computing nearest PE via Distance Matrix
 * "routes"        → computing driver routes via Routes API
 * "pea"           → evaluating PEA candidates via Places + Distance Matrix
 * null            → all done (or uber-only path completed)
 */

import { useEffect } from 'react'
import { useAppState, ACTIONS } from '../state/appState'
import {
  nearestMeetingPoint,
  calculateDriverRoute,
  evaluatePea,
} from '../api/endpoints'

export function useStepTwo() {
  const { state, dispatch } = useAppState()

  // Whether the event venue is in CABA — staff typically commutes independently.
  const isCaba = !!state.excelData?.event?.is_caba

  // Derive driver identity and coordinates here so both effects can reference
  // stable primitives in their dependency arrays.
  const driver     = state.personalVehicle?.driver
  const driverName = driver ? `${driver.Nombre} ${driver.Apellido}` : null

  const driverOverride = driverName
    ? state.coordinateOverrides?.[driverName]
    : null

  // Original geocoded coords from the bootstrap staffWithCoords list.
  // Used as the fallback when no override exists so that clearing an override
  // also changes the effective lat/lng and triggers a recalculation.
  const driverOriginalCoords = driverName
    ? state.staffWithCoords?.find((e) => `${e.Nombre} ${e.Apellido}` === driverName)?.coordinates
    : null

  // Effective coords: override takes precedence; fall back to original geocoded
  // position.  These are the values Effect 2 tracks and passes to the API.
  const effectiveLat = driverOverride?.lat ?? driverOriginalCoords?.lat ?? null
  const effectiveLng = driverOverride?.lng ?? driverOriginalCoords?.lng ?? null

  // ── Effect 1: initial step 2 computation (1→2 transition) ──────────────────
  // Also re-fires when cabaDecisionToTransport changes (false → true) so the
  // CABA path can fetch all meeting points once the manager decides to transport.
  useEffect(() => {
    // Only fire on step 2 with a populated personalVehicle.
    if (state.currentStep !== 2 || !state.personalVehicle) return

    // Charter mode handles step 2 entirely in CharterPeSelectionSection —
    // it fetches all PEs itself and lets the manager choose before advancing.
    // Running this effect for charter would auto-set chosenMeetingPoint before
    // the user picks a PE, breaking the PE selection flow.
    if (state.charterMode) return

    // CABA gate: if the event is in CABA and the manager hasn't yet decided to
    // plan transport, show CabaPanel and do nothing here.  The effect will re-fire
    // when cabaDecisionToTransport is set to true (dep array includes it).
    if (isCaba && !state.cabaDecisionToTransport) return

    let cancelled = false

    async function runStepTwo() {
      dispatch({ type: ACTIONS.SET_ERROR, payload: null })

      try {
        // ── CABA transport path ────────────────────────────────────────────────
        // Fetch all 3 PEs so CabaPeSelectionPanel can display them.
        // Skip driver routes and PEA — for CABA the manager picks a PE directly;
        // no route optimisation is needed at this stage.
        if (isCaba && state.cabaDecisionToTransport) {
          dispatch({ type: ACTIONS.SET_LOADING_STEP, payload: 'meeting_point' })
          const allPoints = await nearestMeetingPoint(true)
          if (cancelled) return
          dispatch({ type: ACTIONS.SET_ALL_MEETING_POINTS, payload: allPoints })
          dispatch({ type: ACTIONS.SET_LOADING_STEP,       payload: null })
          return
        }

        // ── Phase 1: find the nearest predefined meeting point (PE) ────────────
        // This call is always made regardless of vehicle availability.
        // Even in the Uber-only path, we need the PE to set chosenMeetingPoint.
        dispatch({ type: ACTIONS.SET_LOADING_STEP, payload: 'meeting_point' })

        const meetingPoint = await nearestMeetingPoint()
        if (cancelled) return
        dispatch({ type: ACTIONS.SET_MEETING_POINT, payload: meetingPoint })

        // ── Uber-only path ─────────────────────────────────────────────────────
        // If there is no personal vehicle there is no driver, no route to draw,
        // and no PEA to evaluate.  Uber vehicles always meet at the original PE —
        // this is an operational rule, not a dynamic choice.  We set the chosen
        // meeting point to the PE automatically and skip to step 3 immediately.
        if (!state.personalVehicle.has_personal_vehicle) {
          dispatch({ type: ACTIONS.SET_CHOSEN_MEETING_POINT, payload: meetingPoint })
          dispatch({ type: ACTIONS.SET_LOADING_STEP,         payload: null })
          // UberRoutesSection in Sidebar handles the step 2 → 3 advance once
          // all Uber routes have been traced.
          return
        }

        // ── Phase 2: compute base route (home → PE → event) and fetch all PEs ──
        // Routes: base (home→PE→event) + direct (home→event, for PEA + pickup).
        // All PEs: fetched in parallel so PeaPanel can render PE-switch cards
        // without adding latency — nearestMeetingPoint(true) costs one extra
        // Distance Matrix call but runs concurrently with the Routes API call.
        dispatch({ type: ACTIONS.SET_LOADING_STEP, payload: 'routes' })

        const overrideLat = driverOverride?.lat ?? null
        const overrideLng = driverOverride?.lng ?? null
        const [driverRoutes, allPoints] = await Promise.all([
          calculateDriverRoute(overrideLat, overrideLng, meetingPoint.lat, meetingPoint.lng),
          nearestMeetingPoint(true),
        ])
        if (cancelled) return
        dispatch({ type: ACTIONS.SET_DRIVER_ROUTES,      payload: driverRoutes })
        dispatch({ type: ACTIONS.SET_ALL_MEETING_POINTS, payload: allPoints })

        // ── Phase 3: PEA evaluation ────────────────────────────────────────────
        dispatch({ type: ACTIONS.SET_LOADING_STEP, payload: 'pea' })

        const peaResult = await evaluatePea(overrideLat, overrideLng)
        if (cancelled) return
        dispatch({ type: ACTIONS.SET_PEA_EVALUATION, payload: peaResult.pea_evaluation })

        dispatch({ type: ACTIONS.SET_LOADING_STEP, payload: null })

      } catch (err) {
        if (!cancelled) {
          dispatch({
            type:    ACTIONS.SET_ERROR,
            payload: err?.response?.data?.detail ??
                     err?.message ??
                     'Error al calcular el punto de encuentro y las rutas.',
          })
          dispatch({ type: ACTIONS.SET_LOADING_STEP, payload: null })
        }
      }
    }

    runStepTwo()

    return () => {
      cancelled = true
    }
  }, [state.currentStep, state.cabaDecisionToTransport]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect 2: re-run routes when the driver's effective position changes ──────
  // Deps are effectiveLat/effectiveLng, not the raw override, so this fires for
  // BOTH cases:
  //   • Override SET   (drag / address geocode) → effective coords change to new value
  //   • Override CLEARED ("Volver a ubicación original") → effective coords change
  //     back to the original geocoded position
  // Using only driverOverride?.lat/lng as deps would miss the clear case because
  // the guard "!driverOverride" would return early after the dep changed.
  //
  // The effect fires in both step 2 and step 3 so the driver can edit their
  // address at any time and the map polyline stays in sync.
  //
  // nearestMeetingPoint is NOT re-called: it depends on the event venue, not driver.
  //
  // Two sub-paths:
  //   • No PE chosen yet (step 2 pre-confirm): recalculate routes + PEA candidates.
  //   • PE already chosen (step 2 post-confirm OR step 3): recalculate routes only,
  //     then also update the personal vehicle's active route so RoutePolylines
  //     reflects the new driver origin immediately.  PEA is not re-evaluated —
  //     candidates were shown before confirmation and are no longer displayed.
  useEffect(() => {
    if (
      (state.currentStep !== 2 && state.currentStep !== 3) ||
      !state.personalVehicle?.has_personal_vehicle ||
      effectiveLat == null ||
      effectiveLng == null
    ) return

    let cancelled = false

    async function rerunRoutesAndPea() {
      dispatch({ type: ACTIONS.SET_ERROR, payload: null })

      try {
        dispatch({ type: ACTIONS.SET_LOADING_STEP, payload: 'routes' })

        // Always use the original PE as the base-route waypoint.
        // chosenMeetingPoint may be a PEA (different coords from meetingPoint), but
        // calculateDriverRoute always builds base_route via the fixed PE waypoint and
        // direct_route as home→event — the choice between them is made below.
        const driverRoutes = await calculateDriverRoute(
          effectiveLat, effectiveLng,
          state.meetingPoint?.lat, state.meetingPoint?.lng,
        )
        if (cancelled) return
        dispatch({ type: ACTIONS.SET_DRIVER_ROUTES, payload: driverRoutes })

        // If a PE has already been confirmed, update the personal vehicle's route
        // so RoutePolylines draws the correct polyline from the new driver origin.
        if (state.chosenMeetingPoint) {
          const isPea = state.meetingPoint && (
            Math.abs(state.chosenMeetingPoint.lat - state.meetingPoint.lat) > 0.0001 ||
            Math.abs(state.chosenMeetingPoint.lng - state.meetingPoint.lng) > 0.0001
          )
          const vehicleRoute = isPea ? driverRoutes.direct_route : driverRoutes.base_route
          if (vehicleRoute) {
            dispatch({
              type:    ACTIONS.SET_VEHICLE_ROUTE,
              payload: { vehicle_id: 'personal', route: vehicleRoute },
            })
          }
          dispatch({ type: ACTIONS.SET_LOADING_STEP, payload: null })
          return
        }

        // Pre-confirm path: also re-evaluate PEA candidates with the new origin.
        dispatch({ type: ACTIONS.SET_LOADING_STEP, payload: 'pea' })

        const peaResult = await evaluatePea(effectiveLat, effectiveLng)
        if (cancelled) return
        dispatch({ type: ACTIONS.SET_PEA_EVALUATION, payload: peaResult.pea_evaluation })

        dispatch({ type: ACTIONS.SET_LOADING_STEP, payload: null })

      } catch (err) {
        if (!cancelled) {
          dispatch({
            type:    ACTIONS.SET_ERROR,
            payload: err?.response?.data?.detail ??
                     err?.message ??
                     'Error al recalcular rutas con la nueva posición del chofer.',
          })
          dispatch({ type: ACTIONS.SET_LOADING_STEP, payload: null })
        }
      }
    }

    rerunRoutesAndPea()

    return () => {
      cancelled = true
    }
  }, [effectiveLat, effectiveLng]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect 3: run driver routes + PEA after CABA PE selection ──────────────
  // Fires when state.meetingPoint changes.  For non-CABA this is a no-op
  // (isCaba guard returns early immediately).  For CABA it fires once when the
  // manager selects a PE from CabaPeSelectionPanel (meetingPoint null → chosen).
  // Computes the same routes and PEA that Effect 1 computes in the normal path,
  // using the user-selected PE instead of an auto-nearest one.
  //
  // Uber-only CABA: no route computation is possible without a driver; the
  // selected PE is automatically confirmed so the flow continues to step 2b.
  //
  // state.driverRoutes / state.chosenMeetingPoint guards prevent double-runs.
  useEffect(() => {
    if (!isCaba || !state.cabaDecisionToTransport) return
    if (!state.meetingPoint) return                              // PE not picked yet
    if (state.driverRoutes || state.chosenMeetingPoint) return  // already completed

    const hasPersonalVehicle = state.personalVehicle?.has_personal_vehicle

    // Uber-only path: no driver route exists; confirm the PE automatically.
    if (!hasPersonalVehicle) {
      dispatch({ type: ACTIONS.SET_CHOSEN_MEETING_POINT, payload: state.meetingPoint })
      return
    }

    let cancelled = false

    async function runCabaRoutes() {
      dispatch({ type: ACTIONS.SET_ERROR, payload: null })

      try {
        dispatch({ type: ACTIONS.SET_LOADING_STEP, payload: 'routes' })

        const driverRoutes = await calculateDriverRoute(effectiveLat, effectiveLng, state.meetingPoint.lat, state.meetingPoint.lng)
        if (cancelled) return
        dispatch({ type: ACTIONS.SET_DRIVER_ROUTES, payload: driverRoutes })

        dispatch({ type: ACTIONS.SET_LOADING_STEP, payload: 'pea' })

        const peaResult = await evaluatePea(effectiveLat, effectiveLng)
        if (cancelled) return
        dispatch({ type: ACTIONS.SET_PEA_EVALUATION, payload: peaResult.pea_evaluation })

        dispatch({ type: ACTIONS.SET_LOADING_STEP, payload: null })

      } catch (err) {
        if (!cancelled) {
          dispatch({
            type:    ACTIONS.SET_ERROR,
            payload: err?.response?.data?.detail ??
                     err?.message ??
                     'Error al calcular rutas del chofer.',
          })
          dispatch({ type: ACTIONS.SET_LOADING_STEP, payload: null })
        }
      }
    }

    runCabaRoutes()

    return () => { cancelled = true }
  }, [state.meetingPoint]) // eslint-disable-line react-hooks/exhaustive-deps
}
