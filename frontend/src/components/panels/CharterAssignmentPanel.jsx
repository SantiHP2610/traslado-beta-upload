/**
 * CharterAssignmentPanel.jsx
 * Left panel at step 3 for charter events.
 *
 * Shows unassigned employees and lets the manager assign each one to:
 *   - Punto de encuentro (PE)
 *   - Pickup 1 (if exists)
 *   - Pickup 2 (if exists)
 *
 * No capacity limit — charter buses hold everyone.
 */

import { useState }                                from 'react'
import { useAppState, ACTIONS, getCharterUnassigned } from '../../state/appState'

export default function CharterAssignmentPanel() {
  const { state, dispatch } = useAppState()

  // Which employee's dropdown is open (by full name string), or null.
  const [openMenu, setOpenMenu] = useState(null)

  const ca            = state.charterAssignment
  const pool          = state.remainingPool?.remaining_pool ?? []
  const unassigned    = getCharterUnassigned(state)
  const totalCount    = pool.length
  const pendingCount  = unassigned.length

  function handleAssignPe(employeeName) {
    dispatch({ type: ACTIONS.ASSIGN_TO_CHARTER_PE, payload: { employee_name: employeeName } })
    setOpenMenu(null)
  }

  function handleAssignPickup(employeeName, pickupIndex) {
    dispatch({ type: ACTIONS.ASSIGN_TO_CHARTER_PICKUP, payload: { employee_name: employeeName, pickup_index: pickupIndex } })
    setOpenMenu(null)
  }

  function handleReset() {
    dispatch({ type: ACTIONS.RESET_CHARTER_ASSIGNMENT })
  }

  return (
    <div
      style={{
        width:         300,
        flexShrink:    0,
        height:        '100vh',
        background:    '#fff',
        boxShadow:     '2px 0 10px rgba(0,0,0,0.08)',
        display:       'flex',
        flexDirection: 'column',
        zIndex:        10,
        animation:     'slideInFromLeft 220ms ease-out',
      }}
    >
      {/* Header */}
      <div style={{ padding: '15px 20px 12px', borderBottom: '1px solid #e5e7eb', flexShrink: 0 }}>
        <h1 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: '#111827' }}>
          Sin asignar
        </h1>
        <p style={{ fontSize: 12, color: '#6b7280', margin: '3px 0 0' }}>
          {pendingCount} de {totalCount} pendientes
        </p>
      </div>

      {/* Employee list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
        {pendingCount === 0 ? (
          <div style={{
            padding: '16px', textAlign: 'center',
            background: '#f0fdf4', border: '1px solid #bbf7d0',
            borderRadius: 8, color: '#166534',
          }}>
            <p style={{ fontSize: 14, fontWeight: 600, margin: '0 0 2px' }}>Todos asignados ✓</p>
            <p style={{ fontSize: 12, margin: 0 }}>Todos los empleados tienen un punto.</p>
          </div>
        ) : (
          unassigned.map((emp) => {
            const name    = `${emp.Nombre} ${emp.Apellido}`
            const isOpen  = openMenu === name

            return (
              <div key={name} style={{ marginBottom: 6 }}>
                {/* Employee row */}
                <button
                  onClick={() => setOpenMenu(isOpen ? null : name)}
                  style={{
                    width:        '100%',
                    textAlign:    'left',
                    padding:      '10px 12px',
                    background:   isOpen ? '#eff6ff' : '#f9fafb',
                    border:       isOpen ? '1px solid #93c5fd' : '1px solid #e5e7eb',
                    borderRadius: 8,
                    cursor:       'pointer',
                    transition:   'background 120ms ease',
                  }}
                >
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#111827', margin: 0 }}>
                    {name}
                  </p>
                  <p style={{ fontSize: 11, color: '#6b7280', margin: '2px 0 0' }}>
                    {emp.Profesion}
                  </p>
                </button>

                {/* Assignment dropdown */}
                {isOpen && (
                  <div style={{
                    marginTop:    2,
                    background:   '#fff',
                    border:       '1px solid #e5e7eb',
                    borderRadius: 8,
                    boxShadow:    '0 4px 16px rgba(0,0,0,0.10)',
                    overflow:     'hidden',
                  }}>
                    {/* PE option */}
                    <button
                      onClick={() => handleAssignPe(name)}
                      style={{
                        width: '100%', textAlign: 'left', padding: '10px 14px',
                        background: 'none', border: 'none', borderBottom: '1px solid #f3f4f6',
                        cursor: 'pointer', fontSize: 13, color: '#111827',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#f9fafb' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
                    >
                      Punto de encuentro{ca.meeting_point ? ` (${ca.meeting_point.name})` : ''}
                    </button>

                    {/* Pickup options */}
                    {ca.pickups.map((pu, i) => pu?.point && (
                      <button
                        key={i}
                        onClick={() => handleAssignPickup(name, i)}
                        style={{
                          width: '100%', textAlign: 'left', padding: '10px 14px',
                          background: 'none', border: 'none',
                          borderBottom: i < ca.pickups.length - 1 ? '1px solid #f3f4f6' : 'none',
                          cursor: 'pointer', fontSize: 13, color: '#111827',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = '#f9fafb' }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
                      >
                        Pickup {i + 1} ({pu.point.name ?? pu.point.address})
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid #e5e7eb', flexShrink: 0 }}>
        <button
          onClick={handleReset}
          style={{
            width: '100%', padding: '8px 12px',
            background: 'none', color: '#6b7280',
            border: '1px solid #e5e7eb', borderRadius: 6,
            fontSize: 12, cursor: 'pointer',
            transition: 'background 150ms ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#f9fafb' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
        >
          Reiniciar asignaciones
        </button>
      </div>
    </div>
  )
}
