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
 *   └── UberRoutesSection: appears after PE/PEA is confirmed (chosenMeetingPoint set).
 *       Lets the manager trace a PE→event route for each Uber group before
 *       advancing to step 3.  Once all Ubers have routes the "Continuar" button
 *       enables and dispatches SET_CURRENT_STEP 3.
 */

import { useState, useEffect }             from 'react'
import { ChevronDown, ChevronRight }        from 'lucide-react'
import { useAppState, ACTIONS, VEHICLE_COLORS } from '../../state/appState'
import { simpleRoute, geocodeAddress }      from '../../api/endpoints'
import FrescosPanel                         from './FrescosPanel'
import PeaPanel                             from './PeaPanel'
import { CabaPanel }                        from './CabaPanel'
import { CabaPeSelectionPanel }             from './CabaPeSelectionPanel'

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
      {(event.fecha || event.hora_inicio) && (
        <p style={{ fontSize: 13, fontWeight: 600, color: '#111827', margin: '0 0 3px' }}>
          {[event.fecha, event.hora_inicio].filter(Boolean).join(' · ')}
        </p>
      )}
      {event.tipo && (
        <p style={{ fontSize: 12, color: '#374151', margin: '0 0 2px' }}>
          {event.tipo}
          {event.comensales ? ` · ${event.comensales} comensales` : ''}
        </p>
      )}
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
            <ul style={{ margin: '4px 0 0', padding: '0 0 0 10px', listStyle: 'none' }}>
              {services.map((s, i) => (
                <li key={i} style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.5 }}>
                  {s.Servicio}{s.Detalle ? `: ${s.Detalle}` : ''}{s.Cantidad ? ` (${s.Cantidad})` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {event.descripcion_locacion && (
        <p style={{ fontSize: 11, color: '#9ca3af', margin: '5px 0 0', lineHeight: 1.45 }}>
          {event.descripcion_locacion}
        </p>
      )}
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

// ---------------------------------------------------------------------------
// UberRoutesSection — step 2b: trace PE→event routes for each Uber vehicle
// before advancing to step 3.
//
// Displayed only after chosenMeetingPoint is set (vehicles already initialised
// by the Sidebar useEffect).  One card per Uber vehicle with:
//   • "Trazar desde PE" — calls /simple-route from the ORIGINAL PE (meetingPoint,
//     not the chosen PEA if a PEA was selected — Ubers always depart from the
//     original PE) to the event coords, then dispatches SET_VEHICLE_ROUTE.
//   • "Elegir otro PE" — inline geocode form → SET_VEHICLE_MEETING_POINT + route.
//   • "Volver al PE original" — RESET_VEHICLE_MEETING_POINT.
// "Continuar a asignación →" is enabled once every Uber has a route.
// ---------------------------------------------------------------------------

function UberRoutesSection() {
  const { state, dispatch } = useAppState()

  const [tracingRoute, setTracingRoute] = useState({})   // vehicle_id → bool
  const [editMode,     setEditMode]     = useState({})   // vehicle_id → bool
  const [addrInputs,   setAddrInputs]   = useState({})   // vehicle_id → string
  const [geocoding,    setGeocoding]    = useState({})   // vehicle_id → bool
  const [geoErrors,    setGeoErrors]    = useState({})   // vehicle_id → string
  const [routeErrors,  setRouteErrors]  = useState({})   // vehicle_id → string

  const uberVehicles    = state.vehicles.filter((v) => v.type === 'uber')
  const allHaveRoutes   = uberVehicles.every((v) => v.route !== null)
  const canContinue     = uberVehicles.length === 0 || allHaveRoutes

  async function handleTraceFromPE(vehicleId) {
    if (!state.eventCoords || !state.meetingPoint) return
    setTracingRoute((prev) => ({ ...prev, [vehicleId]: true }))
    setRouteErrors((prev)  => ({ ...prev, [vehicleId]: null  }))
    try {
      const result = await simpleRoute(
        state.meetingPoint.lat, state.meetingPoint.lng,
        state.eventCoords.lat,  state.eventCoords.lng,
      )
      dispatch({ type: ACTIONS.SET_VEHICLE_ROUTE, payload: { vehicle_id: vehicleId, route: result } })
    } catch {
      setRouteErrors((prev) => ({ ...prev, [vehicleId]: 'No se pudo trazar la ruta.' }))
    } finally {
      setTracingRoute((prev) => ({ ...prev, [vehicleId]: false }))
    }
  }

  async function handleGeocode(vehicleId) {
    const address = addrInputs[vehicleId]?.trim() ?? ''
    if (!address) return
    setGeocoding((prev)  => ({ ...prev, [vehicleId]: true  }))
    setGeoErrors((prev)  => ({ ...prev, [vehicleId]: null  }))
    try {
      const geo    = await geocodeAddress(address)
      const newMp  = {
        name:    address,
        address: geo.formatted_address ?? address,
        lat:     geo.lat,
        lng:     geo.lng,
      }
      dispatch({ type: ACTIONS.SET_VEHICLE_MEETING_POINT, payload: { vehicle_id: vehicleId, meeting_point: newMp } })
      if (state.eventCoords) {
        const route = await simpleRoute(geo.lat, geo.lng, state.eventCoords.lat, state.eventCoords.lng)
        dispatch({ type: ACTIONS.SET_VEHICLE_ROUTE, payload: { vehicle_id: vehicleId, route } })
      }
      setEditMode((prev) => ({ ...prev, [vehicleId]: false }))
    } catch {
      setGeoErrors((prev) => ({ ...prev, [vehicleId]: 'No se pudo geocodificar la dirección.' }))
    } finally {
      setGeocoding((prev) => ({ ...prev, [vehicleId]: false }))
    }
  }

  function handleResetToPE(vehicleId) {
    dispatch({ type: ACTIONS.RESET_VEHICLE_MEETING_POINT, payload: { vehicle_id: vehicleId } })
    setEditMode((prev) => ({ ...prev, [vehicleId]: false }))
  }

  const uberLabel = uberVehicles.length === 1
    ? '1 Uber'
    : `${uberVehicles.length} Ubers`

  return (
    <div
      style={{
        padding:      '16px 20px',
        borderTop:    '1px solid #e5e7eb',
        animation:    'fadeIn 200ms ease-out',
      }}
    >
      <p style={{ fontSize: 14, fontWeight: 600, color: '#111827', margin: '0 0 12px' }}>
        Rutas de vehículos{uberVehicles.length > 0 ? ` (${uberLabel})` : ''}
      </p>

      {uberVehicles.length === 0 ? (
        <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 16px' }}>
          No hay Ubers — todos viajan en el vehículo personal.
        </p>
      ) : (
        uberVehicles.map((v) => {
          const uberNum   = v.id.replace('uber_', '')
          const isTracing = tracingRoute[v.id]
          const isGeo     = geocoding[v.id]
          const isEditing = editMode[v.id]
          const hasRoute  = v.route !== null
          const dotColor  = VEHICLE_COLORS[v.id]?.route ?? '#2D2D2D'

          return (
            <div key={v.id} style={{ marginBottom: 16 }}>
              {/* ── Row: color dot + label + status ─────────────────────── */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: dotColor, flexShrink: 0,
                }} />
                <p style={{ fontSize: 13, fontWeight: 600, color: '#111827', margin: 0 }}>
                  Uber {uberNum}
                </p>
                {hasRoute
                  ? <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>✓ Ruta trazada</span>
                  : <span style={{ fontSize: 11, color: '#9ca3af' }}>○ Sin ruta</span>
                }
              </div>

              {/* ── Custom PE label ──────────────────────────────────────── */}
              {v.custom_meeting_point && (
                <p style={{ fontSize: 11, color: '#2563eb', margin: '0 0 6px 18px', lineHeight: 1.4 }}>
                  📍 {v.meeting_point?.name || v.meeting_point?.address}
                </p>
              )}

              {routeErrors[v.id] && (
                <p style={{ fontSize: 11, color: '#dc2626', margin: '0 0 4px 18px' }}>
                  {routeErrors[v.id]}
                </p>
              )}

              {/* ── Action buttons / geocode form ────────────────────────── */}
              {!isEditing ? (
                <div style={{ display: 'flex', gap: 6, marginLeft: 18 }}>
                  <button
                    onClick={() => handleTraceFromPE(v.id)}
                    disabled={isTracing}
                    style={{
                      flex:         1,
                      fontSize:     11,
                      padding:      '5px 0',
                      background:   hasRoute ? '#f3f4f6' : '#111827',
                      color:        hasRoute ? '#374151' : '#fff',
                      border:       hasRoute ? '1px solid #d1d5db' : 'none',
                      borderRadius: 6,
                      cursor:       isTracing ? 'default' : 'pointer',
                      opacity:      isTracing ? 0.7 : 1,
                    }}
                  >
                    {isTracing ? 'Trazando…' : hasRoute ? '↺ Volver a trazar' : 'Trazar desde PE'}
                  </button>
                  <button
                    onClick={() => {
                      setAddrInputs((prev) => ({ ...prev, [v.id]: v.meeting_point?.address ?? '' }))
                      setGeoErrors((prev)  => ({ ...prev, [v.id]: null }))
                      setEditMode((prev)   => ({ ...prev, [v.id]: true }))
                    }}
                    style={{
                      flex:         1,
                      fontSize:     11,
                      padding:      '5px 0',
                      background:   '#fff',
                      color:        '#374151',
                      border:       '1px solid #d1d5db',
                      borderRadius: 6,
                      cursor:       'pointer',
                    }}
                  >
                    Elegir otro PE
                  </button>
                </div>
              ) : (
                <div style={{ marginLeft: 18 }}>
                  <input
                    value={addrInputs[v.id] ?? ''}
                    onChange={(e) => setAddrInputs((prev) => ({ ...prev, [v.id]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleGeocode(v.id) }}
                    placeholder="Dirección del punto de encuentro"
                    style={{
                      width:        '100%',
                      fontSize:     12,
                      padding:      '5px 8px',
                      border:       '1px solid #d1d5db',
                      borderRadius: 6,
                      outline:      'none',
                      boxSizing:    'border-box',
                      marginBottom: 5,
                    }}
                  />
                  {geoErrors[v.id] && (
                    <p style={{ fontSize: 11, color: '#dc2626', margin: '0 0 4px' }}>
                      {geoErrors[v.id]}
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                    <button
                      onClick={() => handleGeocode(v.id)}
                      disabled={isGeo}
                      style={{
                        flex:         1,
                        fontSize:     11,
                        padding:      '5px 0',
                        background:   isGeo ? '#e5e7eb' : '#111827',
                        color:        isGeo ? '#9ca3af' : '#fff',
                        border:       'none',
                        borderRadius: 6,
                        cursor:       isGeo ? 'default' : 'pointer',
                      }}
                    >
                      {isGeo ? 'Geocodificando…' : 'Geocodificar'}
                    </button>
                    <button
                      onClick={() => setEditMode((prev) => ({ ...prev, [v.id]: false }))}
                      style={{
                        flex:         1,
                        fontSize:     11,
                        padding:      '5px 0',
                        background:   '#fff',
                        color:        '#374151',
                        border:       '1px solid #d1d5db',
                        borderRadius: 6,
                        cursor:       'pointer',
                      }}
                    >
                      Cancelar
                    </button>
                  </div>
                  {v.custom_meeting_point && (
                    <button
                      onClick={() => handleResetToPE(v.id)}
                      style={{
                        display:        'block',
                        width:          '100%',
                        fontSize:       11,
                        padding:        '3px 0',
                        background:     'none',
                        color:          '#6b7280',
                        border:         'none',
                        cursor:         'pointer',
                        textDecoration: 'underline',
                        textAlign:      'center',
                      }}
                    >
                      Volver al PE original
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })
      )}

      {/* ── Continue button ───────────────────────────────────────────────── */}
      <button
        onClick={() => dispatch({ type: ACTIONS.SET_CURRENT_STEP, payload: 3 })}
        disabled={!canContinue}
        style={{
          width:        '100%',
          padding:      '11px 16px',
          background:   canContinue ? '#111827' : '#e5e7eb',
          color:        canContinue ? '#fff'     : '#9ca3af',
          border:       'none',
          borderRadius: 8,
          fontSize:     14,
          fontWeight:   500,
          cursor:       canContinue ? 'pointer' : 'default',
          marginTop:    4,
          transition:   'background 150ms ease',
        }}
        onMouseEnter={(e) => { if (canContinue) e.currentTarget.style.background = '#374151' }}
        onMouseLeave={(e) => { if (canContinue) e.currentTarget.style.background = '#111827' }}
      >
        Continuar a asignación →
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sidebar — main export
// ---------------------------------------------------------------------------

export default function Sidebar() {
  const { state, dispatch } = useAppState()
  const [step1Open, setStep1Open] = useState(true)

  const step1Done = state.currentStep > 1
  const fr        = state.frescosResult
  const event     = state.excelData?.event
  const services  = state.excelData?.services ?? []
  const isCaba    = !!event?.is_caba

  // ── INIT_VEHICLES trigger ────────────────────────────────────────────────
  // Fires once when the manager confirms a PE or PEA (chosenMeetingPoint set)
  // while vehicles is still empty.  Builds the vehicles array and immediately
  // sets the personal vehicle's route from the already-computed driverRoutes.
  useEffect(() => {
    if (!state.chosenMeetingPoint) return
    if (state.vehicles.length > 0) return
    if (!state.remainingPool)      return

    const pool_count           = state.remainingPool.remaining_pool?.length ?? 0
    const has_personal_vehicle = state.personalVehicle?.has_personal_vehicle ?? false
    const driverObj            = state.personalVehicle?.driver
    const driver               = driverObj
      ? `${driverObj.Nombre} ${driverObj.Apellido}`
      : null
    const vehicle_description  = state.personalVehicle?.vehicle_description ?? null

    dispatch({
      type:    ACTIONS.INIT_VEHICLES,
      payload: { pool_count, has_personal_vehicle, driver, vehicle_description, chosenMeetingPoint: state.chosenMeetingPoint },
    })

    // Seed the personal vehicle's route from the step-2a driver routes so
    // canValidate's "vehicles with passengers must have routes" check passes.
    if (has_personal_vehicle && state.driverRoutes) {
      const isPea  = state.meetingPoint &&
        state.chosenMeetingPoint?.name !== state.meetingPoint?.name
      const route  = isPea ? state.driverRoutes.direct_route : state.driverRoutes.base_route
      if (route) {
        dispatch({ type: ACTIONS.SET_VEHICLE_ROUTE, payload: { vehicle_id: 'personal', route } })
      }
    }
  }, [state.chosenMeetingPoint]) // eslint-disable-line react-hooks/exhaustive-deps

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
                  ? <ChevronDown  size={15} color="#9ca3af" />
                  : <ChevronRight size={15} color="#9ca3af" />
                }
              </button>
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
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb' }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#111827', margin: '0 0 12px' }}>
                Vehículo de Frescos
              </p>
              <FrescosPanel />
            </div>
          )}
        </div>

        {/* ── Step 2: Punto de encuentro ───────────────────────────────── */}
        {state.currentStep >= 2 && (
          <div style={{ padding: '16px 20px', animation: 'fadeIn 200ms ease-out' }}>
            {isCaba && !state.cabaDecisionToTransport
              ? <CabaPanel />
              : isCaba && state.cabaDecisionToTransport && !state.chosenMeetingPoint
                ? <CabaPeSelectionPanel />
                : !isCaba
                  ? <PeaPanel />
                  : null
            }
          </div>
        )}

        {/* ── Step 2b: Uber route tracing ───────────────────────────────── */}
        {/* Shown once chosenMeetingPoint is confirmed and vehicles are ready. */}
        {state.currentStep >= 2 && state.chosenMeetingPoint && state.vehicles.length > 0 && (
          <UberRoutesSection />
        )}
      </div>
    </div>
  )
}
