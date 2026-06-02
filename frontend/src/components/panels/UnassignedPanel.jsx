/**
 * UnassignedPanel.jsx
 * Zone A — left panel for step 3 (passenger assignment).
 *
 * Self-contained: reads directly from state.vehicles via the
 * getUnassignedEmployees / isVehicleFull selectors exported from appState.
 *
 * Each unassigned employee row expands into a vehicle-assignment menu when
 * clicked.  The menu lists every vehicle that still has capacity, with
 * sub-options "→ Punto de encuentro" and "→ Punto de pickup" (only when the
 * vehicle has a pickup point already set).
 *
 * "Reiniciar asignaciones" dispatches RESET_ALL_VEHICLES, which clears all
 * passengers and routes from every vehicle while keeping the vehicle structure.
 */

import { useState }                                from 'react'
import { RotateCcw }                               from 'lucide-react'
import { useAppState, ACTIONS, getUnassignedEmployees, isVehicleFull, VEHICLE_COLORS } from '../../state/appState'

function fullName(emp) {
  return `${emp.Nombre} ${emp.Apellido}`
}

// Returns a human-readable label for a vehicle.
function vehicleLabel(v) {
  if (v.type === 'personal') {
    return v.vehicle_description && v.driver
      ? `${v.vehicle_description} de ${v.driver}`
      : v.vehicle_description ?? 'Vehículo personal'
  }
  if (v.type === 'charter') return 'Charter'
  return `Uber ${v.id.replace('uber_', '')}`
}

// Occupied / max passenger slots for a vehicle.
function capacityInfo(v) {
  const max     = v.capacity - (v.type === 'personal' ? 1 : 0)
  const current = v.passengers_pe.length + v.pickup.passengers.length
  return `${current}/${max}`
}

// ---------------------------------------------------------------------------
// EmployeeMenu — expanded vehicle-assignment list for one employee
// ---------------------------------------------------------------------------

function EmployeeMenu({ emp, vehicles, dispatch, onClose }) {
  const name    = fullName(emp)

  // Charter vehicle: flat list of charter-specific assignment options.
  const charterV = vehicles.find((v) => v.type === 'charter')
  if (charterV) {
    return (
      <div style={{ marginTop: 4, marginLeft: 17, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <button
          onClick={() => {
            dispatch({ type: ACTIONS.ASSIGN_TO_PE, payload: { employee_name: name, vehicle_id: charterV.id } })
            onClose()
          }}
          style={{ fontSize: 12, color: '#1d4ed8', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', textAlign: 'left' }}
        >
          → Punto de encuentro ({charterV.meeting_point?.name ?? 'PE'})
        </button>
        {charterV.pickups.map((pu, i) => pu.point && (
          <button
            key={i}
            onClick={() => {
              dispatch({ type: ACTIONS.ASSIGN_TO_PICKUP_SLOT, payload: { employee_name: name, vehicle_id: charterV.id, pickup_index: i } })
              onClose()
            }}
            style={{ fontSize: 12, color: VEHICLE_COLORS.charter_1.pickup, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', textAlign: 'left' }}
          >
            → Pickup {i + 1} ({pu.point.place_name ?? pu.point.place_address})
          </button>
        ))}
      </div>
    )
  }

  const available = vehicles.filter((v) => !isVehicleFull(v))

  if (available.length === 0) {
    return (
      <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 4, marginLeft: 17 }}>
        Todos los vehículos están llenos
      </p>
    )
  }

  return (
    <div style={{ marginTop: 4, marginLeft: 17, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {available.map((v) => (
        <VehicleOption key={v.id} vehicle={v} employeeName={name} dispatch={dispatch} onClose={onClose} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// VehicleOption — one vehicle's sub-options (PE / Pickup)
// ---------------------------------------------------------------------------

function VehicleOption({ vehicle, employeeName, dispatch, onClose }) {
  const [expanded, setExpanded] = useState(false)
  const label = vehicleLabel(vehicle)
  const cap   = capacityInfo(vehicle)

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          fontSize:   12,
          color:      '#374151',
          background: 'none',
          border:     'none',
          cursor:     'pointer',
          padding:    '3px 0',
          textAlign:  'left',
          display:    'flex',
          alignItems: 'center',
          gap:        4,
        }}
      >
        <span style={{ fontSize: 10 }}>{expanded ? '▾' : '▸'}</span>
        <span style={{ fontWeight: 500 }}>{label}</span>
        <span style={{ color: '#9ca3af', fontSize: 11 }}>({cap})</span>
      </button>

      {expanded && (
        <div style={{ marginLeft: 14, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {/* PE slot — always available (vehicle is not full) */}
          <button
            onClick={() => {
              dispatch({ type: ACTIONS.ASSIGN_TO_PE, payload: { employee_name: employeeName, vehicle_id: vehicle.id } })
              onClose()
            }}
            style={{
              fontSize:   12,
              color:      '#1d4ed8',
              background: 'none',
              border:     'none',
              cursor:     'pointer',
              padding:    '2px 0',
              textAlign:  'left',
            }}
          >
            → Punto de encuentro
          </button>

          {/* Pickup slot — only offered when the vehicle has a confirmed pickup point */}
          {vehicle.pickup.point && (
            <button
              onClick={() => {
                dispatch({ type: ACTIONS.ASSIGN_TO_PICKUP, payload: { employee_name: employeeName, vehicle_id: vehicle.id } })
                onClose()
              }}
              style={{
                fontSize:   12,
                color:      vehicle.color.pickup,
                background: 'none',
                border:     'none',
                cursor:     'pointer',
                padding:    '2px 0',
                textAlign:  'left',
              }}
            >
              → Punto de pickup
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component — self-contained, no props required
// ---------------------------------------------------------------------------

export default function UnassignedPanel() {
  const { state, dispatch } = useAppState()

  // Which employee's assignment menu is currently expanded.
  const [openMenu, setOpenMenu] = useState(null)

  const pool          = state.remainingPool?.remaining_pool ?? []
  const unassigned    = getUnassignedEmployees(state)
  const totalToAssign = pool.length

  // At least one assignment exists when vehicles have passengers.
  const hasAnyAssigned = state.vehicles.some(
    (v) => v.passengers_pe.length > 0 || v.pickup.passengers.length > 0,
  )

  function handleReset() {
    dispatch({ type: ACTIONS.RESET_ALL_VEHICLES })
    setOpenMenu(null)
  }

  return (
    <div
      style={{
        width:         300,
        flexShrink:    0,
        height:        '100vh',
        background:    '#fff',
        boxShadow:     '2px 0 10px rgba(0,0,0,0.09)',
        display:       'flex',
        flexDirection: 'column',
        zIndex:        10,
        animation:     'slideInFromLeft 220ms ease-out',
      }}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div
        style={{
          padding:      '16px 20px 12px',
          borderBottom: '1px solid #e5e7eb',
          flexShrink:   0,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: '#111827' }}>
          Sin asignar
        </h2>
        <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>
          {unassigned.length} de {totalToAssign} pendientes
        </p>
      </div>

      {/* ── Employee list ───────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px' }}>
        {unassigned.length === 0 ? (
          <p
            style={{
              fontSize:  13,
              color:     '#9ca3af',
              fontStyle: 'italic',
              textAlign: 'center',
              marginTop: 32,
            }}
          >
            Todos asignados ✓
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {unassigned.map((emp) => {
              const name    = fullName(emp)
              const isOpen  = openMenu === name

              return (
                <div key={name}>
                  {/* Employee row — click to toggle vehicle menu */}
                  <button
                    onClick={() => setOpenMenu((prev) => (prev === name ? null : name))}
                    style={{
                      display:    'flex',
                      alignItems: 'center',
                      gap:        9,
                      background: isOpen ? '#f0f9ff' : 'none',
                      border:     isOpen ? '1px solid #bae6fd' : '1px solid transparent',
                      borderRadius: 6,
                      padding:    '4px 6px',
                      cursor:     'pointer',
                      width:      '100%',
                      textAlign:  'left',
                      transition: 'background 120ms ease',
                    }}
                  >
                    <span
                      style={{
                        width:        8,
                        height:       8,
                        borderRadius: '50%',
                        background:   '#3b82f6',
                        flexShrink:   0,
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 500, margin: 0, color: '#111827', lineHeight: 1.3 }}>
                        {name}
                      </p>
                      <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
                        {emp.Profesion}
                      </p>
                    </div>
                    <span style={{ fontSize: 10, color: '#9ca3af', flexShrink: 0 }}>
                      {isOpen ? '▾' : '▸'}
                    </span>
                  </button>

                  {/* Expanded vehicle-assignment menu */}
                  {isOpen && (
                    <EmployeeMenu
                      emp={emp}
                      vehicles={state.vehicles}
                      dispatch={dispatch}
                      onClose={() => setOpenMenu(null)}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Footer: reset button ────────────────────────────────────────── */}
      <div style={{ padding: '12px 20px', borderTop: '1px solid #e5e7eb', flexShrink: 0 }}>
        <button
          onClick={handleReset}
          disabled={!hasAnyAssigned}
          style={{
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            gap:            6,
            width:          '100%',
            padding:        '9px 12px',
            background:     'none',
            border:         '1px solid #d1d5db',
            borderRadius:   8,
            fontSize:       13,
            fontWeight:     500,
            color:          hasAnyAssigned ? '#374151' : '#9ca3af',
            cursor:         hasAnyAssigned ? 'pointer' : 'default',
            transition:     'all 150ms ease',
          }}
          onMouseEnter={(e) => {
            if (hasAnyAssigned) {
              e.currentTarget.style.background   = '#f9fafb'
              e.currentTarget.style.borderColor  = '#9ca3af'
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background  = 'none'
            e.currentTarget.style.borderColor = '#d1d5db'
          }}
        >
          <RotateCcw size={13} />
          Reiniciar asignaciones
        </button>
      </div>
    </div>
  )
}
