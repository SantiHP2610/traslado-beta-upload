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
 * Green  (#34A853)        → driver or personal car passenger
 * Grey   (#9E9E9E)        → Uber passenger
 * Yellow (#FFC107)        → pickup employee (picked up on the route before the PE)
 * Washed blue (#B0C4DE)   → frescos-assigned (step 3+); 0.6 opacity, no actions
 *
 * These four states map directly to the four color decisions in CLAUDE.md's
 * "Route and assignment color coding" section.
 *
 * ── Why assignment logic lives in this component ─────────────────────────────
 * Actions are spatially anchored to a specific marker: "assign to car" only
 * makes sense for the employee whose pin you just tapped.  Rendering the
 * action menu as an InfoWindow on that pin is the natural spatial affordance —
 * it mirrors how Google Maps shows place actions when you tap a pin.  Moving
 * the logic to a sidebar or separate overlay would break the spatial connection
 * between the employee's home address and the action being taken.
 *
 * ── Why selectedKey is local state ───────────────────────────────────────────
 * "Which InfoWindow is open" is pure transient UI state — it has no meaning
 * outside this component and does not affect any backend call or downstream
 * step.  Local useState is the right scope.
 *
 * ── Why useAppState is called here instead of receiving assignments as props ──
 * StaffMarkers reads and mutates four state slices (assignments, personalVehicle,
 * driverRoutes, chosenMeetingPoint).  Threading all four as props from AppMap
 * would create excessive coupling between AppMap and its child.  Calling
 * useAppState() here is cleaner: this component is the rightful owner of the
 * assignment interaction concern.
 */

import { useState, useMemo }                   from 'react'
import { AdvancedMarker, InfoWindow, Pin }     from '@vis.gl/react-google-maps'
import { useAppState, ACTIONS }               from '../../state/appState'
import { findPickup }                         from '../../api/endpoints'
import { Card, CardContent }                  from '@/components/ui/card'
import { Button }                             from '@/components/ui/button'

// Maximum passengers in the personal car (excluding driver).
// Mirrors MAX_PASSENGERS_PER_CAR in config.py — kept in sync manually.
const MAX_CAR_PASSENGERS = 4

// ── Scenario color palette for driver + car passengers ────────────────────────
// When the user selects PE, the car's route turns yellow — markers match.
// When the user selects a PEA, the car's route turns orange — markers match.
// This creates a consistent "theme color" across route and assigned staff so
// the manager can visually connect the vehicle to its route at a glance.
//
// chosenScenarioColor is derived from chosenMeetingPoint + meetingPoint in the
// main component and passed into getMarkerColors.  A single derivation point
// means the color scheme can be changed in one place and all markers update.
const SCENARIO_PE  = { background: '#FBBC04', borderColor: '#d6a000', glyphColor: '#1a1a1a' }
const SCENARIO_PEA = { background: '#FF6D00', borderColor: '#e65100', glyphColor: '#ffffff' }

// ---------------------------------------------------------------------------
// Helpers — employee identification
// ---------------------------------------------------------------------------

function fullName(emp) {
  return `${emp.Nombre} ${emp.Apellido}`
}

function sameEmployee(a, b) {
  return a && b && fullName(a) === fullName(b)
}

// ---------------------------------------------------------------------------
// Marker color by assignment state
//
// Returns a { background, borderColor, glyphColor } object for Pin.
// Called once per employee per render — kept as a pure function (no hooks)
// so it can run inside the map() loop without violating the Rules of Hooks.
// ---------------------------------------------------------------------------

// chosenScenarioColor: 'pe' | 'pea' | null
//   null  → no meeting point chosen yet; use default green for car/driver
//   'pe'  → PE chosen; driver + car passengers get SCENARIO_PE yellow
//   'pea' → PEA chosen; driver + car passengers get SCENARIO_PEA orange
function getMarkerColors(employee, assignments, chosenScenarioColor) {
  if (!assignments) {
    // Step 1-2: all markers are the standard blue (no assignments yet)
    return { background: '#4285F4', borderColor: '#2a6dd9', glyphColor: '#ffffff' }
  }

  // Determine the color for driver and car passengers.
  // Before a meeting point is chosen the car still shows green (neutral).
  // Once chosen the car's color matches the route ("theme color").
  const carColors = chosenScenarioColor === 'pe'  ? SCENARIO_PE
                  : chosenScenarioColor === 'pea' ? SCENARIO_PEA
                  : { background: '#34A853', borderColor: '#1a6e2e', glyphColor: '#ffffff' }

  // Driver — scenario color when meeting point is chosen, green otherwise
  if (sameEmployee(assignments.driver, employee)) {
    return carColors
  }

  // Pickup employee — #FFC107 amber-yellow, distinct from scenario yellows.
  // The pickup employee travels by transit to meet the car on the route —
  // a different journey than car passengers, hence a different color.
  if (sameEmployee(assignments.pickup_employee, employee)) {
    return { background: '#FFC107', borderColor: '#e6a800', glyphColor: '#1a1a1a' }
  }

  // Car passenger — same scenario color as the driver (same vehicle)
  if (assignments.car_passengers?.some((p) => sameEmployee(p, employee))) {
    return carColors
  }

  // Uber passenger — grey (separate booking, same destination)
  if (assignments.uber_passengers?.some((p) => sameEmployee(p, employee))) {
    return { background: '#9E9E9E', borderColor: '#757575', glyphColor: '#ffffff' }
  }

  // Unassigned — default blue
  return { background: '#4285F4', borderColor: '#2a6dd9', glyphColor: '#ffffff' }
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
//
// These employees are already committed to the Vehículo QH — the manager
// cannot reassign them.  Showing the regular context menu would create false
// affordance (buttons that shouldn't be pressed).  A read-only view makes
// the non-interactive status explicit.
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
// Step 3+ context menu: assignment actions
// ---------------------------------------------------------------------------

function AssignmentMenuContent({
  employee,
  assignments,
  personalVehicle,
  driverRoutes,
  chosenMeetingPoint,
  meetingPoint,
  dispatch,
  onClose,
}) {
  const [loadingPickup, setLoadingPickup] = useState(false)

  const name     = fullName(employee)
  const isDriver = sameEmployee(assignments?.driver, employee)

  const inCar = assignments?.car_passengers?.some((p) => sameEmployee(p, employee))
  const inUber = assignments?.uber_passengers?.some((p) => sameEmployee(p, employee))
  const isPickup = sameEmployee(assignments?.pickup_employee, employee)
  const isAssigned = inCar || inUber

  const carCount = assignments?.car_passengers?.length ?? 0
  const carFull  = carCount >= MAX_CAR_PASSENGERS
  const hasVehicle = personalVehicle?.has_personal_vehicle

  // Vehicle label for button text — mirrors the label shown in AssignmentPanel
  // and ConfirmationModal: "{description} de {Nombre} {Apellido}".
  const vLabel = personalVehicle?.vehicle_description && personalVehicle?.driver
    ? `${personalVehicle.vehicle_description} de ${personalVehicle.driver.Nombre} ${personalVehicle.driver.Apellido}`
    : 'vehículo'

  // Patch a single field (or multiple) into the current assignments object.
  function patch(fields) {
    dispatch({
      type:    ACTIONS.SET_ASSIGNMENTS,
      payload: { ...assignments, ...fields },
    })
  }

  function handleAssignCar() {
    patch({
      car_passengers:  [...(assignments?.car_passengers ?? []), employee],
      // Remove from Uber if they were there
      uber_passengers: assignments?.uber_passengers?.filter(
        (p) => !sameEmployee(p, employee),
      ) ?? [],
    })
    onClose()
  }

  function handleAssignUber() {
    patch({
      uber_passengers: [...(assignments?.uber_passengers ?? []), employee],
      // Remove from car if they were there
      car_passengers: assignments?.car_passengers?.filter(
        (p) => !sameEmployee(p, employee),
      ) ?? [],
      // If this employee was the pickup, clear that too
      ...(isPickup ? { pickup_employee: null, pickup_place: null } : {}),
    })
    onClose()
  }

  function handleRemove() {
    patch({
      car_passengers:  assignments?.car_passengers?.filter((p) => !sameEmployee(p, employee)) ?? [],
      uber_passengers: assignments?.uber_passengers?.filter((p) => !sameEmployee(p, employee)) ?? [],
      ...(isPickup ? { pickup_employee: null, pickup_place: null } : {}),
    })
    onClose()
  }

  async function handleFindPickup() {
    if (!driverRoutes || !chosenMeetingPoint) return

    // The route polyline depends on which meeting point the user chose:
    //   PE  → base_route  (driver home → PE → event)
    //   PEA → direct_route (driver home → event, passes near the PEA)
    // A PEA has a different name from the original PE returned by /nearest-meeting-point.
    const isPea = meetingPoint && chosenMeetingPoint.name !== meetingPoint.name
    const routePolyline = isPea
      ? driverRoutes.direct_route?.encoded_polyline
      : driverRoutes.base_route?.encoded_polyline

    if (!routePolyline) return

    setLoadingPickup(true)
    try {
      const result = await findPickup({
        employee_name:  name,
        route_polyline: routePolyline,
        meeting_point: {
          name: chosenMeetingPoint.name,
          lat:  chosenMeetingPoint.lat,
          lng:  chosenMeetingPoint.lng,
        },
      })
      dispatch({
        type:    ACTIONS.SET_ACTIVE_PICKUP_RESULT,
        payload: { employeeName: name, result },
      })
    } catch (err) {
      dispatch({
        type:    ACTIONS.SET_ERROR,
        payload: err?.response?.data?.detail ?? err?.message ?? 'Error al buscar pickup.',
      })
    } finally {
      setLoadingPickup(false)
      onClose()
    }
  }

  return (
    <Card className="min-w-[200px] shadow-none border-0">
      <CardContent className="p-3 space-y-2">

        {/* Employee header */}
        <div>
          <p className="font-semibold text-sm leading-tight">{name}</p>
          <p className="text-xs text-muted-foreground">{employee.Profesion}</p>
        </div>

        {/* Driver — informational only, no actions */}
        {isDriver && (
          <p className="text-xs text-green-600 font-medium">
            Chofer — asignado automáticamente
          </p>
        )}

        {/* Assignment actions — hidden for driver */}
        {!isDriver && (
          <div className="space-y-1.5">

            {/* Assign to personal car */}
            {hasVehicle && !carFull && !inCar && (
              <Button
                size="sm"
                variant="outline"
                className="w-full text-xs"
                onClick={handleAssignCar}
              >
                Asignar al {vLabel}
              </Button>
            )}

            {/* Full car message */}
            {hasVehicle && carFull && !inCar && (
              <p className="text-xs text-muted-foreground text-center">
                Vehículo completo ({MAX_CAR_PASSENGERS}/{MAX_CAR_PASSENGERS})
              </p>
            )}

            {/* Find pickup on route */}
            {hasVehicle && driverRoutes && (
              <Button
                size="sm"
                variant="outline"
                className="w-full text-xs"
                onClick={handleFindPickup}
                disabled={loadingPickup}
              >
                {loadingPickup ? (
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
                ) : (
                  'Buscar pickup en ruta'
                )}
              </Button>
            )}

            {/* Assign to Uber */}
            {!inUber && (
              <Button
                size="sm"
                variant="outline"
                className="w-full text-xs"
                onClick={handleAssignUber}
              >
                Asignar a Uber
              </Button>
            )}

            {/* Remove assignment */}
            {isAssigned && (
              <Button
                size="sm"
                variant="ghost"
                className="w-full text-xs text-destructive hover:text-destructive"
                onClick={handleRemove}
              >
                Quitar asignación
              </Button>
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

  // selectedKey is the full name string of the currently open InfoWindow/menu,
  // or null when nothing is open.  A string key avoids storing the full
  // employee object in local state (it can always be looked up from staff).
  const [selectedKey, setSelectedKey] = useState(null)

  const isStep3Plus = state.currentStep >= 3
  const {
    assignments,
    personalVehicle,
    driverRoutes,
    chosenMeetingPoint,
    meetingPoint,
    frescosResult,
    secondMinifleteResult,
  } = state

  // Employees committed to the Vehículo QH — built once per relevant state
  // change so the per-marker loop can do O(1) membership checks.
  // Comparison is normalised (lowercase + trim) to tolerate whitespace drift.
  const frescosAssignedNames = useMemo(() => {
    const names = new Set()
    ;(frescosResult?.assigned_names ?? []).forEach((n) => names.add(n.toLowerCase().trim()))
    if (secondMinifleteResult?.assigned_name) {
      names.add(secondMinifleteResult.assigned_name.toLowerCase().trim())
    }
    return names
  }, [frescosResult, secondMinifleteResult])

  // chosenScenarioColor — derived from which meeting point the user selected.
  // 'pe'  → PE chosen  → yellow (#FBBC04) route and markers
  // 'pea' → PEA chosen → orange (#FF6D00) route and markers
  // null  → no choice yet → car markers stay green (neutral default)
  //
  // Derived here rather than hardcoded per case so a single place controls the
  // mapping between "which point was chosen" and "what color scheme applies."
  const isPea = meetingPoint && chosenMeetingPoint?.name !== meetingPoint?.name
  const chosenScenarioColor = !chosenMeetingPoint ? null : isPea ? 'pea' : 'pe'

  // Resolve the selected employee object only when we need to render the popup.
  const selectedEmployee = selectedKey
    ? staff.find((emp) => fullName(emp) === selectedKey)
    : null

  return (
    <>
      {staff.map((employee) => {
        const coords = employee.coordinates
        // Silently skip employees whose address could not be geocoded.
        if (!coords) return null

        const key              = fullName(employee)
        const isOpen           = selectedKey === key
        const isFrescosAssigned = isStep3Plus && frescosAssignedNames.has(key.toLowerCase().trim())
        const colors           = isFrescosAssigned
          // Washed-out blue — same hue family as unassigned (#4285F4) but
          // desaturated, signalling "exists but not interactive".
          ? { background: '#B0C4DE', borderColor: '#8aabbf', glyphColor: '#ffffff' }
          : getMarkerColors(
              employee,
              isStep3Plus ? assignments : null,
              isStep3Plus ? chosenScenarioColor : null,
            )

        return (
          <AdvancedMarker
            key={key}
            position={{ lat: coords.lat, lng: coords.lng }}
            title={`${key} — ${employee.Profesion}`}
            onClick={() => setSelectedKey(isOpen ? null : key)}
          >
            {isFrescosAssigned ? (
              // 0.6 opacity wrapper signals the non-interactive "disabled" state
              // without removing the marker from the map — the manager still
              // needs to see where these employees live for context.
              <div style={{ opacity: 0.6 }}>
                <Pin
                  background={colors.background}
                  borderColor={colors.borderColor}
                  glyphColor={colors.glyphColor}
                />
              </div>
            ) : (
              <Pin
                background={colors.background}
                borderColor={colors.borderColor}
                glyphColor={colors.glyphColor}
              />
            )}
          </AdvancedMarker>
        )
      })}

      {/*
        Single InfoWindow rendered outside the marker loop, anchored by
        position.  This avoids N concurrent InfoWindow instances fighting
        over visibility.
      */}
      {selectedEmployee?.coordinates && (
        <InfoWindow
          position={{
            lat: selectedEmployee.coordinates.lat,
            lng: selectedEmployee.coordinates.lng,
          }}
          pixelOffset={[0, -40]}
          onCloseClick={() => setSelectedKey(null)}
          shouldFocus={false}
        >
          {isStep3Plus && frescosAssignedNames.has(fullName(selectedEmployee).toLowerCase().trim()) ? (
            <FrescosInfoContent employee={selectedEmployee} />
          ) : isStep3Plus ? (
            <AssignmentMenuContent
              employee={selectedEmployee}
              assignments={assignments}
              personalVehicle={personalVehicle}
              driverRoutes={driverRoutes}
              chosenMeetingPoint={chosenMeetingPoint}
              meetingPoint={meetingPoint}
              dispatch={dispatch}
              onClose={() => setSelectedKey(null)}
            />
          ) : (
            <EmployeeInfoContent employee={selectedEmployee} />
          )}
        </InfoWindow>
      )}
    </>
  )
}
