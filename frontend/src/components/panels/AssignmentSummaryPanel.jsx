/**
 * AssignmentSummaryPanel.jsx
 * Zone C — right panel for step 3 (passenger assignment).
 *
 * Receives all assignment data and handlers as props from AppMap (which calls
 * useAssignmentLogic).  Renders four sections as they populate:
 *   1. Vehículo propio — driver (auto-assigned green) + car passengers
 *   2. Uber — grouped in 4s; solo-group highlighted amber after Phase-2 check
 *   3. Pickup — only when a pickup employee/place is confirmed
 *   4. Pendiente — only when pending_employee is set
 *
 * The validate button and the two-button solo-passenger choice live here
 * (sticky footer) so the manager can always reach them without scrolling.
 *
 * PickupResultPanel is rendered inline at the top of this panel when
 * activePickupResult is set — the manager reviews and confirms the pickup
 * venue without leaving the assignment context.
 */

import { useAppState, ACTIONS } from '../../state/appState'
import PickupResultPanel        from './PickupResultPanel'

function fullName(emp) {
  return `${emp.Nombre} ${emp.Apellido}`
}

// Small colored dot + employee name/role row
function EmployeeRow({ name, profesion, dotColor, badge }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span
        style={{
          width:      8,
          height:     8,
          borderRadius: '50%',
          background: dotColor,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            fontSize:   13,
            fontWeight: 500,
            margin:     0,
            color:      '#111827',
            lineHeight: 1.3,
          }}
        >
          {name}
        </p>
        {profesion && (
          <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>{profesion}</p>
        )}
      </div>
      {badge && (
        <span
          style={{
            fontSize:   10,
            fontWeight: 700,
            background: '#dcfce7',
            color:      '#166534',
            padding:    '2px 7px',
            borderRadius: 4,
            flexShrink: 0,
          }}
        >
          {badge}
        </span>
      )}
    </div>
  )
}

function SectionHeader({ children }) {
  return (
    <p
      style={{
        fontSize:      11,
        fontWeight:    700,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color:         '#6b7280',
        margin:        '0 0 10px',
      }}
    >
      {children}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AssignmentSummaryPanel({
  driver         = null,
  carPassengers  = [],
  uberPassengers = [],
  uberGroups     = [],
  pickupEmployee = null,
  pickupPlace    = null,
  hasVehicle     = false,
  vehicleLabel   = 'Vehículo',
  showSoloChoice = false,
  validating     = false,
  assignedCount  = 0,
  totalToAssign  = 0,
  onValidate,
  onPendiente,
  onContinueWithSolo,
  unassigned  = [],
  assignments = null,
}) {
  const { state, dispatch } = useAppState()
  const { error, activePickupResult, manualPickupMode } = state
  const pendingEmployee = assignments?.pending_employee ?? null

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
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: '#111827' }}>
          Asignaciones
        </h2>
        <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>
          {assignedCount} de {totalToAssign} asignados
        </p>
      </div>

      {/* ── Scrollable content ──────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px' }}>

        {/* ── Manual pickup mode banner ────────────────────────────────── */}
        {manualPickupMode && (
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
              onClick={() => dispatch({ type: ACTIONS.SET_MANUAL_PICKUP_MODE, payload: false })}
              style={{
                fontSize:   12,
                color:      '#2563eb',
                background: 'none',
                border:     'none',
                padding:    0,
                cursor:     'pointer',
                textDecoration: 'underline',
              }}
            >
              Cancelar
            </button>
          </div>
        )}

        {/* ── Inline pickup result panel ──────────────────────────────── */}
        {activePickupResult && (
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

        {/* ── Personal vehicle section ─────────────────────────────────── */}
        {hasVehicle && (
          <section style={{ marginBottom: 20 }}>
            <SectionHeader>Vehículo propio</SectionHeader>
            <p
              style={{
                fontSize:   12,
                color:      '#374151',
                fontStyle:  'italic',
                margin:     '0 0 10px',
              }}
            >
              {vehicleLabel}
            </p>
            {driver && (
              <EmployeeRow
                name={fullName(driver)}
                profesion={driver.Profesion}
                dotColor="#22c55e"
                badge="Chofer"
              />
            )}
            {carPassengers.map((emp) => (
              <EmployeeRow
                key={fullName(emp)}
                name={fullName(emp)}
                profesion={emp.Profesion}
                dotColor="#22c55e"
              />
            ))}
            {carPassengers.length === 0 && (
              <p style={{ fontSize: 12, color: '#9ca3af', marginLeft: 17, marginBottom: 4 }}>
                Sin pasajeros asignados
              </p>
            )}
            <p style={{ fontSize: 12, color: '#9ca3af', marginLeft: 17, marginTop: 2 }}>
              {carPassengers.length}/4 pasajeros
            </p>
          </section>
        )}

        {/* ── Uber section ─────────────────────────────────────────────── */}
        <section style={{ marginBottom: 20 }}>
          <SectionHeader>
            Uber ({uberPassengers.length}{' '}
            {uberPassengers.length === 1 ? 'pasajero' : 'pasajeros'})
          </SectionHeader>

          {uberPassengers.length === 0 ? (
            <p style={{ fontSize: 13, color: '#9ca3af' }}>Sin pasajeros asignados</p>
          ) : (
            uberGroups.map((group, gi) => {
              const isSoloWarning = showSoloChoice && group.length === 1
              return (
                <div
                  key={gi}
                  style={{
                    marginBottom: 8,
                    ...(isSoloWarning
                      ? {
                          border:       '1px solid #f59e0b',
                          background:   '#fffbeb',
                          borderRadius: 8,
                          padding:      '8px 10px',
                        }
                      : {}),
                  }}
                >
                  {uberGroups.length > 1 && (
                    <p
                      style={{
                        fontSize:   12,
                        fontWeight: isSoloWarning ? 700 : 500,
                        color:      isSoloWarning ? '#b45309' : '#374151',
                        margin:     '0 0 5px',
                      }}
                    >
                      Uber {gi + 1}{isSoloWarning ? ' ⚠️' : ''}
                    </p>
                  )}
                  {group.map((emp) => (
                    <EmployeeRow
                      key={fullName(emp)}
                      name={fullName(emp)}
                      profesion={emp.Profesion}
                      dotColor={isSoloWarning ? '#f59e0b' : '#9ca3af'}
                    />
                  ))}
                </div>
              )
            })
          )}
        </section>

        {/* ── Pickup section ───────────────────────────────────────────── */}
        {pickupEmployee ? (
          <section style={{ marginBottom: 20 }}>
            <SectionHeader>Pickup en ruta</SectionHeader>
            <EmployeeRow
              name={fullName(pickupEmployee)}
              profesion={pickupEmployee.Profesion}
              dotColor="#fbbf24"
            />
            {pickupPlace && (
              <p style={{ fontSize: 12, color: '#6b7280', marginLeft: 17 }}>
                {pickupPlace.place_name}
              </p>
            )}
          </section>
        ) : hasVehicle && !showSoloChoice && (
          <section style={{ marginBottom: 20 }}>
            <SectionHeader>Pickup en ruta</SectionHeader>
            <button
              onClick={() => dispatch({ type: ACTIONS.SET_MANUAL_PICKUP_MODE, payload: true })}
              disabled={manualPickupMode}
              style={{
                display:      'flex',
                alignItems:   'center',
                gap:          6,
                fontSize:     12,
                color:        manualPickupMode ? '#9ca3af' : '#374151',
                background:   '#f9fafb',
                border:       '1px solid #e5e7eb',
                borderRadius: 6,
                padding:      '7px 12px',
                cursor:       manualPickupMode ? 'default' : 'pointer',
                width:        '100%',
                transition:   'background 150ms ease',
              }}
              onMouseEnter={(e) => { if (!manualPickupMode) e.currentTarget.style.background = '#f3f4f6' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#f9fafb' }}
            >
              <span style={{ fontSize: 14 }}>📍</span>
              Elegir pickup en mapa
            </button>
          </section>
        )}

        {/* ── Pending employee ─────────────────────────────────────────── */}
        {pendingEmployee && (
          <section
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
            <EmployeeRow
              name={fullName(pendingEmployee)}
              profesion={pendingEmployee.Profesion}
              dotColor="#fbbf24"
            />
            <p style={{ fontSize: 12, color: '#b45309', margin: 0 }}>
              Transporte alternativo a coordinar
            </p>
          </section>
        )}

        {/* ── Error ───────────────────────────────────────────────────── */}
        {error && (
          <p style={{ fontSize: 12, color: '#dc2626', marginBottom: 8 }}>{error}</p>
        )}
      </div>

      {/* ── Footer: validate button / solo-passenger choice ─────────────── */}
      <div
        style={{
          padding:    '12px 20px',
          borderTop:  '1px solid #e5e7eb',
          flexShrink: 0,
        }}
      >
        {showSoloChoice ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Amber warning banner */}
            <div
              style={{
                background:  '#fffbeb',
                border:      '1px solid #f59e0b',
                borderLeft:  '4px solid #f59e0b',
                borderRadius: 6,
                padding:     '8px 10px',
              }}
            >
              <p style={{ fontSize: 12, color: '#92400e', margin: 0 }}>
                ⚠ Un pasajero quedó solo en Uber. ¿Qué hacemos?
              </p>
            </div>

            <button
              onClick={onPendiente}
              disabled={validating}
              style={{
                width:        '100%',
                padding:      '10px 16px',
                background:   '#111827',
                color:        '#fff',
                border:       'none',
                borderRadius: 8,
                fontSize:     13,
                fontWeight:   500,
                cursor:       validating ? 'default' : 'pointer',
                transition:   'background 150ms ease',
              }}
              onMouseEnter={(e) => { if (!validating) e.currentTarget.style.background = '#374151' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#111827' }}
            >
              Buscar alternativa y dejar pendiente
            </button>

            <button
              onClick={onContinueWithSolo}
              disabled={validating}
              style={{
                width:        '100%',
                padding:      '10px 16px',
                background:   '#fff',
                color:        '#374151',
                border:       '1px solid #d1d5db',
                borderRadius: 8,
                fontSize:     13,
                fontWeight:   500,
                cursor:       validating ? 'default' : 'pointer',
                display:      'flex',
                alignItems:   'center',
                justifyContent: 'center',
                gap:          8,
                transition:   'background 150ms ease',
              }}
              onMouseEnter={(e) => { if (!validating) e.currentTarget.style.background = '#f9fafb' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#fff' }}
            >
              {validating ? (
                <span
                  className="animate-spin"
                  style={{
                    display:     'inline-block',
                    width:       14,
                    height:      14,
                    border:      '2px solid #9ca3af',
                    borderTopColor: 'transparent',
                    borderRadius: '50%',
                  }}
                />
              ) : (
                'Continuar con 1 pasajero en Uber'
              )}
            </button>
          </div>
        ) : (
          <button
            onClick={onValidate}
            disabled={validating}
            style={{
              width:          '100%',
              padding:        '11px 16px',
              background:     '#111827',
              color:          '#fff',
              border:         'none',
              borderRadius:   8,
              fontSize:       14,
              fontWeight:     500,
              cursor:         validating ? 'default' : 'pointer',
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'center',
              gap:            8,
              transition:     'background 150ms ease',
              opacity:        validating ? 0.85 : 1,
            }}
            onMouseEnter={(e) => { if (!validating) e.currentTarget.style.background = '#374151' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#111827' }}
          >
            {validating ? (
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
                Validando...
              </>
            ) : unassigned.length > 0 ? (
              `Asignar ${unassigned.length} restantes a Uber y validar`
            ) : (
              'Validar asignaciones'
            )}
          </button>
        )}
      </div>
    </div>
  )
}
