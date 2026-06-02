/**
 * StaffMarkers.jsx
 * Renders one AdvancedMarker per geocoded employee.
 *
 * ── Marker behavior by step ──────────────────────────────────────────────────
 * Step 1-2: clicking a marker opens an InfoWindow with employee info
 *           (name, profession, address).  No actions — at this stage the
 *           user is still deciding the meeting point, not assigning seats.
 * Step 3+:  clicking a marker opens a context menu with assignment actions.
 *           The driver's marker shows no actions (auto-assigned on step start).
 *
 * ── Marker color coding ──────────────────────────────────────────────────────
 * Blue   (#4285F4)        → unassigned (default, steps 1-2, unassigned in step 3)
 * Green  (#34A853)        → driver of the personal vehicle
 * Vehicle color           → passenger on a specific vehicle (from VEHICLE_COLORS)
 * Pickup color            → pickup passenger (vehicle.color.pickup)
 * Washed blue (#B0C4DE)   → frescos-assigned (step 3+); 0.6 opacity, no actions
 *
 * ── Context menu (step 3+) ───────────────────────────────────────────────────
 * Unassigned employees: hierarchical menu — one row per available vehicle,
 * expanding into "→ Punto de encuentro" and (when a pickup point exists)
 * "→ Punto de pickup" sub-options.
 * Assigned employees: single "Quitar asignación" button.
 * Driver: informational text only.
 *
 * ── Marker edit mode ─────────────────────────────────────────────────────────
 * Every marker has an "Editar dirección" link in its InfoWindow.  Clicking it
 * enters edit mode for that employee: the marker becomes draggable and an
 * address text input appears in the InfoWindow.  The user can drag the pin to a
 * new position, or type an address and click "Geocodificar".  Clicking "Listo"
 * or any other marker exits edit mode.  The override is stored in the global
 * coordinateOverrides slice.  "Volver a ubicación original" reverts the marker.
 *
 * ── Animated transitions ─────────────────────────────────────────────────────
 * When a marker's effective position changes (new override set or cleared), it
 * animates ease-out-cubic over 1500ms via useAnimatedPosition().
 *
 * The animation bypasses React state during the transition: lat/lng are
 * interpolated in a requestAnimationFrame loop and written directly to
 * markerRef.current.position on the AdvancedMarkerElement.  React state
 * (snappedPos) is updated exactly once when the animation completes, to keep
 * the position prop coherent for any future re-renders.
 *
 * Why not call setState on every frame?
 *   setState triggers a React re-render → Pin's useEffect runs (its deps
 *   include 'props', a new object on every render) → removeChild fires at
 *   60fps → "removeChild on Node" crash in Google Maps' DOM.
 *
 * Direct mutation works because AdvancedMarker uses usePropBinding to sync
 * marker.position from the 'position' prop.  usePropBinding is dep-tracked
 * ([marker, position]): it only fires when the prop reference changes, not on
 * every render.  While snappedPos is stable, prop binding is dormant and our
 * direct mutations are the sole driver of the marker's screen position.
 */

import { useState, useMemo, useEffect, useRef }  from 'react'
import { AdvancedMarker, InfoWindow }             from '@vis.gl/react-google-maps'
import { User }                                   from 'lucide-react'
import { useAppState, ACTIONS, isVehicleFull } from '../../state/appState'
import { geocodeAddress as geocodeAddressApi }    from '../../api/endpoints'
import { Card, CardContent }                      from '@/components/ui/card'
import { Button }                                 from '@/components/ui/button'

// ---------------------------------------------------------------------------
// Helpers — employee identification
// ---------------------------------------------------------------------------

function fullName(emp) {
  return `${emp.Nombre} ${emp.Apellido}`
}

// ---------------------------------------------------------------------------
// Helpers — vehicle display
// ---------------------------------------------------------------------------

function vehicleLabel(v) {
  if (v.type === 'personal') {
    return v.vehicle_description && v.driver
      ? `${v.vehicle_description} de ${v.driver}`
      : v.vehicle_description ?? 'Vehículo personal'
  }
  if (v.type === 'charter') return 'Charter'
  return `Uber ${v.id.replace('uber_', '')}`
}

function capacityInfo(v) {
  const max     = v.capacity - (v.type === 'personal' ? 1 : 0)
  const current = v.passengers_pe.length + v.pickup.passengers.length
  return `${current}/${max}`
}

// ---------------------------------------------------------------------------
// Marker color helpers
// ---------------------------------------------------------------------------

/**
 * Returns the background hex color for an employee marker based on the current vehicles model.
 * Only called in step 3+ when vehicles is non-empty.
 */
function getMarkerBg(employee, vehicles) {
  const name = fullName(employee)

  const personal = vehicles.find(v => v.type === 'personal')
  if (personal?.driver === name) return '#34A853'

  for (const v of vehicles) {
    // Check multi-pickup slots (charter)
    for (const pu of v.pickups) {
      if (pu.passengers.includes(name)) return v.color.pickup
    }
    if (v.pickup.passengers.includes(name)) return v.color.pickup
    if (v.passengers_pe.includes(name))     return v.color.passengers
  }

  return '#4285F4'
}

/**
 * Returns the background hex color for an employee in charter mode.
 * Yellow  (#FBBC04) → at PE
 * Dark    (#444444) → at a pickup point
 * Blue    (#4285F4) → unassigned
 */

// ---------------------------------------------------------------------------
// useAnimatedPosition — ease-out-cubic marker transition, crash-free
//
// Returns { snappedPos, markerRef }.
//   snappedPos — the position React knows about; only updated at animation end.
//   markerRef  — forward to <AdvancedMarker ref={markerRef}> so the hook can
//                mutate marker.position directly during animation.
//
// During the RAF loop, markerRef.current.position is mutated frame-by-frame
// without touching React state.  This prevents Pin's useEffect from running
// at 60fps and avoids the "removeChild on Node" crash.
// ---------------------------------------------------------------------------

function useAnimatedPosition(targetLat, targetLng) {
  const posRef    = useRef({ lat: targetLat, lng: targetLng })
  const rafRef    = useRef(null)
  const markerRef = useRef(null)

  // snappedPos is only set once per animation (at completion).
  // The position prop on AdvancedMarker always equals snappedPos, so
  // usePropBinding (which is dep-tracked) stays dormant during animation and
  // never fights with our direct marker.position mutations.
  const [snappedPos, setSnappedPos] = useState({ lat: targetLat, lng: targetLng })

  useEffect(() => {
    const start = { ...posRef.current }
    const end   = { lat: targetLat, lng: targetLng }

    if (start.lat === end.lat && start.lng === end.lng) return

    if (rafRef.current) cancelAnimationFrame(rafRef.current)

    const t0       = performance.now()
    const DURATION = 1500
    // ease-out-cubic: fast start that decelerates to a gentle stop.
    const ease     = (t) => 1 - Math.pow(1 - t, 3)

    function step(now) {
      const progress = Math.min((now - t0) / DURATION, 1)
      const e        = ease(progress)
      const current  = {
        lat: start.lat + (end.lat - start.lat) * e,
        lng: start.lng + (end.lng - start.lng) * e,
      }
      posRef.current = current

      // Mutate the marker's position directly — no React state update, no
      // re-render, no Pin useEffect, no removeChild crash.
      if (markerRef.current) {
        markerRef.current.position = current
      }

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step)
      } else {
        rafRef.current = null
        // Sync React state once so future re-renders see the correct position.
        setSnappedPos({ ...current })
      }
    }

    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [targetLat, targetLng])

  return { snappedPos, markerRef }
}

// ---------------------------------------------------------------------------
// EditModeContent — address input + geocode button shown inside InfoWindow
//
// Uses inline styles throughout: InfoWindow renders in Google Maps' own DOM
// subtree where Tailwind utility classes are not guaranteed to apply.
// ---------------------------------------------------------------------------

function EditModeContent({ employee, hasOverride, dispatch, onDone }) {
  const name           = fullName(employee)
  const initialAddress = [employee.Direccion, employee.CP, employee.Ciudad]
    .filter(Boolean).join(', ')

  const [address, setAddress] = useState(initialAddress)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  async function handleGeocode() {
    setLoading(true)
    setError(null)
    try {
      const result = await geocodeAddressApi(address)
      dispatch({
        type:    ACTIONS.SET_COORDINATE_OVERRIDE,
        payload: { name, lat: result.lat, lng: result.lng, source: 'address' },
      })
    } catch {
      setError('No se pudo geocodificar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: 12, minWidth: 240, fontFamily: 'inherit', fontSize: 12 }}>
      <p style={{ fontWeight: 600, marginBottom: 2, fontSize: 13 }}>{name}</p>
      <p style={{ color: '#6b7280', marginBottom: 8 }}>
        Arrastrá el pin o editá la dirección
      </p>

      <input
        type="text"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleGeocode() }}
        style={{
          display: 'block', width: '100%', padding: '4px 8px',
          border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12,
          marginBottom: 6, boxSizing: 'border-box',
        }}
      />

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={handleGeocode}
          disabled={loading}
          style={{
            flex: 1, padding: '5px 10px', background: '#4285F4', color: '#fff',
            border: 'none', borderRadius: 6, fontSize: 12,
            cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? '…' : 'Geocodificar'}
        </button>
        <button
          onClick={onDone}
          style={{
            flex: 1, padding: '5px 10px', background: '#f3f4f6',
            border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, cursor: 'pointer',
          }}
        >
          Listo
        </button>
      </div>

      {error && (
        <p style={{ color: '#dc2626', marginTop: 6, fontSize: 11 }}>{error}</p>
      )}

      {hasOverride && (
        <button
          onClick={() => dispatch({ type: ACTIONS.CLEAR_COORDINATE_OVERRIDE, payload: { name } })}
          style={{
            display: 'block', width: '100%', marginTop: 8, padding: '4px 8px',
            background: 'none', border: '1px solid #d1d5db', borderRadius: 6,
            color: '#6b7280', cursor: 'pointer', fontSize: 11,
          }}
        >
          Volver a ubicación original
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// StaffMarker — one optionally-draggable marker per employee
//
// Extracted from the main map loop so hooks inside can be called safely
// (hooks cannot be called inside a .map() callback in the parent).
// ---------------------------------------------------------------------------

function StaffMarker({
  employee,
  override,         // { lat, lng, source } | undefined
  isEditing,        // bool — true when this is the active edit-mode marker
  isFrescosAssigned,
  bgColor,
  onMarkerClick,    // (name: string) => void
  dispatch,
}) {
  const name       = fullName(employee)
  const baseCoords = employee.coordinates
  const targetLat  = override?.lat ?? baseCoords.lat
  const targetLng  = override?.lng ?? baseCoords.lng

  // snappedPos: stable React position (only changes at animation end).
  // markerRef:  forwarded to AdvancedMarker so the RAF loop can mutate
  //             marker.position directly without triggering React re-renders.
  const { snappedPos, markerRef } = useAnimatedPosition(targetLat, targetLng)

  function handleDragEnd(e) {
    if (!e.latLng) return
    dispatch({
      type:    ACTIONS.SET_COORDINATE_OVERRIDE,
      payload: { name, lat: e.latLng.lat(), lng: e.latLng.lng(), source: 'drag' },
    })
  }

  // ── Marker element ────────────────────────────────────────────────────────
  // Circular div with a User icon. Root is always a <div> so React can
  // reconcile across all state variants without unmounting the AdvancedMarker
  // node (which would trigger the "removeChild on Node" crash in the Maps API).
  const pinEl = (
    <div style={{
      position: 'relative', display: 'inline-block',
      opacity: isFrescosAssigned ? 0.6 : 1,
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%',
        backgroundColor: bgColor,
        border: '2px solid white',
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <User size={16} color="white" />
      </div>
      {/* Override indicator — white dot with dark border, top-right badge */}
      {override && (
        <div style={{
          position: 'absolute', top: -4, right: -4,
          width: 10, height: 10, borderRadius: '50%',
          backgroundColor: '#ffffff', border: '2px solid #444',
          pointerEvents: 'none',
        }} />
      )}
    </div>
  )

  return (
    <AdvancedMarker
      ref={markerRef}
      position={snappedPos}
      title={`${name} — ${employee.Profesion}`}
      draggable={isEditing}
      onDragEnd={isEditing ? handleDragEnd : undefined}
      onClick={() => onMarkerClick(name)}
    >
      {pinEl}
    </AdvancedMarker>
  )
}

// ---------------------------------------------------------------------------
// Step 1-2 InfoWindow: employee information only
// ---------------------------------------------------------------------------

function EmployeeInfoContent({ employee }) {
  return (
    <Card className="min-w-[180px] shadow-none border-0">
      <CardContent className="p-3 space-y-0.5">
        <p className="font-semibold text-sm leading-tight">
          {employee.Nombre} {employee.Apellido}
        </p>
        <p className="text-xs text-muted-foreground">{employee.Profesion}</p>
        <p className="text-xs text-muted-foreground">
          {employee.Direccion}, {employee.Ciudad}
        </p>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Step 3+ InfoWindow for frescos-assigned employees (informational, no actions)
// ---------------------------------------------------------------------------

function FrescosInfoContent({ employee }) {
  return (
    <Card className="min-w-[180px] shadow-none border-0">
      <CardContent className="p-3 space-y-0.5">
        <p className="font-semibold text-sm leading-tight">
          {employee.Nombre} {employee.Apellido}
        </p>
        <p className="text-xs text-muted-foreground">{employee.Profesion}</p>
        <p className="text-xs font-medium text-muted-foreground mt-1">
          Asignado al Vehículo QH
        </p>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// VehicleSubMenu — one vehicle's expandable sub-options (PE / Pickup)
// Uses inline styles: lives inside Google Maps InfoWindow DOM.
// ---------------------------------------------------------------------------

function VehicleSubMenu({ vehicle, employeeName, expanded, onToggle, dispatch, onClose }) {
  const label = vehicleLabel(vehicle)
  const cap   = capacityInfo(vehicle)

  return (
    <div>
      <button
        onClick={onToggle}
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
          width:      '100%',
        }}
      >
        <span style={{ fontSize: 10 }}>{expanded ? '▾' : '▸'}</span>
        <span style={{ fontWeight: 500 }}>{label}</span>
        <span style={{ color: '#9ca3af', fontSize: 11 }}>({cap})</span>
      </button>

      {expanded && (
        <div style={{ marginLeft: 14, display: 'flex', flexDirection: 'column', gap: 3 }}>
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
// VehicleAssignmentMenu — step 3+ context menu for one employee
// ---------------------------------------------------------------------------

function VehicleAssignmentMenu({ employee, vehicles, dispatch, onClose }) {
  const [expandedVehicle, setExpandedVehicle] = useState(null)

  const name      = fullName(employee)
  const personal  = vehicles.find(v => v.type === 'personal')
  const charterV  = vehicles.find(v => v.type === 'charter')
  const isDriver  = personal?.driver === name

  const isAssigned = vehicles.some(v =>
    v.passengers_pe.includes(name) || v.pickup.passengers.includes(name)
    || v.pickups.some(pu => pu.passengers.includes(name)),
  )

  const available = vehicles.filter(v => !isVehicleFull(v))

  return (
    <Card className="min-w-[200px] shadow-none border-0">
      <CardContent className="p-3 space-y-2">

        <div>
          <p className="font-semibold text-sm leading-tight">{name}</p>
          <p className="text-xs text-muted-foreground">{employee.Profesion}</p>
        </div>

        {isDriver ? (
          <p className="text-xs text-green-600 font-medium">
            Chofer — asignado automáticamente
          </p>
        ) : isAssigned ? (
          <Button
            size="sm"
            variant="ghost"
            className="w-full text-xs text-destructive hover:text-destructive"
            onClick={() => {
              dispatch({ type: ACTIONS.UNASSIGN_EMPLOYEE, payload: { employee_name: name } })
              onClose()
            }}
          >
            Quitar asignación
          </Button>
        ) : charterV ? (
          /* Charter vehicle: flat assignment options, no capacity limit */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <button
              onClick={() => {
                dispatch({ type: ACTIONS.ASSIGN_TO_PE, payload: { employee_name: name, vehicle_id: charterV.id } })
                onClose()
              }}
              style={{ fontSize: 12, color: '#1d4ed8', background: 'none', border: 'none', cursor: 'pointer', padding: '3px 0', textAlign: 'left' }}
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
                style={{ fontSize: 12, color: '#444444', background: 'none', border: 'none', cursor: 'pointer', padding: '3px 0', textAlign: 'left' }}
              >
                → Pickup {i + 1} ({pu.point.place_name ?? pu.point.place_address})
              </button>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {available.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Todos los vehículos están llenos
              </p>
            ) : (
              available.map(v => (
                <VehicleSubMenu
                  key={v.id}
                  vehicle={v}
                  employeeName={name}
                  expanded={expandedVehicle === v.id}
                  onToggle={() => setExpandedVehicle(prev => prev === v.id ? null : v.id)}
                  dispatch={dispatch}
                  onClose={onClose}
                />
              ))
            )}
          </div>
        )}

      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * @param {object}   props
 * @param {object[]} props.staff  Geocoded staff list from state.staffWithCoords.
 *                                Each employee must have a "coordinates" key.
 */
export default function StaffMarkers({ staff }) {
  const { state, dispatch } = useAppState()

  // selectedKey: full name string of the employee whose InfoWindow is open, or null.
  const [selectedKey, setSelectedKey] = useState(null)

  const isStep3Plus = state.currentStep >= 3
  const {
    vehicles,
    personalVehicle,
    frescosResult,
    secondMinifleteResult,
    coordinateOverrides,
    editingMarker,
  } = state

  const frescosAssignedNames = useMemo(() => {
    const names = new Set()
    ;(frescosResult?.assigned_names ?? []).forEach((n) => names.add(n.toLowerCase().trim()))
    if (secondMinifleteResult?.assigned_name) {
      names.add(secondMinifleteResult.assigned_name.toLowerCase().trim())
    }
    return names
  }, [frescosResult, secondMinifleteResult])

  // Driver name — used to enforce the address-lock after a meeting point has
  // been chosen (relevant in step 2 before vehicles is populated).
  const driverName = personalVehicle?.driver
    ? `${personalVehicle.driver.Nombre} ${personalVehicle.driver.Apellido}`
    : null

  // ── Marker click handler ───────────────────────────────────────────────────
  // When the user clicks a marker:
  //   • If a different marker was in edit mode → exit edit mode
  //   • If this marker was in edit mode → stay open (don't toggle closed)
  //   • Otherwise → toggle the InfoWindow open/closed
  function handleMarkerClick(name) {
    if (editingMarker === name) {
      // Clicking the currently-editing marker: keep it open (no toggle).
      return
    }
    if (editingMarker) {
      dispatch({ type: ACTIONS.SET_EDITING_MARKER, payload: null })
    }
    setSelectedKey((prev) => (prev === name ? null : name))
  }

  // ── InfoWindow close (X button) ────────────────────────────────────────────
  function handleInfoClose() {
    setSelectedKey(null)
    if (editingMarker) {
      dispatch({ type: ACTIONS.SET_EDITING_MARKER, payload: null })
    }
  }

  // ── Context for the selected InfoWindow ───────────────────────────────────
  const selectedEmployee   = selectedKey ? staff.find((e) => fullName(e) === selectedKey) : null
  const selectedOverride   = selectedKey ? coordinateOverrides?.[selectedKey] : null
  // InfoWindow snaps to the final target position (no animation for the anchor).
  const infoWindowCoords   = selectedOverride
    ? { lat: selectedOverride.lat, lng: selectedOverride.lng }
    : selectedEmployee?.coordinates ?? null
  const selIsFrescosAssigned = selectedKey
    ? (isStep3Plus && frescosAssignedNames.has(selectedKey.toLowerCase().trim()))
    : false

  return (
    <>
      {staff.map((employee) => {
        const coords = employee.coordinates
        if (!coords) return null

        const key             = fullName(employee)
        const isFrescosAssigned = isStep3Plus && frescosAssignedNames.has(key.toLowerCase().trim())
        const override        = coordinateOverrides?.[key]

        let bgColor
        if (isFrescosAssigned) {
          bgColor = '#B0C4DE'
        } else if (isStep3Plus && vehicles.length > 0) {
          bgColor = getMarkerBg(employee, vehicles)
        } else {
          bgColor = '#4285F4'
        }

        return (
          <StaffMarker
            key={key}
            employee={employee}
            override={override}
            isEditing={editingMarker === key}
            isFrescosAssigned={isFrescosAssigned}
            bgColor={bgColor}
            onMarkerClick={handleMarkerClick}
            dispatch={dispatch}
          />
        )
      })}

      {/*
        Single InfoWindow rendered outside the marker loop, anchored by
        position.  This avoids N concurrent InfoWindow instances fighting
        over visibility.  The content switches between normal info/menu and
        the edit-mode UI based on editingMarker.
      */}
      {selectedEmployee && infoWindowCoords && (
        <InfoWindow
          position={{ lat: infoWindowCoords.lat, lng: infoWindowCoords.lng }}
          pixelOffset={[0, -40]}
          onCloseClick={handleInfoClose}
          shouldFocus={false}
        >
          {editingMarker === selectedKey ? (
            // ── Edit mode: address input + geocode + listo ─────────────────
            <EditModeContent
              employee={selectedEmployee}
              hasOverride={!!selectedOverride}
              dispatch={dispatch}
              onDone={() => dispatch({ type: ACTIONS.SET_EDITING_MARKER, payload: null })}
            />
          ) : (
            // ── Normal mode: info/menu + edit controls strip below ─────────
            <>
              {selIsFrescosAssigned ? (
                <FrescosInfoContent employee={selectedEmployee} />
              ) : isStep3Plus ? (
                <VehicleAssignmentMenu
                  employee={selectedEmployee}
                  vehicles={vehicles}
                  dispatch={dispatch}
                  onClose={handleInfoClose}
                />
              ) : (
                <EmployeeInfoContent employee={selectedEmployee} />
              )}

              {/*
                Edit controls strip — rendered below any InfoWindow variant.
                Uses inline styles: the InfoWindow DOM is owned by Google Maps
                so Tailwind utility classes may not apply reliably here.
                "Editar dirección" enters edit mode for this marker.
                "Volver a original" reverts the override (snaps back immediately).
                The driver's edit button is hidden once a meeting point has been
                chosen — routes are committed and the origin can no longer change.
              */}
              {selectedKey === driverName && state.chosenMeetingPoint ? (
                // Driver address locked — meeting point already selected.
                <div style={{ padding: '6px 12px 10px', borderTop: '1px solid #e5e7eb' }}>
                  <p style={{ fontSize: 11, color: '#9ca3af', margin: 0 }}>
                    Dirección bloqueada — punto de encuentro ya seleccionado.
                  </p>
                </div>
              ) : (
                <div style={{
                  padding: '6px 12px 10px',
                  borderTop: '1px solid #e5e7eb',
                  display: 'flex',
                  gap: 12,
                  alignItems: 'center',
                }}>
                  <button
                    onClick={() => dispatch({ type: ACTIONS.SET_EDITING_MARKER, payload: selectedKey })}
                    style={{
                      fontSize: 11, color: '#6B7280', textDecoration: 'underline',
                      background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                    }}
                  >
                    Editar dirección
                  </button>
                  {selectedOverride && (
                    <button
                      onClick={() => dispatch({ type: ACTIONS.CLEAR_COORDINATE_OVERRIDE, payload: { name: selectedKey } })}
                      style={{
                        fontSize: 11, color: '#9ca3af', textDecoration: 'underline',
                        background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                      }}
                    >
                      Volver a original
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </InfoWindow>
      )}
    </>
  )
}
