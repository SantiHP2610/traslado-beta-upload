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
          dispatch({ type: ACTIONS.SET_MEETING_POINT,      payload: allPoints.recommended })
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

        // ── Phase 2: compute base route (home → PE → event) ───────────────────
        // and direct route (home → event, used for PEA and pickup evaluation).
        // Both routes are returned as encoded polylines + duration/distance.
        // Pass any existing driver coordinate override so the first render
        // already uses the corrected position if the user moved the pin in step 1.
        dispatch({ type: ACTIONS.SET_LOADING_STEP, payload: 'routes' })

        const overrideLat = driverOverride?.lat ?? null
        const overrideLng = driverOverride?.lng ?? null
        const driverRoutes = await calculateDriverRoute(overrideLat, overrideLng)
        if (cancelled) return
        dispatch({ type: ACTIONS.SET_DRIVER_ROUTES, payload: driverRoutes })

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

  // ── Effect 2: re-run routes + PEA when the driver's effective position changes ─
  // Deps are effectiveLat/effectiveLng, not the raw override, so this fires for
  // BOTH cases:
  //   • Override SET   (drag / address geocode) → effective coords change to new value
  //   • Override CLEARED ("Volver a ubicación original") → effective coords change
  //     back to the original geocoded position
  // Using only driverOverride?.lat/lng as deps would miss the clear case because
  // the guard "!driverOverride" would return early after the dep changed.
  //
  // The effect is a no-op on initial mount (currentStep !== 2) and does not
  // duplicate Effect 1's work — Effect 1 handles the 1→2 transition; this effect
  // only fires on subsequent coordinate changes while already in step 2.
  //
  // nearestMeetingPoint is NOT re-called: it depends on the event venue, not driver.
  useEffect(() => {
    if (
      state.currentStep !== 2 ||
      state.chosenMeetingPoint ||
      !state.personalVehicle?.has_personal_vehicle ||
      effectiveLat == null ||
      effectiveLng == null
    ) return

    let cancelled = false

    async function rerunRoutesAndPea() {
      dispatch({ type: ACTIONS.SET_ERROR, payload: null })

      try {
        dispatch({ type: ACTIONS.SET_LOADING_STEP, payload: 'routes' })

        const driverRoutes = await calculateDriverRoute(effectiveLat, effectiveLng)
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
}
