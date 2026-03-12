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
 * 7. Validate area — two-phase flow when unassigned employees exist:
 *
 *    Phase 1 (on validate click): auto-fill unassigned → Uber, dispatch to state
 *    so the panel re-renders showing the filled groups visually.
 *
 *    Phase 2 (after re-render, via useEffect): check if any Uber group has
 *    exactly 1 passenger.
 *      - No solo group → proceed directly to POST /validate-assignments.
 *      - Solo group found → highlight that group with an amber warning border
 *        and show two decision buttons:
 *          PRIMARY  "Buscar alternativa y dejar pendiente": moves the solo
 *            passenger to pending_employee, removes empty group, calls validate.
 *          SECONDARY "Continuar con 1 pasajero en Uber": keeps as-is, calls validate.
 *
 * ── Why two phases ────────────────────────────────────────────────────────────
 * Without Phase 1 the manager sees "5 unassigned" and then immediately the
 * two-button choice with no visual feedback about who ended up where.  Phase 1
 * makes the assignment list render first so the manager understands the context
 * (e.g. "Uber 1: Michelle, Camila, Delfina, Yamila / Uber 2: Ailen ⚠️") before
 * being asked to decide.
 *
 * ── Why assigned_roles is re-derived, not stored in state ────────────────────
 * The backend's /validate-assignments rebuilds the remaining pool using
 * assigned_roles (Profesion strings of frescos-assigned employees).  These
 * can be derived from state.frescosResult.assigned_names + state.excelData.staff
 * without adding another state slice.  Recomputing a small list is cheaper
 * than the complexity of an extra action.
 */

import { useState, useEffect }                from 'react'
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
// Main component
// ---------------------------------------------------------------------------

export default function AssignmentPanel() {
  const { state, dispatch } = useAppState()
  const [validating, setValidating]                     = useState(false)
  // showSoloChoice is set to true by Phase 2 (useEffect) after the auto-filled
  // groups are already visible.  Never derived from render-time state.
  const [showSoloChoice, setShowSoloChoice]             = useState(false)
  // Solo passenger captured at Phase 2 time; consumed by handlePendiente.
  const [pendingSolo, setPendingSolo]                   = useState(null)
  // Boolean state flag: set to true by handleValidate (Phase 1), cleared by
  // the useEffect (Phase 2).  Using state (not ref) so the change is visible
  // in the effect's dependency array.
  const [pendingAutoFillCheck, setPendingAutoFillCheck] = useState(false)

  const {
    assignments,
    remainingPool,
    personalVehicle,
    chosenMeetingPoint,
    frescosResult,
    excelData,
  } = state

  // Derived values — computed unconditionally so they are available to hooks
  // and handlers regardless of whether assignments is null.
  const staff         = excelData?.staff ?? []
  const pool          = remainingPool?.remaining_pool ?? []
  const totalToAssign = pool.length

  const driver         = assignments?.driver
  const carPassengers  = assignments?.car_passengers ?? []
  const uberPassengers = assignments?.uber_passengers ?? []
  const pickupEmployee = assignments?.pickup_employee
  const pickupPlace    = assignments?.pickup_place
  const hasVehicle     = personalVehicle?.has_personal_vehicle

  const vehicleLabel = personalVehicle?.vehicle_description && personalVehicle?.driver
    ? `${personalVehicle.vehicle_description} de ${personalVehicle.driver.Nombre} ${personalVehicle.driver.Apellido}`
    : 'Vehículo'

  const assignedNames = new Set([
    ...(driver         ? [fullName(driver)]         : []),
    ...carPassengers.map(fullName),
    ...uberPassengers.map(fullName),
    ...(pickupEmployee ? [fullName(pickupEmployee)] : []),
  ])

  const assignedCount = assignedNames.size
  const unassigned    = pool.filter((emp) => !assignedNames.has(fullName(emp)))
  const uberGroups    = chunkArray(uberPassengers, MAX_UBER)

  // ── Phase 2: solo-group check after auto-fill re-render ─────────────────
  // MUST be before any conditional return (Rules of Hooks).
  // The flag guard means it only does real work in the render cycle immediately
  // following a Phase 1 dispatch; all other renders are a cheap no-op.
  useEffect(() => {
    if (!pendingAutoFillCheck || !assignments) return
    setPendingAutoFillCheck(false)

    const groups    = chunkArray(assignments.uber_passengers ?? [], MAX_UBER)
    const soloGroup = groups.find((g) => g.length === 1)
    if (soloGroup) {
      // Show the two-button choice; the amber-highlighted group is already visible.
      setPendingSolo(soloGroup[0])
      setShowSoloChoice(true)
    } else {
      // No solo group — proceed straight to API validation.
      doValidate(assignments)
    }
  }, [pendingAutoFillCheck, assignments]) // eslint-disable-line react-hooks/exhaustive-deps

  // Conditional return AFTER all hooks — never before.
  if (!assignments) return null

  // ── API call: POST /validate-assignments ────────────────────────────────
  // Caller is responsible for ensuring state already reflects the intended
  // assignments before calling this (no redundant SET_ASSIGNMENTS dispatch here).
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

      // Advance to step 4 — AssignmentPanel (step 3 only) unmounts.
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
  // Dispatches unassigned → Uber so the UI shows the filled groups.
  // Sets the ref flag so the useEffect knows to run the solo check next render.
  function handleValidate() {
    const filled = [...uberPassengers, ...unassigned]
    dispatch({
      type:    ACTIONS.SET_ASSIGNMENTS,
      payload: { ...assignments, uber_passengers: filled },
    })
    // Signal Phase 2 — the state change batches with the dispatch above so
    // the component re-renders once with the filled groups visible, then the
    // useEffect fires and checks for a solo group.
    setPendingAutoFillCheck(true)
  }

  // "Buscar alternativa y dejar pendiente": remove the solo passenger from Uber
  // and store them as pending_employee.  No backend call — the manager explicitly
  // chose not to assign this person to Uber.
  function handlePendiente() {
    const soloName = fullName(pendingSolo)
    // uberPassengers already contains the auto-filled list from Phase 1.
    const newUber  = uberPassengers.filter((emp) => fullName(emp) !== soloName)
    dispatch({
      type:    ACTIONS.SET_ASSIGNMENTS,
      payload: { ...assignments, uber_passengers: newUber, pending_employee: pendingSolo },
    })
    setShowSoloChoice(false)
    dispatch({ type: ACTIONS.SET_CURRENT_STEP, payload: 4 })
    dispatch({ type: ACTIONS.SET_SHOW_MODAL,   payload: true })
  }

  // "Continuar con 1 pasajero en Uber": manager accepts the solo group.
  // assignments already has the auto-filled uber_passengers from Phase 1.
  async function handleContinueWithSolo() {
    setShowSoloChoice(false)
    await doValidate(assignments)
  }

  // "Reiniciar asignaciones" — clears car and Uber assignments, keeps driver.
  // Also resets any in-progress solo-check state so the panel returns to normal.
  function handleReset() {
    setPendingAutoFillCheck(false)
    setShowSoloChoice(false)
    setPendingSolo(null)
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
              uberGroups.map((group, gi) => {
                // Highlight the solo group after Phase 2 detects it.
                const isSoloWarning = showSoloChoice && group.length === 1
                return (
                  <div
                    key={gi}
                    className={`space-y-0.5 ${
                      isSoloWarning
                        ? 'rounded border border-amber-400 bg-amber-50 px-1.5 py-1'
                        : ''
                    }`}
                  >
                    {uberGroups.length > 1 && (
                      <p className={`text-xs ${isSoloWarning ? 'font-semibold text-amber-700' : 'text-muted-foreground'}`}>
                        Uber {gi + 1}{isSoloWarning ? ' ⚠️' : ''}
                      </p>
                    )}
                    {group.map((emp) => (
                      <div key={fullName(emp)} className="flex items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-full shrink-0 ${isSoloWarning ? 'bg-amber-500' : 'bg-slate-400'}`} />
                        <span className={`text-xs ${isSoloWarning ? 'font-medium text-amber-800' : ''}`}>
                          {fullName(emp)} — {emp.Profesion}
                        </span>
                      </div>
                    ))}
                  </div>
                )
              })
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

            {showSoloChoice ? (
              /*
                Phase 2 result: a solo Uber group was detected after auto-fill.
                The assignment list above already shows the filled groups with
                the solo group highlighted in amber so the manager has full
                context before deciding.
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
                  onClick={handleContinueWithSolo}
                  disabled={validating}
                >
                  {validating ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-700 border-t-transparent" />
                  ) : (
                    'Continuar con 1 pasajero en Uber'
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
