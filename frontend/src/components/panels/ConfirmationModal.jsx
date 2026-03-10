/**
 * ConfirmationModal.jsx
 * Step 4 — draggable confirmation modal.
 *
 * ── What this component shows ─────────────────────────────────────────────────
 * A summary of the full assignment plan assembled from existing state slices.
 * The user reviews it and either edits (returns to step 3) or confirms (calls
 * POST /final-output, which triggers both departure-time calculations).
 *
 * ── Why the modal reads from state, not from the validate response ─────────────
 * POST /validate-assignments is a server-side sanity check — its return value is
 * discarded.  All display data (names, Profesion, vehicle, meeting point) already
 * lives in existing state slices (assignments, frescosResult, personalVehicle,
 * chosenMeetingPoint).  Reusing those avoids storing a redundant duplicate of
 * the same data in a separate "validateResult" slice.
 *
 * ── What happens after confirmation ─────────────────────────────────────────
 * "Confirmar" calls POST /final-output, then dispatches SET_SHOW_OUTPUT true
 * and SET_SHOW_MODAL false.  The modal closes and FinalOutputBlocks takes over:
 * a single large centered panel (85vw × 85vh) with both frescos and transport
 * sections, clipboard copy buttons, and a "Volver a editar" button.
 *
 * ── Overlay approach ─────────────────────────────────────────────────────────
 * The backdrop div uses pointer-events:none.  This darkens the map visually
 * without capturing any pointer events, so the user can still pan, zoom, and
 * inspect markers through the overlay.  Only the modal card has pointer-events
 * auto (the default).
 *
 * ── Drag ─────────────────────────────────────────────────────────────────────
 * useDraggable() returns { pos, onMouseDown }.  The card header is the drag
 * handle — dragging from the content area is intentionally not supported so
 * the user can click buttons and scroll the list without accidentally moving it.
 *
 * ── Why POST /final-output instead of POST /confirm-assignments ───────────────
 * /final-output reads event_duration_hours (hardcoded 5.0) and detects picada
 * from the Excel internally, so the frontend does not need to derive or pass
 * those values.  /confirm-assignments requires them as explicit body fields —
 * it is a partial API designed for a separate UI step that this app consolidates
 * into a single confirm click.  /final-output is the single-call path that
 * returns both draggable output blocks in one round-trip.
 */

import { useState }                          from 'react'
import { useAppState, ACTIONS }              from '../../state/appState'
import { finalOutput }                       from '../../api/endpoints'
import { useDraggable }                      from '../../hooks/useDraggable'
import { Card, CardContent, CardHeader,
         CardTitle }                         from '@/components/ui/card'
import { Button }                            from '@/components/ui/button'

// Maximum passengers per Uber booking — matches config.py MAX_PASSENGERS_UBER.
const MAX_UBER = 4

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fullName(emp) {
  return `${emp.Nombre} ${emp.Apellido}`
}

function chunkArray(arr, size) {
  const groups = []
  for (let i = 0; i < arr.length; i += size) groups.push(arr.slice(i, i + size))
  return groups
}

// Look up Profesion for each assigned name — needed because frescosResult
// stores "Nombre Apellido" strings, not full employee objects.
function deriveProfesiones(assignedNames, staff) {
  return assignedNames
    .map((name) => staff.find((e) => `${e.Nombre} ${e.Apellido}` === name)?.Profesion)
    .filter(Boolean)
}

// Build the AssignmentsInput shape for POST /final-output.
// Converts local employee objects → "Nombre Apellido" name strings and
// groups uber_passengers into uber_groups of MAX_UBER each.
function buildBody(assignments, frescosResult, chosenMeetingPoint, staff) {
  const hasOwnVan     = frescosResult?.vehicle === 'camioneta propia'
  const assignedRoles = deriveProfesiones(frescosResult?.assigned_names ?? [], staff)

  return {
    assignments: {
      driver:          assignments.driver
        ? fullName(assignments.driver) : '',
      car_passengers:  (assignments.car_passengers ?? []).map(fullName),
      uber_groups:     chunkArray(assignments.uber_passengers ?? [], MAX_UBER)
                         .map((g) => g.map(fullName)),
      pickup_employee: assignments.pickup_employee
        ? fullName(assignments.pickup_employee) : null,
    },
    assigned_roles:       assignedRoles,
    chosen_meeting_point: {
      name: chosenMeetingPoint.name,
      lat:  chosenMeetingPoint.lat,
      lng:  chosenMeetingPoint.lng,
    },
    has_own_van: hasOwnVan,
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionTitle({ children }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  )
}

function NameRow({ name, role, color = 'bg-slate-400' }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${color} shrink-0`} />
      <span className="text-xs">{name}{role ? ` — ${role}` : ''}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ConfirmationModal() {
  const { state, dispatch } = useAppState()
  const [confirming, setConfirming] = useState(false)

  // Start near the horizontal center, slightly down from the top.
  const { pos, onMouseDown } = useDraggable({
    x: Math.max(8, Math.round(window.innerWidth * 0.28)),
    y: Math.max(8, Math.round(window.innerHeight * 0.10)),
  })

  const {
    assignments,
    frescosResult,
    secondMinifleteResult,
    chosenMeetingPoint,
    meetingPoint,
    peaEvaluation,
    personalVehicle,
    excelData,
    showOutput,
  } = state

  const staff    = excelData?.staff ?? []
  const event    = excelData?.event ?? {}

  // Determine whether the user chose a PEA (different from the original PE).
  const isPea    = meetingPoint && chosenMeetingPoint?.name !== meetingPoint?.name
  const remuNote = isPea
    ? peaEvaluation?.candidates?.find((c) => c.name === chosenMeetingPoint?.name)
        ?.remuneration_note ?? null
    : null

  const driver         = assignments?.driver
  const carPassengers  = assignments?.car_passengers ?? []
  const uberPassengers = assignments?.uber_passengers ?? []
  const pickupEmployee = assignments?.pickup_employee
  const pickupPlace    = assignments?.pickup_place
  const hasVehicle     = personalVehicle?.has_personal_vehicle
  const vehicleDesc    = personalVehicle?.vehicle_description

  // Vehicle label: "{description} de {Nombre} {Apellido}" — replaces the generic
  // "Vehículo propio" section title with the actual car make and driver name.
  const vehicleLabel = vehicleDesc && driver
    ? `${vehicleDesc} de ${fullName(driver)}`
    : driver ? `Vehículo de ${fullName(driver)}` : 'Vehículo'

  const uberGroups = chunkArray(uberPassengers, MAX_UBER)

  // ── Handlers ──────────────────────────────────────────────────────────────

  // "Editar" — close modal and return to step 3.
  // All state (assignments, chosenMeetingPoint, frescosResult, routes, PEA
  // evaluation) is preserved exactly as the user left it — no API calls are
  // repeated.  The expensive geocoding and routing calls from steps 1–3 are
  // not re-run; the user simply returns to the populated step-3 view.
  function handleEdit() {
    dispatch({ type: ACTIONS.SET_SHOW_MODAL, payload: false })
    dispatch({ type: ACTIONS.SET_CURRENT_STEP, payload: 3 })
  }

  // "Confirmar" — call POST /final-output then show the two output blocks.
  async function handleConfirm() {
    if (!assignments || !frescosResult || !chosenMeetingPoint) return
    setConfirming(true)
    dispatch({ type: ACTIONS.SET_ERROR, payload: null })

    try {
      const body   = buildBody(assignments, frescosResult, chosenMeetingPoint, staff)
      const result = await finalOutput(body)
      // Store the full block response — FinalOutputBlocks reads from this.
      dispatch({ type: ACTIONS.SET_FINAL_OUTPUT, payload: result })
      // Show the final output panel and close this modal — the panel takes over.
      dispatch({ type: ACTIONS.SET_SHOW_OUTPUT,  payload: true  })
      dispatch({ type: ACTIONS.SET_SHOW_MODAL,   payload: false })
    } catch (err) {
      const detail = err?.response?.data?.detail
      const msg    = typeof detail === 'object'
        ? (detail.message ?? JSON.stringify(detail))
        : (err?.message ?? 'Error al confirmar asignaciones.')
      dispatch({ type: ACTIONS.SET_ERROR, payload: msg })
    } finally {
      setConfirming(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/*
        Backdrop — dims the map to signal that the modal requires attention,
        but pointer-events:none ensures the user can still pan, zoom, and
        click markers through it.  The map never becomes a dead zone.
      */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.30)',
          zIndex: 40,
          pointerEvents: 'none',
        }}
      />

      {/* Modal card — full pointer-event capture so buttons and scroll work. */}
      <div
        style={{
          position: 'fixed',
          left: pos.x,
          top:  pos.y,
          zIndex: 50,
          width: 340,
          pointerEvents: 'auto',
          userSelect: 'none',
        }}
      >
        <Card className="shadow-2xl">

          {/* Drag handle — the entire header row moves the modal. */}
          <CardHeader
            className="pb-2 cursor-grab active:cursor-grabbing select-none"
            onMouseDown={onMouseDown}
          >
            <CardTitle className="text-base">Confirmar plan de traslado</CardTitle>
            {event.fecha || event.hora_inicio || event.tipo ? (
              <p className="text-xs text-muted-foreground">
                {[event.fecha, event.hora_inicio, event.tipo].filter(Boolean).join(' — ')}
              </p>
            ) : null}
          </CardHeader>

          <CardContent className="pt-0 space-y-4 max-h-[68vh] overflow-y-auto">

            {/* ── Section 1: Frescos vehicle ──────────────────────────────── */}
            <div className="space-y-1.5">
              <SectionTitle>Frescos</SectionTitle>
              <p className="text-xs font-medium">
                {frescosResult?.vehicle === 'camioneta propia'
                  ? 'Vehículo QH'
                  : 'Miniflete contratado'}
              </p>
              {(frescosResult?.assigned_names ?? []).map((name) => {
                const emp  = staff.find((e) => `${e.Nombre} ${e.Apellido}` === name)
                return (
                  <NameRow
                    key={name}
                    name={name}
                    role={emp?.Profesion}
                    color="bg-orange-400"
                  />
                )
              })}
              {secondMinifleteResult?.needs_second_miniflete && (
                <div className="pt-1 space-y-0.5">
                  <p className="text-xs font-medium text-muted-foreground">
                    Segundo miniflete
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {secondMinifleteResult.reason}
                  </p>
                </div>
              )}
            </div>

            {/* ── Section 2: Punto de encuentro ───────────────────────────── */}
            <div className="space-y-1">
              <SectionTitle>Punto de encuentro</SectionTitle>
              <p className="text-xs font-medium">{chosenMeetingPoint?.name}</p>
              {remuNote && (
                <p className="text-xs text-amber-600">{remuNote}</p>
              )}
            </div>

            {/* ── Section 3: Personal vehicle ──────────────────────────────── */}
            {hasVehicle && (
              <div className="space-y-1.5">
                <SectionTitle>{vehicleLabel}</SectionTitle>
                {driver && (
                  <p className="text-xs font-medium">
                    {vehicleDesc
                      ? `${vehicleDesc} de ${fullName(driver)}`
                      : `Vehículo de ${fullName(driver)}`}
                  </p>
                )}
                {/* Driver row */}
                {driver && (
                  <NameRow
                    name={fullName(driver)}
                    role={driver.Profesion}
                    color="bg-green-500"
                  />
                )}
                {/* Car passengers */}
                {carPassengers.map((emp) => (
                  <NameRow
                    key={fullName(emp)}
                    name={fullName(emp)}
                    role={emp.Profesion}
                    color="bg-green-500"
                  />
                ))}
                {carPassengers.length === 0 && !pickupEmployee && (
                  <p className="text-xs text-muted-foreground pl-3.5">
                    Sin pasajeros
                  </p>
                )}
                {/* Pickup */}
                {pickupEmployee && (
                  <div className="pl-1 space-y-0.5">
                    <NameRow
                      name={fullName(pickupEmployee)}
                      role={pickupEmployee.Profesion}
                      color="bg-yellow-400"
                    />
                    {pickupPlace && (
                      <p className="text-xs text-muted-foreground pl-3.5">
                        Pickup en {pickupPlace.place_name}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Section 4: Uber ──────────────────────────────────────────── */}
            <div className="space-y-1.5">
              <SectionTitle>
                Uber ({uberPassengers.length}{' '}
                {uberPassengers.length === 1 ? 'pasajero' : 'pasajeros'})
              </SectionTitle>
              {uberPassengers.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sin pasajeros Uber</p>
              ) : (
                uberGroups.map((group, gi) => (
                  <div key={gi} className="space-y-0.5">
                    {uberGroups.length > 1 && (
                      <p className="text-xs text-muted-foreground">Uber {gi + 1}</p>
                    )}
                    {group.map((emp) => (
                      <NameRow
                        key={fullName(emp)}
                        name={fullName(emp)}
                        role={emp.Profesion}
                        color="bg-slate-400"
                      />
                    ))}
                  </div>
                ))
              )}
              {/* Warn if a single Uber passenger will ride alone */}
              {uberPassengers.length === 1 && (
                <p className="text-xs text-amber-600">
                  ⚠ Un solo pasajero en Uber. Consultar con el manager.
                </p>
              )}
            </div>

            {/* ── Section 5: Pending employee ──────────────────────────────── */}
            {/* Only shown when the manager chose "Buscar alternativa" for the   */}
            {/* sole unassigned employee — that person needs transport arranged   */}
            {/* outside the normal Uber/car flow.                                 */}
            {assignments?.pending_employee && (
              <div className="space-y-1 rounded-md bg-amber-50 border border-amber-200 p-2">
                <SectionTitle>Pendiente</SectionTitle>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
                  <span className="text-xs font-medium">
                    {fullName(assignments.pending_employee)}
                    {assignments.pending_employee.Profesion
                      ? ` — ${assignments.pending_employee.Profesion}`
                      : ''}
                  </span>
                </div>
                <p className="text-xs text-amber-700">Transporte alternativo a coordinar</p>
              </div>
            )}

            {/* ── Error ───────────────────────────────────────────────────── */}
            {state.error && (
              <p className="text-xs text-destructive">{state.error}</p>
            )}

            {/* ── Footer buttons ───────────────────────────────────────────── */}
            <div className="flex gap-2 pt-1 border-t border-border">
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleEdit}
                disabled={confirming}
              >
                Editar
              </Button>
              <Button
                className="flex-1"
                onClick={handleConfirm}
                // Disable after successful confirm to prevent double-submitting
                // the expensive Routes API calls inside /final-output.
                disabled={confirming || showOutput}
              >
                {confirming ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                ) : showOutput ? (
                  'Confirmado ✓'
                ) : (
                  'Confirmar'
                )}
              </Button>
            </div>

          </CardContent>
        </Card>
      </div>
    </>
  )
}
