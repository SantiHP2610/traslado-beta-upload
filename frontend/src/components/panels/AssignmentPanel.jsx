/**
 * AssignmentPanel.jsx
 * Floating panel for step 3: manual passenger assignment.
 *
 * ── What this panel shows ─────────────────────────────────────────────────────
 * 1. The confirmed meeting point (chosenMeetingPoint).
 * 2. Personal car section (if a personal vehicle exists):
 *    - Driver (auto-assigned, always green)
 *    - Car passengers (0–4, colored green in markers)
 * 3. Uber section: all uber passengers, grouped in 4s.
 * 4. Pickup section (if pickup_employee is set): employee name + venue.
 * 5. Progress counter: "X de Y asignados"
 * 6. List of unassigned employees (if any).
 * 7. Validate area: behaviour depends on how many employees are unassigned.
 *    - 0 unassigned: single "Validar asignaciones" button (calls backend).
 *    - 2+ unassigned: single "Asignar X restantes a Uber y validar" button.
 *    - exactly 1 unassigned: TWO buttons —
 *        PRIMARY  "Buscar alternativa y dejar pendiente": stores the employee
 *          as assignments.pending_employee and advances without a backend call.
 *        SECONDARY "Asignar 1 restante a Uber y validar": auto-fills and
 *          calls POST /validate-assignments (existing path).
 *
 * ── Why validate auto-fills Uber ─────────────────────────────────────────────
 * The spec (Part E) says Uber is the default fallback: any employee not
 * explicitly placed in the personal car or as a pickup naturally takes Uber
 * to the meeting point.  Rather than forcing the user to manually click
 * "Asignar a Uber" for every remaining employee, the validate button does it
 * for them and shows a brief confirmation if a single-employee warning fires.
 *
 * ── Why this panel is at top-4 left-80 ───────────────────────────────────────
 * PeaPanel (step 2) occupied top-4 left-80 and is no longer rendered in
 * step 3.  AssignmentPanel reuses that slot so the two panels (FrescosPanel
 * at top-4 left-4 and AssignmentPanel at top-4 left-80) sit side by side
 * just as FrescosPanel and PeaPanel did in step 2.
 *
 * ── Why assigned_roles is re-derived, not stored in state ────────────────────
 * The backend's /validate-assignments rebuilds the remaining pool using
 * assigned_roles (Profesion strings of frescos-assigned employees).  These
 * can be derived from state.frescosResult.assigned_names + state.excelData.staff
 * without adding another state slice.  Recomputing a small list is cheaper
 * than the complexity of an extra action.
 */

import { useState }                           from 'react'
import { useAppState, ACTIONS }               from '../../state/appState'
import { validateAssignments }                from '../../api/endpoints'
// finalOutput is called from ConfirmationModal, not here — imported there.
import { Card, CardContent, CardHeader,
         CardTitle }                          from '@/components/ui/card'
import { Button }                             from '@/components/ui/button'

// Maximum passengers per Uber booking (matches MAX_PASSENGERS_UBER in config.py)
const MAX_UBER = 4

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fullName(emp) {
  return `${emp.Nombre} ${emp.Apellido}`
}

// Look up the Profesion string for each assigned employee name.
// Needed because /validate-assignments uses role strings to rebuild the pool.
function deriveProfesiones(assignedNames, staff) {
  return assignedNames
    .map((name) => staff.find((emp) => fullName(emp) === name)?.Profesion)
    .filter(Boolean)
}

// Group a flat array into sub-arrays of at most `size` items.
function chunkArray(arr, size) {
  const groups = []
  for (let i = 0; i < arr.length; i += size) {
    groups.push(arr.slice(i, i + size))
  }
  return groups
}

// Build the AssignmentsInput shape that the backend's validate/confirm expects.
// Converts employee objects → "Nombre Apellido" name strings and
// groups uber_passengers into Uber bookings of MAX_UBER each.
function buildAssignmentsInput(assignments) {
  return {
    driver:         assignments.driver ? fullName(assignments.driver) : '',
    car_passengers: (assignments.car_passengers ?? []).map(fullName),
    uber_groups:    chunkArray(assignments.uber_passengers ?? [], MAX_UBER).map(
      (group) => group.map(fullName),
    ),
    pickup_employee: assignments.pickup_employee
      ? fullName(assignments.pickup_employee)
      : null,
  }
}

// ---------------------------------------------------------------------------
// Sub-component: employee badge
// ---------------------------------------------------------------------------

function EmpBadge({ name, color = 'bg-muted' }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {name}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AssignmentPanel() {
  const { state, dispatch } = useAppState()
  const [validating, setValidating] = useState(false)

  const {
    assignments,
    remainingPool,
    personalVehicle,
    chosenMeetingPoint,
    frescosResult,
    excelData,
  } = state

  if (!assignments) return null

  const staff         = excelData?.staff ?? []
  const pool          = remainingPool?.remaining_pool ?? []
  const totalToAssign = pool.length

  const driver          = assignments.driver
  const carPassengers   = assignments.car_passengers ?? []
  const uberPassengers  = assignments.uber_passengers ?? []
  const pickupEmployee  = assignments.pickup_employee
  const pickupPlace     = assignments.pickup_place
  const hasVehicle      = personalVehicle?.has_personal_vehicle

  // Vehicle label: "{description} de {Nombre} {Apellido}" — shown wherever
  // "Vehículo propio" appeared before.  Derived from personalVehicle so all
  // components show the same name without a separate state slice.
  const vehicleLabel = personalVehicle?.vehicle_description && personalVehicle?.driver
    ? `${personalVehicle.vehicle_description} de ${personalVehicle.driver.Nombre} ${personalVehicle.driver.Apellido}`
    : 'Vehículo'

  // Employees who count as "assigned" (for progress and unassigned list)
  const assignedNames = new Set([
    ...(driver         ? [fullName(driver)]             : []),
    ...carPassengers.map(fullName),
    ...uberPassengers.map(fullName),
    ...(pickupEmployee ? [fullName(pickupEmployee)]     : []),
  ])

  const assignedCount  = assignedNames.size
  const allAssigned    = assignedCount >= totalToAssign
  const unassigned     = pool.filter((emp) => !assignedNames.has(fullName(emp)))
  const uberGroups     = chunkArray(uberPassengers, MAX_UBER)

  // "Buscar alternativa y dejar pendiente" — exactly-1-unassigned path.
  // Stores the sole unassigned employee on assignments.pending_employee so
  // ConfirmationModal and FinalOutputBlocks can display an amber warning.
  // No backend call: the manager explicitly decided not to assign this person
  // to Uber, so the "all assigned" invariant is intentionally waived here.
  function handlePendiente() {
    const pendingEmp = unassigned[0]
    dispatch({
      type:    ACTIONS.SET_ASSIGNMENTS,
      payload: { ...assignments, pending_employee: pendingEmp },
    })
    dispatch({ type: ACTIONS.SET_CURRENT_STEP, payload: 4 })
    dispatch({ type: ACTIONS.SET_SHOW_MODAL,   payload: true })
  }

  async function handleValidate() {
    // ── Part E: auto-fill remaining unassigned into Uber ──────────────────
    const filled = [
      ...uberPassengers,
      ...unassigned,
    ]

    const updatedAssignments = {
      ...assignments,
      uber_passengers: filled,
    }

    // Optimistically update state so the panel reflects the auto-fill.
    dispatch({ type: ACTIONS.SET_ASSIGNMENTS, payload: updatedAssignments })

    // ── Build request body ────────────────────────────────────────────────
    const assignedRoles   = deriveProfesiones(
      frescosResult?.assigned_names ?? [],
      staff,
    )
    const assignmentsInput = buildAssignmentsInput(updatedAssignments)

    setValidating(true)
    dispatch({ type: ACTIONS.SET_ERROR, payload: null })

    try {
      const result = await validateAssignments({
        assignments:    assignmentsInput,
        assigned_roles: assignedRoles,
      })

      // Advance to step 4 — AssignmentPanel (step 3 only) unmounts.
      // The ConfirmationModal renders based on showModal, not currentStep,
      // so it will appear over the step-4 view immediately.
      dispatch({ type: ACTIONS.SET_CURRENT_STEP, payload: 4 })

      // Open the confirmation modal.  The modal reads all its display data from
      // existing state slices (assignments, frescosResult, chosenMeetingPoint,
      // etc.) — the validate response is only a server-side sanity check and
      // does not need to be stored.
      dispatch({ type: ACTIONS.SET_SHOW_MODAL, payload: true })

    } catch (err) {
      // 422 means validation failed: unassigned or unknown employees.
      const detail = err?.response?.data?.detail
      const msg = typeof detail === 'object'
        ? detail.message ?? JSON.stringify(detail)
        : err?.message ?? 'Error al validar asignaciones.'
      dispatch({ type: ACTIONS.SET_ERROR, payload: msg })
    } finally {
      setValidating(false)
    }
  }

  return (
    <div className="absolute top-4 left-80 z-10 w-72 pointer-events-auto">
      <Card className="shadow-lg">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Asignación de pasajeros</CardTitle>
          {chosenMeetingPoint && (
            <p className="text-xs text-muted-foreground">
              PE: {chosenMeetingPoint.name}
            </p>
          )}
        </CardHeader>

        <CardContent className="pt-0 space-y-3">

          {/* ── Personal car section ─────────────────────────────────── */}
          {hasVehicle && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {vehicleLabel}
              </p>

              {/* Driver */}
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
                <span className="text-xs font-medium">
                  {driver ? `${fullName(driver)} — ${driver.Profesion}` : '—'}
                </span>
                <span className="text-xs text-muted-foreground ml-auto">Chofer</span>
              </div>

              {/* Car passengers */}
              {carPassengers.length > 0 ? (
                carPassengers.map((emp) => (
                  <div key={fullName(emp)} className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
                    <span className="text-xs">{fullName(emp)} — {emp.Profesion}</span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground pl-3.5">
                  Sin pasajeros asignados
                </p>
              )}

              <p className="text-xs text-muted-foreground pl-3.5">
                {carPassengers.length}/{4} pasajeros
              </p>
            </div>
          )}

          {/* ── Pickup section ───────────────────────────────────────── */}
          {pickupEmployee && (
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Pickup en ruta
              </p>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-yellow-400 shrink-0" />
                <span className="text-xs font-medium">{fullName(pickupEmployee)} — {pickupEmployee.Profesion}</span>
              </div>
              {pickupPlace && (
                <p className="text-xs text-muted-foreground pl-3.5">
                  {pickupPlace.place_name}
                </p>
              )}
            </div>
          )}

          {/* ── Uber section ─────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Uber ({uberPassengers.length} {uberPassengers.length === 1 ? 'pasajero' : 'pasajeros'})
            </p>

            {uberPassengers.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin pasajeros asignados</p>
            ) : (
              uberGroups.map((group, gi) => (
                <div key={gi} className="space-y-0.5">
                  {uberGroups.length > 1 && (
                    <p className="text-xs text-muted-foreground">Uber {gi + 1}</p>
                  )}
                  {group.map((emp) => (
                    <div key={fullName(emp)} className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-slate-400 shrink-0" />
                      <span className="text-xs">{fullName(emp)} — {emp.Profesion}</span>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>

          {/* ── Unassigned employees ────────────────────────────────── */}
          {unassigned.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">
                Sin asignar ({unassigned.length})
              </p>
              {unassigned.map((emp) => (
                <div key={fullName(emp)} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-blue-400 shrink-0" />
                  <span className="text-xs">{fullName(emp)} — {emp.Profesion}</span>
                </div>
              ))}
            </div>
          )}

          {/* ── Progress + validate ──────────────────────────────────── */}
          <div className="space-y-2 pt-1 border-t border-border">
            <p className="text-xs text-muted-foreground">
              {assignedCount} de {totalToAssign} asignados
            </p>

            {unassigned.length === 1 ? (
              /*
                Exactly 1 unassigned: the manager chooses between two paths.
                "Buscar alternativa" skips Uber entirely for this person —
                useful when the employee lives too far from the route or the
                manager already arranged separate transport.
                "Asignar a Uber" is the standard fallback (existing behaviour).
              */
              <div className="flex flex-col gap-2">
                <Button
                  className="w-full bg-black text-white hover:bg-gray-900"
                  onClick={handlePendiente}
                  disabled={validating}
                >
                  Buscar alternativa y dejar pendiente
                </Button>
                <Button
                  className="w-full border border-gray-300 text-gray-700 hover:bg-gray-50"
                  variant="outline"
                  onClick={handleValidate}
                  disabled={validating}
                >
                  {validating ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-700 border-t-transparent" />
                  ) : (
                    'Asignar 1 restante a Uber y validar'
                  )}
                </Button>
              </div>
            ) : (
              <Button
                className="w-full"
                onClick={handleValidate}
                disabled={validating}
              >
                {validating ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                ) : unassigned.length > 0 ? (
                  `Asignar ${unassigned.length} restantes a Uber y validar`
                ) : (
                  'Validar asignaciones'
                )}
              </Button>
            )}
          </div>

          {/* Inline error */}
          {state.error && (
            <p className="text-xs text-destructive">{state.error}</p>
          )}

        </CardContent>
      </Card>
    </div>
  )
}
