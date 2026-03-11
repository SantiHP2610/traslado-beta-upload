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
 * 7. Validate area: behaviour depends on the post-auto-fill Uber grouping.
 *    - No solo Uber group: single button ("Validar" or "Asignar X a Uber y validar").
 *    - A solo Uber group would exist: TWO buttons —
 *        PRIMARY  "Buscar alternativa y dejar pendiente": stores the solo
 *          passenger as assignments.pending_employee, removes them from Uber.
 *        SECONDARY "Continuar con Uber individual": keeps the solo group and
 *          calls POST /validate-assignments.
 *    This applies both when the solo is an unassigned employee that would be
 *    auto-filled AND when the user manually put someone in Uber and they ended
 *    up alone in a group (e.g. 5 Uber passengers → groups of 4 + 1).
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
import { RotateCcw }                          from 'lucide-react'
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

  const assignedCount = assignedNames.size
  const unassigned    = pool.filter((emp) => !assignedNames.has(fullName(emp)))
  const uberGroups    = chunkArray(uberPassengers, MAX_UBER)

  // Detect solo Uber group AFTER auto-fill (before the user clicks validate).
  // Auto-fill appends unassigned to the existing uber_passengers list, then
  // chunks into groups of MAX_UBER.  If any group has exactly 1 passenger,
  // the manager should decide: leave them pending or accept the solo Uber.
  // This check covers two cases:
  //   - 1 unassigned employee that would be the only person in their Uber group
  //   - Already-assigned employees that ended up alone (e.g. 5 in Uber → 4+1)
  const filledUberAfterAutoFill = [...uberPassengers, ...unassigned]
  const filledGroupsAfterAutoFill = chunkArray(filledUberAfterAutoFill, MAX_UBER)
  const soloGroup      = filledGroupsAfterAutoFill.find((g) => g.length === 1)
  const hasSoloUberGroup = Boolean(soloGroup)
  const soloPassenger  = soloGroup?.[0] ?? null

  // "Buscar alternativa y dejar pendiente" path.
  // Removes the solo Uber passenger from uber_passengers (whether they were
  // already there or in unassigned) and stores them as pending_employee so
  // ConfirmationModal and FinalOutputBlocks can display an amber warning.
  // No backend call: the manager explicitly chose not to assign this person
  // to Uber, so the "all assigned" invariant is intentionally waived here.
  function handlePendiente() {
    const soloName  = fullName(soloPassenger)
    const newUber   = uberPassengers.filter((emp) => fullName(emp) !== soloName)
    dispatch({
      type:    ACTIONS.SET_ASSIGNMENTS,
      payload: { ...assignments, uber_passengers: newUber, pending_employee: soloPassenger },
    })
    dispatch({ type: ACTIONS.SET_CURRENT_STEP, payload: 4 })
    dispatch({ type: ACTIONS.SET_SHOW_MODAL,   payload: true })
  }

  // "Reiniciar asignaciones" — clears car and Uber assignments, keeps driver.
  // Visible once at least one employee has been placed in car or Uber, so the
  // button is never shown on a blank slate.  No confirmation needed because
  // the manager can immediately re-assign — the action costs seconds to undo.
  function handleReset() {
    dispatch({
      type:    ACTIONS.SET_ASSIGNMENTS,
      payload: {
        ...assignments,
        car_passengers:  [],
        uber_passengers: [],
        pickup_employee: null,
        pickup_place:    null,
        pending_employee: null,
      },
    })
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
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Asignación de pasajeros</CardTitle>
            {(carPassengers.length > 0 || uberPassengers.length > 0) && (
              <button
                onClick={handleReset}
                title="Reiniciar asignaciones"
                style={{
                  background: 'none',
                  border:     'none',
                  cursor:     'pointer',
                  padding:    4,
                  color:      '#6b7280',
                  display:    'flex',
                  alignItems: 'center',
                  gap:        4,
                  fontSize:   11,
                }}
              >
                <RotateCcw size={13} />
                Reiniciar
              </button>
            )}
          </div>
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

            {hasSoloUberGroup ? (
              /*
                A solo Uber group would exist after auto-fill.
                The manager chooses: leave the solo passenger pending (primary)
                or accept the single-passenger Uber booking (secondary).
                This triggers for the "1 unassigned" case AND for manually
                assigned employees who ended up alone in a group (e.g. 5→4+1).
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
                    'Continuar con Uber individual'
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
