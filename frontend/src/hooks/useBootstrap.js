/**
 * hooks/useBootstrap.js
 * Runs once on app mount to load Excel data and geocode all staff.
 *
 * ── Why these two steps run automatically ────────────────────────────────────
 * readExcel() and geocodeStaff() are the only two calls that are always
 * needed, always safe to make immediately, and have no prerequisites:
 *
 *   readExcel():     The entire app depends on the event data.  Nothing
 *                    can happen — not even showing the van question — until
 *                    we know the staff list, the event address, and the
 *                    services.  This must be the very first call.
 *
 *   geocodeStaff():  Once the staff list exists we can resolve every
 *                    employee's home address to lat/lng coordinates.  This
 *                    is needed for the map markers AND as a prerequisite for
 *                    the PEA and pickup evaluations later.  Running it here
 *                    means the markers appear on the map before the user has
 *                    to do anything, giving immediate spatial context.
 *
 * Every subsequent step requires user input first:
 *
 *   Step 2 (frescos):      user must answer "is the company van available?"
 *   Step 3 (pool):         depends on which roles were assigned in Step 2
 *   Step 5 (PEA):          long-running; only called when user is ready
 *   Steps 6–7 (pickup,     require the user to interact with the map
 *   assignments, output):  and confirm choices step by step
 *
 * ── loadingStep values ────────────────────────────────────────────────────────
 *   "excel"     → reading and parsing the Excel file
 *   "geocoding" → resolving staff addresses via the Geocoding API
 *   null        → idle (either done or not yet started)
 *
 * ── How to use ────────────────────────────────────────────────────────────────
 *   const { isLoading, error } = useBootstrap()
 *
 *   isLoading is true during either the excel or geocoding phase.
 *   The caller can read state.loadingStep directly to show a phase-specific
 *   message; isLoading is the simple boolean gate for conditional rendering.
 */

import { useEffect } from 'react'
import { useAppState, ACTIONS } from '../state/appState'
import { readExcel, geocodeStaff } from '../api/endpoints'

export function useBootstrap() {
  const { state, dispatch } = useAppState()

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      // ── Phase 1: read Excel ────────────────────────────────────────────────
      dispatch({ type: ACTIONS.SET_LOADING_STEP, payload: 'excel' })
      dispatch({ type: ACTIONS.SET_ERROR,        payload: null })

      let excelData
      try {
        excelData = await readExcel()
        if (cancelled) return
        dispatch({ type: ACTIONS.SET_EXCEL_DATA, payload: excelData })
      } catch (err) {
        if (!cancelled) {
          dispatch({
            type:    ACTIONS.SET_ERROR,
            payload: err?.response?.data?.detail ??
                     err?.message ??
                     'Error desconocido al cargar los datos del evento.',
          })
        }
        return  // abort — no point geocoding without staff data
      }

      // ── Phase 2: geocode staff ─────────────────────────────────────────────
      // geocodeStaff() reads the Excel file on the backend and returns the
      // same staff list enriched with a "coordinates" key on each employee.
      // It does not need excelData as a parameter — the backend re-reads the
      // file.  We still run it in sequence (not in parallel with readExcel)
      // to keep the loading phases distinct and the error handling simple.
      dispatch({ type: ACTIONS.SET_LOADING_STEP, payload: 'geocoding' })

      try {
        const staffWithCoords = await geocodeStaff()
        if (cancelled) return
        dispatch({ type: ACTIONS.SET_STAFF_WITH_COORDS, payload: staffWithCoords })
        dispatch({ type: ACTIONS.SET_LOADING_STEP,      payload: null })
      } catch (err) {
        if (!cancelled) {
          dispatch({
            type:    ACTIONS.SET_ERROR,
            payload: err?.response?.data?.detail ??
                     err?.message ??
                     'Error desconocido al geolocalizar el personal.',
          })
        }
      }
    }

    bootstrap()

    return () => {
      cancelled = true
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    // isLoading is true during either loading phase, so AppShell shows a
    // spinner for the full boot sequence, not just the first call.
    isLoading: state.loadingStep === 'excel' || state.loadingStep === 'geocoding',
    error:     state.error,
  }
}
