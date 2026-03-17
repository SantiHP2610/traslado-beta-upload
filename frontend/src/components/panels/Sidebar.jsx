/**
 * Sidebar.jsx
 * Steps 1-2 left sidebar — full height, ~380px wide.
 *
 * Layout:
 *   Fixed header (app title + event summary)
 *   └── Step 1 section: FrescosPanel content
 *       • Before step 1 is done: full content, no collapse
 *       • After step 1 is done: collapsed to a one-line summary with chevron;
 *         clicking the header row expands/collapses inline
 *   └── Step 2 section: PeaPanel content (only visible from step 2)
 *       Fades in below step 1 once currentStep >= 2.
 *
 * FrescosPanel and PeaPanel are rendered without their former Card/absolute
 * wrappers — they render flat content that the sidebar provides structure for.
 */

import { useState }                    from 'react'
import { ChevronDown, ChevronRight }   from 'lucide-react'
import { useAppState }                 from '../../state/appState'
import FrescosPanel                    from './FrescosPanel'
import PeaPanel                        from './PeaPanel'

// ---------------------------------------------------------------------------
// EventInfoSection — compact event summary at the top of the sidebar
// ---------------------------------------------------------------------------

function EventInfoSection({ event, services }) {
  const [prestOpen, setPrestOpen] = useState(false)

  if (!event) return null

  const observaciones = Array.isArray(event.observaciones)
    ? event.observaciones
    : event.observaciones
      ? [event.observaciones]
      : []

  return (
    <div
      style={{
        padding:      '12px 20px 14px',
        borderBottom: '1px solid #e5e7eb',
        flexShrink:   0,
      }}
    >
      {/* Date + time — bold, same line */}
      {(event.fecha || event.hora_inicio) && (
        <p style={{ fontSize: 13, fontWeight: 600, color: '#111827', margin: '0 0 3px' }}>
          {[event.fecha, event.hora_inicio].filter(Boolean).join(' · ')}
        </p>
      )}

      {/* Menu type */}
      {event.tipo && (
        <p style={{ fontSize: 12, color: '#374151', margin: '0 0 2px' }}>
          {event.tipo}
          {event.comensales ? ` · ${event.comensales} comensales` : ''}
        </p>
      )}

      {/* Prestaciones — collapsible */}
      {services && services.length > 0 && (
        <div style={{ marginTop: 5 }}>
          <button
            onClick={() => setPrestOpen((v) => !v)}
            style={{
              fontSize:   11,
              color:      '#6b7280',
              background: 'none',
              border:     'none',
              cursor:     'pointer',
              padding:    0,
              display:    'flex',
              alignItems: 'center',
              gap:        3,
            }}
          >
            {prestOpen ? '▾' : '▸'} Ver prestaciones ({services.length})
          </button>
          {prestOpen && (
            <ul
              style={{
                margin:     '4px 0 0',
                padding:    '0 0 0 10px',
                listStyle:  'none',
              }}
            >
              {services.map((s, i) => (
                <li key={i} style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.5 }}>
                  {s.Servicio}{s.Detalle ? `: ${s.Detalle}` : ''}{s.Cantidad ? ` (${s.Cantidad})` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Descripción del lugar */}
      {event.descripcion_locacion && (
        <p style={{ fontSize: 11, color: '#9ca3af', margin: '5px 0 0', lineHeight: 1.45 }}>
          {event.descripcion_locacion}
        </p>
      )}

      {/* Observaciones */}
      {observaciones.length > 0 && (
        <div style={{ marginTop: 4 }}>
          {observaciones.map((obs, i) => (
            <p key={i} style={{ fontSize: 11, color: '#9ca3af', margin: '1px 0', lineHeight: 1.45 }}>
              {obs}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Sidebar() {
  const { state }    = useAppState()
  const [step1Open, setStep1Open] = useState(true)

  const step1Done = state.currentStep > 1
  const fr        = state.frescosResult
  const event     = state.excelData?.event
  const services  = state.excelData?.services ?? []

  return (
    <div
      style={{
        width:         380,
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
      {/* ── App header ──────────────────────────────────────────────────── */}
      <div
        style={{
          padding:      '15px 20px 10px',
          borderBottom: '1px solid #e5e7eb',
          flexShrink:   0,
        }}
      >
        <h1 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: '#111827' }}>
          Plan de traslado
        </h1>
      </div>

      {/* ── Scrollable body ─────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* ── Event info ──────────────────────────────────────────────── */}
        <EventInfoSection event={event} services={services} />

        {/* ── Step 1: Vehículo de Frescos ─────────────────────────────── */}
        <div>
          {step1Done ? (
            <>
              {/* Collapsed / expandable header row */}
              <button
                onClick={() => setStep1Open((v) => !v)}
                style={{
                  width:          '100%',
                  display:        'flex',
                  alignItems:     'center',
                  justifyContent: 'space-between',
                  padding:        '10px 20px',
                  background:     '#f9fafb',
                  border:         'none',
                  borderBottom:   '1px solid #e5e7eb',
                  cursor:         'pointer',
                  textAlign:      'left',
                  transition:     'background 150ms ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#f3f4f6' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = '#f9fafb' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
                    Vehículo de Frescos
                  </span>
                  {fr && (
                    <span style={{ fontSize: 12, color: '#6b7280' }}>
                      — {fr.vehicle === 'camioneta propia' ? 'Vehículo QH' : 'Miniflete'}
                    </span>
                  )}
                </div>
                {step1Open
                  ? <ChevronDown size={15} color="#9ca3af" />
                  : <ChevronRight size={15} color="#9ca3af" />
                }
              </button>

              {/* Expandable body */}
              {step1Open && (
                <div
                  style={{
                    padding:      '14px 20px',
                    borderBottom: '1px solid #e5e7eb',
                    animation:    'fadeIn 180ms ease-out',
                  }}
                >
                  <FrescosPanel />
                </div>
              )}
            </>
          ) : (
            /* Step 1 not yet done — full content, no collapse */
            <div
              style={{
                padding:      '16px 20px',
                borderBottom: '1px solid #e5e7eb',
              }}
            >
              <p
                style={{
                  fontSize:   14,
                  fontWeight: 600,
                  color:      '#111827',
                  margin:     '0 0 12px',
                }}
              >
                Vehículo de Frescos
              </p>
              <FrescosPanel />
            </div>
          )}
        </div>

        {/* ── Step 2: Punto de encuentro ───────────────────────────────── */}
        {state.currentStep >= 2 && (
          <div
            style={{
              padding:   '16px 20px',
              animation: 'fadeIn 200ms ease-out',
            }}
          >
            <PeaPanel />
          </div>
        )}
      </div>
    </div>
  )
}
