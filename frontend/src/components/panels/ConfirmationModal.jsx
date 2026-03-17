/**
 * ConfirmationModal.jsx
 * Step 4 — centered confirmation modal (no longer draggable).
 *
 * All logic, API calls, and state dispatches are IDENTICAL to the original.
 * Visual changes:
 *   • useDraggable removed — modal is centered via fixed + translate(-50%,-50%)
 *   • Width increased from 340 → 500px, max-height 80vh with overflow-y:auto
 *   • "Confirmar" button is primary/prominent, "Editar" is secondary
 *
 * ── Why the modal reads from state, not from the validate response ─────────
 * POST /validate-assignments is a server-side sanity check — its return value
 * is discarded.  All display data already lives in existing state slices.
 *
 * ── What happens after confirmation ──────────────────────────────────────
 * "Confirmar" calls POST /final-output → SET_SHOW_OUTPUT true + SET_SHOW_MODAL
 * false → FinalOutputBlocks takes over.
 */

import { useState }              from 'react'
import { useAppState, ACTIONS }  from '../../state/appState'
import { finalOutput }           from '../../api/endpoints'

// Maximum passengers per Uber booking
const MAX_UBER = 4

// ---------------------------------------------------------------------------
// Helpers (unchanged from original)
// ---------------------------------------------------------------------------

function fullName(emp) {
  return `${emp.Nombre} ${emp.Apellido}`
}

function chunkArray(arr, size) {
  const groups = []
  for (let i = 0; i < arr.length; i += size) groups.push(arr.slice(i, i + size))
  return groups
}

function deriveProfesiones(assignedNames, staff) {
  return assignedNames
    .map((name) => staff.find((e) => `${e.Nombre} ${e.Apellido}` === name)?.Profesion)
    .filter(Boolean)
}

function buildBody(assignments, frescosResult, chosenMeetingPoint, staff) {
  const hasOwnVan     = frescosResult?.vehicle === 'camioneta propia'
  const assignedRoles = deriveProfesiones(frescosResult?.assigned_names ?? [], staff)

  return {
    assignments: {
      driver:          assignments.driver ? fullName(assignments.driver) : '',
      car_passengers:  (assignments.car_passengers ?? []).map(fullName),
      uber_groups:     chunkArray(assignments.uber_passengers ?? [], MAX_UBER)
                         .map((g) => g.map(fullName)),
      pickup_employee: assignments.pickup_employee
        ? fullName(assignments.pickup_employee) : null,
      pending_employee: assignments.pending_employee
        ? fullName(assignments.pending_employee) : null,
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
// Sub-components (unchanged from original)
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
  // Loading time is editable by the manager before confirming.
  // Pre-filled with the config default (50 min); stored locally — only
  // relevant at confirmation time, not needed in global state.
  const [loadingTimeMinutes, setLoadingTimeMinutes] = useState(50)

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

  const staff = excelData?.staff ?? []
  const event = excelData?.event ?? {}

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

  const vehicleLabel = vehicleDesc && driver
    ? `${vehicleDesc} de ${fullName(driver)}`
    : driver ? `Vehículo de ${fullName(driver)}` : 'Vehículo'

  const uberGroups = chunkArray(uberPassengers, MAX_UBER)

  // ── Handlers (unchanged) ─────────────────────────────────────────────────

  function handleEdit() {
    dispatch({ type: ACTIONS.SET_SHOW_MODAL,   payload: false })
    dispatch({ type: ACTIONS.SET_CURRENT_STEP, payload: 3 })
  }

  async function handleConfirm() {
    if (!assignments || !frescosResult || !chosenMeetingPoint) return
    setConfirming(true)
    dispatch({ type: ACTIONS.SET_ERROR, payload: null })

    try {
      const body   = {
        ...buildBody(assignments, frescosResult, chosenMeetingPoint, staff),
        loading_time_minutes: loadingTimeMinutes,
      }
      const result = await finalOutput(body)
      dispatch({ type: ACTIONS.SET_FINAL_OUTPUT, payload: result })
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
      {/* Backdrop — dims map but pointer-events:none keeps map interactive */}
      <div
        style={{
          position:        'fixed',
          inset:           0,
          backgroundColor: 'rgba(0,0,0,0.32)',
          zIndex:          40,
          pointerEvents:   'none',
        }}
      />

      {/* Modal — centered via translate */}
      <div
        style={{
          position:      'fixed',
          top:           '50%',
          left:          '50%',
          transform:     'translate(-50%, -50%)',
          zIndex:        50,
          width:         500,
          maxWidth:      'calc(100vw - 32px)',
          maxHeight:     '80vh',
          background:    '#fff',
          borderRadius:  12,
          boxShadow:     '0 8px 40px rgba(0,0,0,0.22)',
          display:       'flex',
          flexDirection: 'column',
          pointerEvents: 'auto',
          animation:     'fadeIn 180ms ease-out',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding:      '18px 24px 14px',
            borderBottom: '1px solid #e5e7eb',
            flexShrink:   0,
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: '#111827' }}>
            Confirmar plan de traslado
          </h2>
          {(event.fecha || event.hora_inicio || event.tipo) && (
            <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0' }}>
              {[event.fecha, event.hora_inicio, event.tipo].filter(Boolean).join(' — ')}
            </p>
          )}
        </div>

        {/* Scrollable content */}
        <div
          style={{ flex: 1, overflowY: 'auto', padding: '18px 24px' }}
          className="space-y-4"
        >
          {/* Section 1: Frescos */}
          <div className="space-y-1.5">
            <SectionTitle>Frescos</SectionTitle>
            <p className="text-xs font-medium">
              {frescosResult?.vehicle === 'camioneta propia'
                ? 'Vehículo QH'
                : 'Miniflete contratado'}
            </p>
            {(frescosResult?.assigned_names ?? []).map((name) => {
              const emp = staff.find((e) => `${e.Nombre} ${e.Apellido}` === name)
              return (
                <NameRow key={name} name={name} role={emp?.Profesion} color="bg-orange-400" />
              )
            })}
            {secondMinifleteResult?.needs_second_miniflete && (
              <div className="pt-1 space-y-0.5">
                <p className="text-xs font-medium text-muted-foreground">Segundo miniflete</p>
                <p className="text-xs text-muted-foreground">{secondMinifleteResult.reason}</p>
              </div>
            )}
          </div>

          {/* Section 2: Punto de encuentro */}
          <div className="space-y-1">
            <SectionTitle>Punto de encuentro</SectionTitle>
            <p className="text-xs font-medium">{chosenMeetingPoint?.name}</p>
            {remuNote && <p className="text-xs text-amber-600">{remuNote}</p>}
          </div>

          {/* Section 3: Personal vehicle */}
          {hasVehicle && (
            <div className="space-y-1.5">
              <SectionTitle>{vehicleLabel}</SectionTitle>
              {driver && (
                <NameRow
                  name={fullName(driver)}
                  role={driver.Profesion}
                  color="bg-green-500"
                />
              )}
              {carPassengers.map((emp) => (
                <NameRow
                  key={fullName(emp)}
                  name={fullName(emp)}
                  role={emp.Profesion}
                  color="bg-green-500"
                />
              ))}
              {carPassengers.length === 0 && !pickupEmployee && (
                <p className="text-xs text-muted-foreground pl-3.5">Sin pasajeros</p>
              )}
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

          {/* Section 4: Uber */}
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
            {uberPassengers.length === 1 && (
              <p className="text-xs text-amber-600">
                ⚠ Un solo pasajero en Uber. Consultar con el manager.
              </p>
            )}
          </div>

          {/* Section 5: Pending */}
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

          {/* Section 6: Loading time at CP */}
          <div className="space-y-1.5">
            <SectionTitle>Tiempo de carga en CP</SectionTitle>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="number"
                min={0}
                max={240}
                step={5}
                value={loadingTimeMinutes}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10)
                  if (!isNaN(v) && v >= 0) setLoadingTimeMinutes(v)
                }}
                disabled={confirming}
                style={{
                  width:        72,
                  padding:      '5px 8px',
                  border:       '1px solid #d1d5db',
                  borderRadius: 6,
                  fontSize:     13,
                  textAlign:    'right',
                  outline:      'none',
                  opacity:      confirming ? 0.6 : 1,
                }}
              />
              <span style={{ fontSize: 13, color: '#374151' }}>min</span>
            </div>
            <p style={{ fontSize: 11, color: '#9ca3af', margin: 0 }}>
              Ajustá según la cantidad de comensales y tipo de evento
            </p>
          </div>

          {/* Error */}
          {state.error && (
            <p className="text-xs text-destructive">{state.error}</p>
          )}
        </div>

        {/* Footer buttons */}
        <div
          style={{
            padding:      '14px 24px',
            borderTop:    '1px solid #e5e7eb',
            flexShrink:   0,
            display:      'flex',
            gap:          10,
          }}
        >
          <button
            onClick={handleEdit}
            disabled={confirming}
            style={{
              flex:         1,
              padding:      '10px 16px',
              background:   '#fff',
              color:        '#374151',
              border:       '1px solid #d1d5db',
              borderRadius: 8,
              fontSize:     14,
              fontWeight:   500,
              cursor:       confirming ? 'default' : 'pointer',
              transition:   'background 150ms ease',
            }}
            onMouseEnter={(e) => { if (!confirming) e.currentTarget.style.background = '#f9fafb' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#fff' }}
          >
            Editar
          </button>
          <button
            onClick={handleConfirm}
            disabled={confirming || showOutput}
            style={{
              flex:           2,
              padding:        '10px 16px',
              background:     (confirming || showOutput) ? '#374151' : '#111827',
              color:          '#fff',
              border:         'none',
              borderRadius:   8,
              fontSize:       14,
              fontWeight:     600,
              cursor:         (confirming || showOutput) ? 'default' : 'pointer',
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'center',
              gap:            8,
              transition:     'background 150ms ease',
            }}
            onMouseEnter={(e) => {
              if (!confirming && !showOutput) e.currentTarget.style.background = '#374151'
            }}
            onMouseLeave={(e) => {
              if (!confirming && !showOutput) e.currentTarget.style.background = '#111827'
            }}
          >
            {confirming ? (
              <>
                <span
                  className="animate-spin"
                  style={{
                    display:       'inline-block',
                    width:         14,
                    height:        14,
                    border:        '2px solid rgba(255,255,255,0.4)',
                    borderTopColor: '#fff',
                    borderRadius:  '50%',
                  }}
                />
                Confirmando...
              </>
            ) : showOutput ? (
              'Confirmado ✓'
            ) : (
              'Confirmar'
            )}
          </button>
        </div>
      </div>
    </>
  )
}
