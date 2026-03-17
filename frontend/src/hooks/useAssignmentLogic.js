/**
 * hooks/useAssignmentLogic.js
 * Extracted assignment logic from AssignmentPanel — all local state, the
 * Phase-2 useEffect, and every handler live here.  Called from AppMap so
 * the same state instance is shared between UnassignedPanel (left) and
 * AssignmentSummaryPanel (right) without prop-drilling through a context.
 *
 * ── Why a hook, not a context ─────────────────────────────────────────────
 * A context would require an extra provider component and a consumer hook.
 * Since both panels are rendered by the same parent (AppMap), lifting the
 * hook call one level up to AppMap is the minimal-complexity option.
 * AppMap passes the returned values as props to each panel — clear, explicit,
 * and easy to trace in code review.
 *
 * ── Logic is IDENTICAL to the original AssignmentPanel ───────────────────
 * All state variables, the useEffect, and every handler are copied verbatim.
 * The only change is that they now live in a hook instead of a component.
 */

import { useState, useEffect }    from 'react'
import { useAppState, ACTIONS }   from '../state/appState'
import { validateAssignments }    from '../api/endpoints'

export const MAX_UBER = 4

// ---------------------------------------------------------------------------
// Pure helpers (shared with the panel components via this module's exports)
// ---------------------------------------------------------------------------

export function fullName(emp) {
  return `${emp.Nombre} ${emp.Apellido}`
}

export function chunkArray(arr, size) {
  const groups = []
  for (let i = 0; i < arr.length; i += size) {
    groups.push(arr.slice(i, i + size))
  }
  return groups
}

function deriveProfesiones(assignedNames, staff) {
  return assignedNames
    .map((name) => staff.find((emp) => fullName(emp) === name)?.Profesion)
    .filter(Boolean)
}

function buildAssignmentsInput(assignments) {
  return {
    driver:         assignments.driver ? fullName(assignments.driver) : '',
    car_passengers: (assignments.car_passengers ?? []).map(fullName),
    uber_groups:    chunkArray(assignments.uber_passengers ?? [], MAX_UBER).map(
      (group) => group.map(fullName),
    ),
    pickup_passengers: (assignments.pickup_passengers ?? []).map(fullName),
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAssignmentLogic() {
  const { state, dispatch } = useAppState()

  const [validating, setValidating]                     = useState(false)
  const [showSoloChoice, setShowSoloChoice]             = useState(false)
  const [pendingSolo, setPendingSolo]                   = useState(null)
  const [pendingAutoFillCheck, setPendingAutoFillCheck] = useState(false)

  const {
    assignments,
    remainingPool,
    personalVehicle,
    frescosResult,
    excelData,
  } = state

  const staff         = excelData?.staff ?? []
  const pool          = remainingPool?.remaining_pool ?? []
  const totalToAssign = pool.length

  const driver         = assignments?.driver
  const carPassengers  = assignments?.car_passengers ?? []
  const uberPassengers = assignments?.uber_passengers ?? []
  const pickupPassengers = assignments?.pickup_passengers ?? []
  const pickupPlace      = assignments?.pickup_place
  const hasVehicle     = personalVehicle?.has_personal_vehicle

  const vehicleLabel = personalVehicle?.vehicle_description && personalVehicle?.driver
    ? `${personalVehicle.vehicle_description} de ${personalVehicle.driver.Nombre} ${personalVehicle.driver.Apellido}`
    : 'Vehículo'

  const assignedNames = new Set([
    ...(driver         ? [fullName(driver)]         : []),
    ...carPassengers.map(fullName),
    ...uberPassengers.map(fullName),
    ...pickupPassengers.map(fullName),
  ])

  const assignedCount = assignedNames.size
  const unassigned    = pool.filter((emp) => !assignedNames.has(fullName(emp)))
  const uberGroups    = chunkArray(uberPassengers, MAX_UBER)

  // ── Phase 2: solo-group check after auto-fill re-render ─────────────────
  // Identical to the useEffect in AssignmentPanel.
  useEffect(() => {
    if (!pendingAutoFillCheck || !assignments) return
    setPendingAutoFillCheck(false)

    const groups    = chunkArray(assignments.uber_passengers ?? [], MAX_UBER)
    const soloGroup = groups.find((g) => g.length === 1)
    if (soloGroup) {
      setPendingSolo(soloGroup[0])
      setShowSoloChoice(true)
    } else {
      doValidate(assignments)
    }
  }, [pendingAutoFillCheck, assignments]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── API call: POST /validate-assignments ─────────────────────────────────
  async function doValidate(assignmentsSnapshot) {
    const assignedRoles    = deriveProfesiones(frescosResult?.assigned_names ?? [], staff)
    const assignmentsInput = buildAssignmentsInput(assignmentsSnapshot)

    setValidating(true)
    dispatch({ type: ACTIONS.SET_ERROR, payload: null })

    try {
      await validateAssignments({
        assignments:    assignmentsInput,
        assigned_roles: assignedRoles,
      })
      dispatch({ type: ACTIONS.SET_CURRENT_STEP, payload: 4 })
      dispatch({ type: ACTIONS.SET_SHOW_MODAL,   payload: true })
    } catch (err) {
      const detail = err?.response?.data?.detail
      const msg = typeof detail === 'object'
        ? detail.message ?? JSON.stringify(detail)
        : err?.message ?? 'Error al validar asignaciones.'
      dispatch({ type: ACTIONS.SET_ERROR, payload: msg })
    } finally {
      setValidating(false)
    }
  }

  // ── Phase 1: auto-fill + trigger Phase 2 ────────────────────────────────
  function handleValidate() {
    const filled = [...uberPassengers, ...unassigned]
    dispatch({
      type:    ACTIONS.SET_ASSIGNMENTS,
      payload: { ...assignments, uber_passengers: filled },
    })
    setPendingAutoFillCheck(true)
  }

  // "Buscar alternativa y dejar pendiente"
  function handlePendiente() {
    const soloName = fullName(pendingSolo)
    const newUber  = uberPassengers.filter((emp) => fullName(emp) !== soloName)
    dispatch({
      type:    ACTIONS.SET_ASSIGNMENTS,
      payload: { ...assignments, uber_passengers: newUber, pending_employee: pendingSolo },
    })
    setShowSoloChoice(false)
    dispatch({ type: ACTIONS.SET_CURRENT_STEP, payload: 4 })
    dispatch({ type: ACTIONS.SET_SHOW_MODAL,   payload: true })
  }

  // "Continuar con 1 pasajero en Uber"
  async function handleContinueWithSolo() {
    setShowSoloChoice(false)
    await doValidate(assignments)
  }

  // "Reiniciar asignaciones"
  function handleReset() {
    setPendingAutoFillCheck(false)
    setShowSoloChoice(false)
    setPendingSolo(null)
    dispatch({
      type:    ACTIONS.SET_ASSIGNMENTS,
      payload: {
        ...assignments,
        car_passengers:    [],
        uber_passengers:   [],
        pickup_passengers: [],
        pickup_place:      null,
        pending_employee:  null,
      },
    })
  }

  return {
    // UI state
    validating,
    showSoloChoice,
    pendingSolo,
    // Derived data
    driver,
    carPassengers,
    uberPassengers,
    pickupPassengers,
    pickupPlace,
    hasVehicle,
    vehicleLabel,
    assignedCount,
    unassigned,
    uberGroups,
    totalToAssign,
    assignments,
    // Handlers
    handleValidate,
    handlePendiente,
    handleContinueWithSolo,
    handleReset,
  }
}
