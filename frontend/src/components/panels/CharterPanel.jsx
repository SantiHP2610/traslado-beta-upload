/**
 * CharterPanel.jsx
 * Full-height left panel shown at step 3 when the remaining staff pool
 * exceeds the vehicle capacity threshold (status === "charter").
 *
 * The panel is informational — it tells the manager that a charter bus is
 * required and provides phone numbers to call.  It does not block navigation
 * or change any state; the back button is still visible so the manager can
 * return to step 2 if needed.
 */

import { AlertTriangle } from 'lucide-react'
import { useAppState }   from '../../state/appState'

// Phone list is defined here rather than fetched from backend because it is
// a display-only constant that doesn't affect business logic.  config.py also
// holds the authoritative list; this mirrors it for the frontend.
const CHARTER_PHONES = [
  { name: 'Transfer Express',    phone: '(011) 4555-0100' },
  { name: 'Buenos Aires Bus',    phone: '(011) 4314-5555' },
  { name: 'Chevallier Integral', phone: '(011) 4000-5255' },
]

export default function CharterPanel() {
  const { state } = useAppState()
  const pool  = state.remainingPool
  const count = pool?.remaining_count ?? pool?.remaining_pool?.length ?? 0

  return (
    <div
      style={{
        width:         380,
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
          padding:      '16px 20px 14px',
          background:   '#FEF2F2',
          borderBottom: '1px solid #FECACA',
          flexShrink:   0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <AlertTriangle size={20} color="#DC2626" style={{ flexShrink: 0 }} />
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#991B1B', margin: 0 }}>
            Se requiere servicio de charter
          </h2>
        </div>
        <p style={{ fontSize: 13, color: '#B91C1C', margin: 0, lineHeight: 1.4 }}>
          {count > 0
            ? `${count} personas en el equipo superan la capacidad de un vehículo`
            : 'El equipo supera la capacidad de los vehículos disponibles'}
        </p>
      </div>

      {/* ── Explanation ─────────────────────────────────────────────────── */}
      <div
        style={{
          padding:      '16px 20px',
          borderBottom: '1px solid #e5e7eb',
          flexShrink:   0,
        }}
      >
        <p style={{ fontSize: 13, color: '#374151', lineHeight: 1.55, margin: 0 }}>
          El tamaño del equipo de trabajo supera la capacidad combinada de los
          vehículos disponibles. Contactar a una empresa de transporte para
          coordinar el traslado del grupo completo.
        </p>
      </div>

      {/* ── Phone list ──────────────────────────────────────────────────── */}
      <div style={{ padding: '16px 20px', flex: 1, overflowY: 'auto' }}>
        <p
          style={{
            fontSize:      12,
            fontWeight:    600,
            color:         '#6B7280',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom:  12,
            marginTop:     0,
          }}
        >
          Empresas de charter
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {CHARTER_PHONES.map((item) => (
            <div
              key={item.name}
              style={{
                display:      'flex',
                alignItems:   'center',
                justifyContent: 'space-between',
                padding:      '10px 14px',
                background:   '#F9FAFB',
                border:       '1px solid #E5E7EB',
                borderRadius: 8,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>
                {item.name}
              </span>
              <span
                style={{
                  fontSize:   13,
                  color:      '#1D4ED8',
                  fontFamily: 'monospace',
                  fontWeight: 500,
                }}
              >
                {item.phone}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Note ────────────────────────────────────────────────────────── */}
      <div
        style={{
          padding:      '12px 20px',
          borderTop:    '1px solid #e5e7eb',
          flexShrink:   0,
        }}
      >
        <p
          style={{
            fontSize:  12,
            color:     '#9CA3AF',
            fontStyle: 'italic',
            margin:    0,
            lineHeight: 1.5,
          }}
        >
          Confirmar disponibilidad y tarifa con cada empresa antes de comprometerse.
        </p>
      </div>
    </div>
  )
}
