/**
 * AssignmentSummaryPanel.jsx
 * Zone C — right panel for step 3 (passenger assignment).
 *
 * Self-contained: reads from state.vehicles, state.pending_employee,
 * and the canValidate / getUnassignedEmployees selectors.
 *
 * Layout:
 *   Header — title + N/M counter + "Reiniciar" button
 *   Scrollable body — one card per vehicle (personal first, then Ubers)
 *     Each card shows: driver row (personal), PE passengers with [✕],
 *     pickup section, capacity counter, and "Elegir pickup" button.
 *   Pending employee section (amber) — when state.pending_employee is set.
 *   Footer (sticky) — validate button with inline reasons when disabled.
 *
 * Validate flow:
 *   1. canValidate(state) must return valid: true.
 *   2. Builds AssignmentsInput from vehicles (personal = car_passengers + driver,
 *      Uber vehicles = uber_groups, personal pickup = pickup_passengers).
 *   3. POST /validate-assignments → step 4 + ConfirmationModal.
 *
 * PickupResultPanel is rendered inline at the top when activePickupResult is set.
 */

import { useState }    from 'react'
import { useAppState, ACTIONS, canValidate, getUnassignedEmployees, VEHICLE_COLORS } from '../../state/appState'
import { validateAssignments } from '../../api/endpoints'
import PickupResultPanel       from './PickupResultPanel'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function vehicleDisplayName(v) {
  if (v.type === 'personal') {
    return v.vehicle_description && v.driver
      ? `${v.vehicle_description} de ${v.driver}`
      : 'Vehículo personal'
  }
  return `Uber ${v.id.replace('uber_', '')}`
}

function buildAssignmentsInput(vehicles, pending_employee) {
  return {
    vehicles: vehicles.map((v) => ({
      id:                   v.id,
      type:                 v.type,
      driver:               v.driver ?? null,
      vehicle_description:  v.vehicle_description ?? null,
      passengers_pe:        v.passengers_pe,
      pickup_passengers:    v.pickup.passengers,
      meeting_point:        v.meeting_point,
      custom_meeting_point: v.custom_meeting_point,
    })),
    pending_employee: pending_employee ?? null,
  }
}

// ---------------------------------------------------------------------------
// SectionHeader — small uppercase label
// ---------------------------------------------------------------------------

function SectionHeader({ children }) {
  return (
    <p
      style={{
        fontSize:      11,
        fontWeight:    700,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color:         '#6b7280',
        margin:        '0 0 8px',
      }}
    >
      {children}
    </p>
  )
}

// ---------------------------------------------------------------------------
// PassengerRow — one name + optional remove button
// ---------------------------------------------------------------------------

function PassengerRow({ name, profesion, dotColor, onRemove }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
      <span
        style={{
          width:        8,
          height:       8,
          borderRadius: '50%',
          background:   dotColor,
          flexShrink:   0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 500, margin: 0, color: '#111827', lineHeight: 1.3 }}>
          {name}
        </p>
        {profesion && (
          <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>{profesion}</p>
        )}
      </div>
      {onRemove && (
        <button
          onClick={onRemove}
          title="Quitar asignación"
          style={{
            background:    'none',
            border:        'none',
            cursor:        'pointer',
            color:         '#9ca3af',
            fontSize:      16,
            lineHeight:    1,
            padding:       '0 2px',
            flexShrink:    0,
            transition:    'color 120ms ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#dc2626' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#9ca3af' }}
        >
          ✕
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// VehicleCard — one section per vehicle
// ---------------------------------------------------------------------------

function VehicleCard({ vehicle, staffPool, dispatch, onPickupClick }) {
  const colors = VEHICLE_COLORS[vehicle.id] ?? VEHICLE_COLORS.uber_1
  const maxPassengers = vehicle.capacity - (vehicle.type === 'personal' ? 1 : 0)
  const occupied      = vehicle.passengers_pe.length + vehicle.pickup.passengers.length
  const totalOccupied = occupied + (vehicle.type === 'personal' ? 1 : 0) // +1 for driver

  // Look up a passenger's Profesion from the staff pool by name.
  function getProfesion(name) {
    return staffPool.find((e) => `${e.Nombre} ${e.Apellido}` === name)?.Profesion ?? ''
  }

  function handleUnassign(name) {
    dispatch({ type: ACTIONS.UNASSIGN_EMPLOYEE, payload: { employee_name: name } })
  }

  const hasPickup = vehicle.pickup.passengers.length > 0 || vehicle.pickup.point !== null

  return (
    <div
      style={{
        marginBottom: 16,
        border:       '1px solid #e5e7eb',
        borderRadius: 10,
        overflow:     'hidden',
      }}
    >
      {/* ── Card header ───────────────────────────────────────────────── */}
      <div
        style={{
          display:    'flex',
          alignItems: 'center',
          gap:        8,
          padding:    '10px 14px 8px',
          background: '#f9fafb',
          borderBottom: vehicle.passengers_pe.length > 0 || vehicle.type === 'personal'
            ? '1px solid #e5e7eb'
            : 'none',
        }}
      >
        <span
          style={{
            width:        10,
            height:       10,
            borderRadius: '50%',
            background:   colors.passengers,
            flexShrink:   0,
          }}
        />
        <p style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#111827', margin: 0 }}>
          {vehicleDisplayName(vehicle)}
        </p>
        <span style={{ fontSize: 11, color: '#6b7280' }}>
          {totalOccupied}/{vehicle.capacity}
        </span>
      </div>

      <div style={{ padding: '10px 14px' }}>

        {/* ── Driver row (personal vehicle only) ────────────────────── */}
        {vehicle.type === 'personal' && vehicle.driver && (
          <PassengerRow
            name={vehicle.driver}
            profesion={getProfesion(vehicle.driver)}
            dotColor="#34A853"
            onRemove={undefined}
          />
        )}
        {vehicle.type === 'personal' && vehicle.driver && (
          <p style={{ fontSize: 11, fontWeight: 600, color: '#16a34a', margin: '-2px 0 8px 17px' }}>
            Chofer
          </p>
        )}

        {/* ── Custom PE label (Uber vehicles) ───────────────────────── */}
        {vehicle.type === 'uber' && vehicle.custom_meeting_point && (
          <p style={{ fontSize: 11, color: '#2563eb', margin: '0 0 8px', lineHeight: 1.4 }}>
            📍 {vehicle.meeting_point?.name || vehicle.meeting_point?.address}
          </p>
        )}

        {/* ── PE passengers ─────────────────────────────────────────── */}
        {vehicle.passengers_pe.length > 0 && (
          <div style={{ marginBottom: hasPickup ? 8 : 0 }}>
            {vehicle.passengers_pe.map((name) => (
              <PassengerRow
                key={name}
                name={name}
                profesion={getProfesion(name)}
                dotColor={colors.passengers}
                onRemove={() => handleUnassign(name)}
              />
            ))}
          </div>
        )}

        {vehicle.passengers_pe.length === 0 && vehicle.type === 'uber' && (
          <p style={{ fontSize: 12, color: '#9ca3af', margin: '0 0 4px' }}>
            Sin pasajeros asignados
          </p>
        )}
        {vehicle.passengers_pe.length === 0 && vehicle.type === 'personal' && !vehicle.driver && (
          <p style={{ fontSize: 12, color: '#9ca3af', margin: '0 0 4px' }}>
            Sin pasajeros asignados
          </p>
        )}

        {/* ── Charter multi-pickup sections ─────────────────────────── */}
        {vehicle.type === 'charter' && vehicle.pickups.map((pu, i) => (
          <div key={i} style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #f3f4f6' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: colors.pickup, margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Pickup {i + 1} — {pu.point?.place_name ?? pu.point?.place_address ?? 'Sin nombre'}
              </p>
              <button
                onClick={() => dispatch({ type: ACTIONS.REMOVE_VEHICLE_PICKUP, payload: { vehicle_id: vehicle.id, index: i } })}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 14, padding: '0 2px' }}
                title="Quitar pickup"
                onMouseEnter={(e) => { e.currentTarget.style.color = '#dc2626' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#9ca3af' }}
              >✕</button>
            </div>
            {pu.point?.place_address && (
              <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 4px', lineHeight: 1.4 }}>
                {pu.point.place_address}
              </p>
            )}
            {pu.passengers.map((name) => (
              <PassengerRow
                key={name}
                name={name}
                profesion={getProfesion(name)}
                dotColor={colors.pickup}
                onRemove={() => handleUnassign(name)}
              />
            ))}
          </div>
        ))}

        {/* ── Pickup section ────────────────────────────────────────── */}
        {vehicle.type !== 'charter' && hasPickup && (
          <div
            style={{
              marginTop:    8,
              paddingTop:   8,
              borderTop:    '1px solid #f3f4f6',
            }}
          >
            {(() => {
              const pt      = vehicle.pickup.point
              const ptName  = pt?.place_name || pt?.place_address
              const ptAddr  = pt?.place_address
              return (
                <>
                  <p
                    style={{
                      fontSize:   11,
                      fontWeight: 600,
                      color:      colors.pickup,
                      margin:     '0 0 2px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    {ptName ? `Pickup — ${ptName}` : 'Pickup'}
                  </p>
                  {ptAddr && ptAddr !== ptName && (
                    <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 6px', lineHeight: 1.4 }}>
                      {ptAddr}
                    </p>
                  )}
                </>
              )
            })()}
            {vehicle.pickup.passengers.map((name) => (
              <PassengerRow
                key={name}
                name={name}
                profesion={getProfesion(name)}
                dotColor={colors.pickup}
                onRemove={() => handleUnassign(name)}
              />
            ))}
          </div>
        )}

        {/* ── "Elegir pickup en mapa" ────────────────────────────────── */}
        {/* Charter: uses pickups[] array, button visible if count < max_pickups */}
        {/* Normal: uses pickup.point, button visible if not yet set            */}
        {vehicle.route && (() => {
          const showButton = vehicle.type === 'charter'
            ? vehicle.pickups.length < vehicle.max_pickups
            : !vehicle.pickup.point
          return showButton ? (
            <button
              onClick={() => onPickupClick(vehicle.id)}
              style={{
                display:      'flex',
                alignItems:   'center',
                gap:          5,
                marginTop:    8,
                fontSize:     11,
                color:        '#374151',
                background:   '#f9fafb',
                border:       '1px solid #e5e7eb',
                borderRadius: 6,
                padding:      '5px 10px',
                cursor:       'pointer',
                width:        '100%',
                transition:   'background 120ms ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#f3f4f6' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#f9fafb' }}
            >
              <span style={{ fontSize: 12 }}>📍</span>
              Elegir pickup en mapa
              {vehicle.type === 'charter' && vehicle.pickups.length > 0
                ? ` (${vehicle.pickups.length + 1} de ${vehicle.max_pickups})`
                : ''}
            </button>
          ) : null
        })()}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component — self-contained, no props required
// ---------------------------------------------------------------------------

export default function AssignmentSummaryPanel() {
  const { state, dispatch } = useAppState()
  const [validating, setValidating] = useState(false)
  // soloChoice: { vehicleId, employeeName } while the two-button choice is shown.
  const [soloChoice,  setSoloChoice]  = useState(null)

  const pool         = state.remainingPool?.remaining_pool ?? []
  const staffPool    = state.excelData?.staff ?? []
  const unassigned   = getUnassignedEmployees(state)
  const assigned     = pool.length - unassigned.length
  const { valid, reasons, soloUberWarning } = canValidate(state)

  const pendingEmployeeName = state.pending_employee
  const pendingEmpObj       = pendingEmployeeName
    ? pool.find((e) => `${e.Nombre} ${e.Apellido}` === pendingEmployeeName)
    : null

  // Core POST — receives the already-built payload so callers can pass a
  // pre-modified version without waiting for React state to flush.
  async function doValidate(assignmentsInput) {
    const assignedRoles = (state.frescosResult?.assigned_names ?? []).map((name) => {
      const emp = staffPool.find((e) => `${e.Nombre} ${e.Apellido}` === name)
      return emp?.Profesion ?? name
    }).filter(Boolean)

    setValidating(true)
    dispatch({ type: ACTIONS.SET_ERROR, payload: null })
    try {
      await validateAssignments({ assignments: assignmentsInput, assigned_roles: assignedRoles })
      dispatch({ type: ACTIONS.SET_CURRENT_STEP, payload: 4 })
      dispatch({ type: ACTIONS.SET_SHOW_MODAL,   payload: true })
    } catch (err) {
      const detail = err?.response?.data?.detail
      const msg    = typeof detail === 'object'
        ? detail.message ?? JSON.stringify(detail)
        : err?.message ?? 'Error al validar asignaciones.'
      dispatch({ type: ACTIONS.SET_ERROR, payload: msg })
    } finally {
      setValidating(false)
    }
  }

  // Primary button click — intercepts for solo-Uber warning before API call.
  function handleValidate() {
    if (!valid || validating) return
    if (soloUberWarning) {
      setSoloChoice(soloUberWarning)
      return
    }
    doValidate(buildAssignmentsInput(state.vehicles, pendingEmployeeName))
  }

  // "Continuar con Uber individual" — keep the solo assignment, validate as-is.
  function handleContinueWithSolo() {
    setSoloChoice(null)
    doValidate(buildAssignmentsInput(state.vehicles, pendingEmployeeName))
  }

  // "Buscar alternativa y dejar pendiente" — remove from Uber + mark pending.
  // The payload is built from the locally-modified vehicles array so the API
  // receives correct data before React flushes the dispatched state changes.
  function handleLeavePending(vehicleId, employeeName) {
    const updatedVehicles = state.vehicles.map((v) => ({
      ...v,
      passengers_pe: v.passengers_pe.filter((n) => n !== employeeName),
      pickup:        { ...v.pickup, passengers: v.pickup.passengers.filter((n) => n !== employeeName) },
    }))
    dispatch({ type: ACTIONS.UNASSIGN_EMPLOYEE,    payload: { employee_name: employeeName } })
    dispatch({ type: ACTIONS.SET_PENDING_EMPLOYEE, payload: { name: employeeName } })
    setSoloChoice(null)
    doValidate(buildAssignmentsInput(updatedVehicles, employeeName))
  }

  function handlePickupClick(vehicleId) {
    dispatch({ type: ACTIONS.SET_MANUAL_PICKUP_MODE, payload: { active: true, vehicleId } })
  }

  return (
    <div
      style={{
        width:         320,
        flexShrink:    0,
        height:        '100vh',
        background:    '#fff',
        boxShadow:     '-2px 0 10px rgba(0,0,0,0.09)',
        display:       'flex',
        flexDirection: 'column',
        zIndex:        10,
        animation:     'slideInFromRight 220ms ease-out',
      }}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div
        style={{
          padding:      '16px 20px 12px',
          borderBottom: '1px solid #e5e7eb',
          flexShrink:   0,
          display:      'flex',
          alignItems:   'flex-start',
          justifyContent: 'space-between',
          gap:          12,
        }}
      >
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: '#111827' }}>
            Asignaciones
          </h2>
          <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>
            {assigned} de {pool.length} asignados
          </p>
        </div>
      </div>

      {/* ── Scrollable content ──────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>

        {/* ── Manual pickup mode banner ─────────────────────────────── */}
        {state.manualPickupMode?.active && (
          <div
            style={{
              marginBottom: 14,
              background:   '#eff6ff',
              border:       '1px solid #93c5fd',
              borderLeft:   '4px solid #3b82f6',
              borderRadius: 6,
              padding:      '10px 12px',
            }}
          >
            <p style={{ fontSize: 12, color: '#1d4ed8', margin: '0 0 6px', fontWeight: 600 }}>
              Modo pickup activo
            </p>
            <p style={{ fontSize: 12, color: '#1e40af', margin: '0 0 8px', lineHeight: 1.5 }}>
              Hacé click en un punto sobre la ruta para elegirlo como pickup.
            </p>
            <button
              onClick={() => dispatch({ type: ACTIONS.SET_MANUAL_PICKUP_MODE, payload: { active: false, vehicleId: null } })}
              style={{
                fontSize:       12,
                color:          '#2563eb',
                background:     'none',
                border:         'none',
                padding:        0,
                cursor:         'pointer',
                textDecoration: 'underline',
              }}
            >
              Cancelar
            </button>
          </div>
        )}

        {/* ── Inline pickup result panel ────────────────────────────── */}
        {state.activePickupResult && (
          <div
            style={{
              marginBottom: 18,
              border:       '1px solid #e5e7eb',
              borderRadius: 10,
              overflow:     'hidden',
            }}
          >
            <PickupResultPanel />
          </div>
        )}

        {/* ── Vehicle cards ─────────────────────────────────────────── */}
        {state.vehicles.length === 0 ? (
          <p style={{ fontSize: 13, color: '#9ca3af', textAlign: 'center', marginTop: 24 }}>
            Inicializando vehículos…
          </p>
        ) : (
          state.vehicles.map((v) => (
            <VehicleCard
              key={v.id}
              vehicle={v}
              staffPool={staffPool}
              dispatch={dispatch}
              onPickupClick={handlePickupClick}
            />
          ))
        )}

        {/* ── Pending employee ──────────────────────────────────────── */}
        {pendingEmployeeName && (
          <div
            style={{
              marginBottom: 16,
              background:   '#fffbeb',
              border:       '1px solid #fde68a',
              borderLeft:   '4px solid #f59e0b',
              borderRadius: 6,
              padding:      '10px 12px',
            }}
          >
            <SectionHeader>Pendiente</SectionHeader>
            <p style={{ fontSize: 13, fontWeight: 500, margin: '0 0 2px', color: '#111827' }}>
              {pendingEmployeeName}
            </p>
            {pendingEmpObj?.Profesion && (
              <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 6px' }}>
                {pendingEmpObj.Profesion}
              </p>
            )}
            <p style={{ fontSize: 12, color: '#b45309', margin: 0 }}>
              Transporte alternativo a coordinar
            </p>
          </div>
        )}

        {/* ── API error ─────────────────────────────────────────────── */}
        {state.error && (
          <p style={{ fontSize: 12, color: '#dc2626', marginBottom: 8 }}>{state.error}</p>
        )}
      </div>

      {/* ── Footer: validate button / solo-Uber choice ─────────────────── */}
      <div
        style={{
          padding:    '12px 16px',
          borderTop:  '1px solid #e5e7eb',
          flexShrink: 0,
        }}
      >
        {soloChoice ? (
          /* ── Two-button choice for solo Uber passenger ──────────────── */
          <div>
            <div
              style={{
                marginBottom: 10,
                background:   '#fffbeb',
                border:       '1px solid #fde68a',
                borderLeft:   '4px solid #f59e0b',
                borderRadius: 6,
                padding:      '8px 10px',
              }}
            >
              <p style={{ fontSize: 12, fontWeight: 600, color: '#92400e', margin: '0 0 2px' }}>
                ⚠ Uber {soloChoice.vehicleId.replace('uber_', '')} tiene un solo pasajero
              </p>
              <p style={{ fontSize: 12, color: '#92400e', margin: 0 }}>
                {soloChoice.employeeName}
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <button
                onClick={() => handleLeavePending(soloChoice.vehicleId, soloChoice.employeeName)}
                disabled={validating}
                style={{
                  width:          '100%',
                  padding:        '10px 14px',
                  background:     validating ? '#374151' : '#111827',
                  color:          '#fff',
                  border:         'none',
                  borderRadius:   8,
                  fontSize:       13,
                  fontWeight:     600,
                  cursor:         validating ? 'default' : 'pointer',
                  display:        'flex',
                  alignItems:     'center',
                  justifyContent: 'center',
                  gap:            8,
                  transition:     'background 150ms ease',
                }}
                onMouseEnter={(e) => {
                  if (!validating) e.currentTarget.style.background = '#374151'
                }}
                onMouseLeave={(e) => {
                  if (!validating) e.currentTarget.style.background = '#111827'
                }}
              >
                {validating ? (
                  <>
                    <span
                      style={{
                        display: 'inline-block', width: 13, height: 13,
                        border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff',
                        borderRadius: '50%', animation: 'spin 0.8s linear infinite',
                      }}
                    />
                    Validando…
                  </>
                ) : (
                  'Buscar alternativa y dejar pendiente'
                )}
              </button>
              <button
                onClick={handleContinueWithSolo}
                disabled={validating}
                style={{
                  width:          '100%',
                  padding:        '10px 14px',
                  background:     '#fff',
                  color:          validating ? '#9ca3af' : '#374151',
                  border:         '1px solid #d1d5db',
                  borderRadius:   8,
                  fontSize:       13,
                  fontWeight:     500,
                  cursor:         validating ? 'default' : 'pointer',
                  transition:     'background 150ms ease',
                }}
                onMouseEnter={(e) => {
                  if (!validating) e.currentTarget.style.background = '#f9fafb'
                }}
                onMouseLeave={(e) => {
                  if (!validating) e.currentTarget.style.background = '#fff'
                }}
              >
                Continuar con Uber individual
              </button>
            </div>
          </div>
        ) : (
          /* ── Normal: reason list + validate button ──────────────────── */
          <>
            {!valid && reasons.length > 0 && (
              <div
                style={{
                  marginBottom: 8,
                  background:   '#fffbeb',
                  border:       '1px solid #fde68a',
                  borderRadius: 6,
                  padding:      '7px 10px',
                }}
              >
                {reasons.map((r, i) => (
                  <p key={i} style={{ fontSize: 11, color: '#92400e', margin: i > 0 ? '3px 0 0' : 0 }}>
                    ⚠ {r}
                  </p>
                ))}
              </div>
            )}

            <button
              onClick={handleValidate}
              disabled={!valid || validating}
              style={{
                width:          '100%',
                padding:        '11px 16px',
                background:     valid && !validating ? '#111827' : '#e5e7eb',
                color:          valid && !validating ? '#fff'     : '#9ca3af',
                border:         'none',
                borderRadius:   8,
                fontSize:       14,
                fontWeight:     500,
                cursor:         valid && !validating ? 'pointer' : 'default',
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'center',
                gap:            8,
                transition:     'background 150ms ease',
              }}
              onMouseEnter={(e) => {
                if (valid && !validating) e.currentTarget.style.background = '#374151'
              }}
              onMouseLeave={(e) => {
                if (valid && !validating) e.currentTarget.style.background = '#111827'
              }}
            >
              {validating ? (
                <>
                  <span
                    className="animate-spin"
                    style={{
                      display:        'inline-block',
                      width:          14,
                      height:         14,
                      border:         '2px solid rgba(255,255,255,0.4)',
                      borderTopColor: '#fff',
                      borderRadius:   '50%',
                    }}
                  />
                  Validando…
                </>
              ) : (
                'Validar asignaciones y rutas'
              )}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
