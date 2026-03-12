/**
 * UnassignedPanel.jsx
 * Zone A — left panel for step 3 (passenger assignment).
 *
 * Pure rendering component: receives all data and handlers as props from
 * AppMap (which calls useAssignmentLogic).  Displays all employees not yet
 * assigned to car, Uber, or pickup, each with a blue dot matching their
 * unassigned map marker color.  Employees disappear from this list as the
 * manager assigns them via the context menu on the map.
 *
 * "Reiniciar asignaciones" clears all car/Uber/pickup assignments so the
 * manager can start over.  The button is disabled when nothing is assigned.
 */

import { RotateCcw } from 'lucide-react'

function fullName(emp) {
  return `${emp.Nombre} ${emp.Apellido}`
}

export default function UnassignedPanel({ unassigned, hasAnyAssigned, onReset, totalToAssign }) {
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
              fontSize:   13,
              color:      '#9ca3af',
              fontStyle:  'italic',
              textAlign:  'center',
              marginTop:  32,
            }}
          >
            Todos asignados ✓
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {unassigned.map((emp) => (
              <div key={fullName(emp)} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                {/* Blue dot — matches unassigned marker color */}
                <span
                  style={{
                    width:     8,
                    height:    8,
                    borderRadius: '50%',
                    background: '#3b82f6',
                    flexShrink: 0,
                  }}
                />
                <div>
                  <p
                    style={{
                      fontSize:   13,
                      fontWeight: 500,
                      margin:     0,
                      color:      '#111827',
                      lineHeight: 1.3,
                    }}
                  >
                    {fullName(emp)}
                  </p>
                  <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
                    {emp.Profesion}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Footer: reset button ────────────────────────────────────────── */}
      <div
        style={{
          padding:      '12px 20px',
          borderTop:    '1px solid #e5e7eb',
          flexShrink:   0,
        }}
      >
        <button
          onClick={onReset}
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
              e.currentTarget.style.background = '#f9fafb'
              e.currentTarget.style.borderColor = '#9ca3af'
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'none'
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
