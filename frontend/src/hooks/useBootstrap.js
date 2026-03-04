/**
 * hooks/useBootstrap.js
 * Runs once on app mount to load the Excel data from the FastAPI backend.
 *
 * ── Why only readExcel() runs automatically ───────────────────────────────────
 * Every step after Step 1 requires a decision or input from the user before
 * it can be called:
 *
 *   Step 2 (frescos):      user must answer "is the company van available?"
 *   Step 3 (pool):         depends on which roles were assigned in Step 2
 *   Step 4 (geocoding):    can be triggered eagerly, but needs Step 2 first
 *                          to know the driver (detect-personal-vehicle)
 *   Step 5 (PEA):          long-running; only called when user is ready
 *   Steps 6–7 (pickup,     all require the user to interact with the map
 *   assignments, output):  and confirm choices step by step
 *
 * Auto-triggering any of these would either call the API with missing inputs
 * (producing 422 errors) or make expensive calls the user never asked for.
 * readExcel() is the only call that is always needed, always safe to make
 * immediately, and has no prerequisites.
 *
 * ── How to use ────────────────────────────────────────────────────────────────
 *   const { isLoading, error } = useBootstrap()
 *
 *   The hook manages state via dispatch — callers only need the returned
 *   { isLoading, error } to decide what to render.
 */

import { useEffect } from 'react'
import { useAppState, ACTIONS } from '../state/appState'
import { readExcel } from '../api/endpoints'

export function useBootstrap() {
  const { state, dispatch } = useAppState()

  useEffect(() => {
    // useEffect with an empty dependency array runs exactly once after the
    // initial render — the React equivalent of componentDidMount.
    // We do not include dispatch in deps because dispatch is guaranteed
    // stable by useReducer (same reference across renders).
    let cancelled = false   // guard against setting state on an unmounted component

    async function loadExcel() {
      dispatch({ type: ACTIONS.SET_LOADING_STEP, payload: 'excel' })
      dispatch({ type: ACTIONS.SET_ERROR,        payload: null })

      try {
        const data = await readExcel()

        // Only update state if the component is still mounted.
        // (Unlikely for a root-level bootstrap, but correct practice.)
        if (!cancelled) {
          dispatch({ type: ACTIONS.SET_EXCEL_DATA,    payload: data })
          dispatch({ type: ACTIONS.SET_LOADING_STEP,  payload: null })
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err?.response?.data?.detail ??
            err?.message ??
            'Error desconocido al cargar los datos del evento.'
          dispatch({ type: ACTIONS.SET_ERROR, payload: message })
          // SET_ERROR also clears loadingStep (see reducer), so no
          // separate SET_LOADING_STEP(null) call is needed here.
        }
      }
    }

    loadExcel()

    return () => {
      cancelled = true
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    isLoading: state.loadingStep === 'excel',
    error:     state.error,
  }
}
