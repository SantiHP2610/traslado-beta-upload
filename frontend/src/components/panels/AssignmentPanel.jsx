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
 * 7. Validate button: disabled until all employees are assigned.
 *    Clicking validate auto-fills remaining unassigned into Uber, then calls
 *    POST /validate-assignments.  On success, advances to step 4.
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

      // result is the partial summary (no departure times yet).
      // Advance to step 4 — the summary will be shown in the next panel.
      dispatch({ type: ACTIONS.SET_CURRENT_STEP, payload: 4 })

      // Store the validated summary for the confirmation modal (step 4).
      // We reuse SET_FINAL_OUTPUT to carry the summary forward.
      dispatch({ type: ACTIONS.SET_FINAL_OUTPUT, payload: result })

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
                Vehículo propio
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

            {/*
              The button is always enabled — clicking it auto-fills remaining
              unassigned employees into Uber before calling the backend.
              The label changes to reflect whether there are still unassigned
              employees so the user knows what will happen.
            */}
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
